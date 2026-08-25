import ExcelJS from "exceljs";
import { normalizeHeader, isFooterMarkerText, rawCellValue, isBlankCell } from "./normalizeHeader";
import {
  parseRequiredText,
  parseRequiredNonNegativeNumber,
  parseOptionalNonNegativeNumber,
  parseRequiredPositiveInt,
} from "./validation";
import {
  MAX_SCHEDULE_FILE_SIZE_BYTES,
  OCCUPATION_MAX_LENGTH,
  type WibaScheduleRow,
  type WibaScheduleParseResult,
  type WibaRowErrorCode,
} from "./types";

// Phase 9 — WIBA Schedule Import. Parses the real "WIBA-IMPORT-TEMPLATE.xlsx"
// structure (inspected 2026-08-24): worksheet "WIBA LIST", header row 1,
// data starting row 2, columns A=No, B=Occupation, C=Basic Salary/month,
// D=Allowance/month, E=Overtime/Bonus/month, F=Number of Employees,
// G=Estimated Total Monthly Salary (formula), H=Estimated Annual Salary
// (formula). Column A ("No") is pre-filled 1..N even on otherwise-blank
// rows in the real template — blank-row detection therefore never looks at
// column A, only at B-F.
//
// G/H are read only far enough to confirm the workbook LOOKS like the WIBA
// template during worksheet selection below — the actual monthlyEarnings/
// annualEarnings on every returned row are always recalculated from B-F
// here, never taken from the workbook's own formula result (this phase's
// spec: "系统导入时绝对不能信任 Excel G/H 列的计算结果").
//
// No macro execution, no formula evaluation, no filesystem access — ExcelJS
// only parses the OOXML structure and each cell's already-cached value/
// formula text; nothing here ever executes a formula or user code.

const HEADER_ROW = 1;
const DATA_START_ROW = 2;
const COL = { no: 1, occupation: 2, basicSalary: 3, allowance: 4, otherEarnings: 5, employeeCount: 6 } as const;

function looksLikeWibaSheet(worksheet: ExcelJS.Worksheet): boolean {
  const header = worksheet.getRow(HEADER_ROW);
  const occupationHeader = normalizeHeader(header.getCell(COL.occupation).value);
  const employeeHeader = normalizeHeader(header.getCell(COL.employeeCount).value);
  return occupationHeader.includes("occupation") && employeeHeader.includes("number of employees");
}

function selectWibaWorksheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet | null {
  // Prefer the first sheet that actually matches the expected header shape
  // — the real template's second sheet ("统计表") is a filled worked
  // example with a different header layout ("Position" not "Occupation",
  // no separate Overtime/Bonus column), never the import target.
  for (const ws of workbook.worksheets) {
    if (looksLikeWibaSheet(ws)) return ws;
  }
  return null;
}

function classifyRow(row: ExcelJS.Row): "footer" | "blank" | "data" {
  for (let c = 1; c <= 8; c++) {
    if (isFooterMarkerText(row.getCell(c).value)) return "footer";
  }
  const occupation = rawCellValue(row.getCell(COL.occupation).value);
  const basicSalary = rawCellValue(row.getCell(COL.basicSalary).value);
  const allowance = rawCellValue(row.getCell(COL.allowance).value);
  const otherEarnings = rawCellValue(row.getCell(COL.otherEarnings).value);
  const employeeCount = rawCellValue(row.getCell(COL.employeeCount).value);
  const allBlank =
    isBlankCell(occupation) && isBlankCell(basicSalary) && isBlankCell(allowance) && isBlankCell(otherEarnings) && isBlankCell(employeeCount);
  return allBlank ? "blank" : "data";
}

function validateRow(rowNumber: number, row: ExcelJS.Row): WibaScheduleRow {
  const occupationRaw = rawCellValue(row.getCell(COL.occupation).value);
  const basicSalaryRaw = rawCellValue(row.getCell(COL.basicSalary).value);
  const allowanceRaw = rawCellValue(row.getCell(COL.allowance).value);
  const otherEarningsRaw = rawCellValue(row.getCell(COL.otherEarnings).value);
  const employeeCountRaw = rawCellValue(row.getCell(COL.employeeCount).value);

  const base: Omit<WibaScheduleRow, "status" | "errorCode" | "monthlyEarnings" | "annualEarnings"> = {
    rowNumber,
    occupation: occupationRaw === null ? "" : String(occupationRaw).trim(),
    basicSalary: basicSalaryRaw === null ? "" : String(basicSalaryRaw),
    allowance: allowanceRaw === null ? "" : String(allowanceRaw),
    otherEarnings: otherEarningsRaw === null ? "" : String(otherEarningsRaw),
    employeeCount: employeeCountRaw === null ? "" : String(employeeCountRaw),
  };

  const fail = (errorCode: WibaRowErrorCode): WibaScheduleRow => ({
    ...base,
    monthlyEarnings: "0",
    annualEarnings: "0",
    status: "error",
    errorCode,
  });

  const occupation = parseRequiredText(occupationRaw, OCCUPATION_MAX_LENGTH);
  if (!occupation.ok) return fail(occupationRaw !== null && String(occupationRaw).trim() ? "OCCUPATION_TOO_LONG" : "OCCUPATION_REQUIRED");

  const basicSalary = parseRequiredNonNegativeNumber(basicSalaryRaw);
  if (!basicSalary.ok) return fail("BASIC_SALARY_INVALID");

  const allowance = parseOptionalNonNegativeNumber(allowanceRaw);
  if (!allowance.ok) return fail("ALLOWANCE_INVALID");

  const otherEarnings = parseOptionalNonNegativeNumber(otherEarningsRaw);
  if (!otherEarnings.ok) return fail("OTHER_EARNINGS_INVALID");

  const employeeCount = parseRequiredPositiveInt(employeeCountRaw);
  if (!employeeCount.ok) return fail("EMPLOYEE_COUNT_INVALID");

  // System-recalculated — see this file's top doc comment.
  const monthlyEarnings = (basicSalary.value + allowance.value + otherEarnings.value) * employeeCount.value;
  const annualEarnings = monthlyEarnings * 12;

  return {
    ...base,
    monthlyEarnings: String(monthlyEarnings),
    annualEarnings: String(annualEarnings),
    status: "valid",
    errorCode: null,
  };
}

export async function parseWibaSchedule(buffer: Buffer): Promise<WibaScheduleParseResult> {
  if (buffer.byteLength > MAX_SCHEDULE_FILE_SIZE_BYTES) return { ok: false, error: "FILE_TOO_LARGE" };

  let workbook: ExcelJS.Workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    return { ok: false, error: "PARSE_FAILED" };
  }

  const worksheet = selectWibaWorksheet(workbook);
  if (!worksheet) return { ok: false, error: "INVALID_TEMPLATE" };

  const rows: WibaScheduleRow[] = [];
  let blankRowsSkipped = 0;
  const lastRow = Math.max(worksheet.actualRowCount, worksheet.rowCount);

  for (let r = DATA_START_ROW; r <= lastRow; r++) {
    const row = worksheet.getRow(r);
    const kind = classifyRow(row);
    if (kind === "footer") break; // the TOTAL row is always last in this template — nothing meaningful follows it
    if (kind === "blank") {
      blankRowsSkipped++;
      continue;
    }
    rows.push(validateRow(r, row));
  }

  if (rows.length === 0) return { ok: false, error: "NO_DATA_ROWS" };

  const validRows = rows.filter((r) => r.status === "valid");
  const totals = {
    totalEmployees: validRows.reduce((sum, r) => sum + Number(r.employeeCount), 0),
    totalMonthlyEarnings: validRows.reduce((sum, r) => sum + Number(r.monthlyEarnings), 0),
    totalAnnualEarnings: validRows.reduce((sum, r) => sum + Number(r.annualEarnings), 0),
  };

  return { ok: true, rows, totals, blankRowsSkipped, hasErrors: rows.some((r) => r.status === "error") };
}
