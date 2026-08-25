import ExcelJS from "exceljs";
import { normalizeHeader, isFooterMarkerText, rawCellValue, isBlankCell } from "./normalizeHeader";
import { parseRequiredText, parseOptionalText, parseRequiredNonNegativeNumber, parseRequiredPositiveInt } from "./validation";
import {
  MAX_SCHEDULE_FILE_SIZE_BYTES,
  EQUIPMENT_NAME_MAX_LENGTH,
  type CpmScheduleRow,
  type CpmScheduleParseResult,
  type CpmRowErrorCode,
} from "./types";

// Phase 9 — CPM Schedule Import. Parses the real "CPM-IMPORT-TEMPLATE.xlsx"
// structure (inspected 2026-08-24): worksheet "EQUIPMENT,TOOLS, MACHINE",
// header row 1, data starting row 2, columns A=SRN, B=Equipment Name,
// C=Chassis Number/Number Plate (Optional), D=Quantity, E=Single Unit
// Value/KES, F=Total Value/KES (formula). Column A ("SRN") is pre-filled
// 1..N even on otherwise-blank rows — blank-row detection never looks at
// column A. The footer row ("Total Sum") has A14:C14 merged in the real
// template; isFooterMarkerText checks every column so the merge shape
// doesn't matter.
//
// totalValue on every returned row is always quantity x unitValue,
// recalculated here — never Excel column F's own formula result (this
// phase's spec: "Import 绝对不能直接信任 Excel Total Value").
//
// No macro execution, no formula evaluation, no filesystem access.

const HEADER_ROW = 1;
const DATA_START_ROW = 2;
const COL = { srn: 1, equipmentName: 2, chassisOrPlate: 3, quantity: 4, unitValue: 5 } as const;

function looksLikeCpmSheet(worksheet: ExcelJS.Worksheet): boolean {
  const header = worksheet.getRow(HEADER_ROW);
  const nameHeader = normalizeHeader(header.getCell(COL.equipmentName).value);
  const quantityHeader = normalizeHeader(header.getCell(COL.quantity).value);
  return nameHeader.includes("equipment name") && quantityHeader.includes("quantity");
}

function selectCpmWorksheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet | null {
  for (const ws of workbook.worksheets) {
    if (looksLikeCpmSheet(ws)) return ws;
  }
  return null;
}

function classifyRow(row: ExcelJS.Row): "footer" | "blank" | "data" {
  for (let c = 1; c <= 6; c++) {
    if (isFooterMarkerText(row.getCell(c).value)) return "footer";
  }
  const equipmentName = rawCellValue(row.getCell(COL.equipmentName).value);
  const chassisOrPlate = rawCellValue(row.getCell(COL.chassisOrPlate).value);
  const quantity = rawCellValue(row.getCell(COL.quantity).value);
  const unitValue = rawCellValue(row.getCell(COL.unitValue).value);
  const allBlank = isBlankCell(equipmentName) && isBlankCell(chassisOrPlate) && isBlankCell(quantity) && isBlankCell(unitValue);
  return allBlank ? "blank" : "data";
}

function validateRow(rowNumber: number, row: ExcelJS.Row): CpmScheduleRow {
  const equipmentNameRaw = rawCellValue(row.getCell(COL.equipmentName).value);
  const chassisOrPlateRaw = rawCellValue(row.getCell(COL.chassisOrPlate).value);
  const quantityRaw = rawCellValue(row.getCell(COL.quantity).value);
  const unitValueRaw = rawCellValue(row.getCell(COL.unitValue).value);

  const base = {
    rowNumber,
    equipmentName: equipmentNameRaw === null ? "" : String(equipmentNameRaw).trim(),
    // Preserved exactly as entered — never numeric-validated, never forced
    // into a number (this phase's spec: "preserve original text, do not
    // force numeric conversion").
    chassisOrPlate: parseOptionalText(chassisOrPlateRaw),
    quantity: quantityRaw === null ? "" : String(quantityRaw),
    unitValue: unitValueRaw === null ? "" : String(unitValueRaw),
  };

  const fail = (errorCode: CpmRowErrorCode): CpmScheduleRow => ({
    ...base,
    totalValue: "0",
    status: "error",
    errorCode,
  });

  const equipmentName = parseRequiredText(equipmentNameRaw, EQUIPMENT_NAME_MAX_LENGTH);
  if (!equipmentName.ok) {
    return fail(equipmentNameRaw !== null && String(equipmentNameRaw).trim() ? "EQUIPMENT_NAME_TOO_LONG" : "EQUIPMENT_NAME_REQUIRED");
  }

  const quantity = parseRequiredPositiveInt(quantityRaw);
  if (!quantity.ok) return fail("QUANTITY_INVALID");

  const unitValue = parseRequiredNonNegativeNumber(unitValueRaw);
  if (!unitValue.ok) return fail("UNIT_VALUE_INVALID");

  // System-recalculated — see this file's top doc comment.
  const totalValue = quantity.value * unitValue.value;

  return { ...base, totalValue: String(totalValue), status: "valid", errorCode: null };
}

export async function parseCpmSchedule(buffer: Buffer): Promise<CpmScheduleParseResult> {
  if (buffer.byteLength > MAX_SCHEDULE_FILE_SIZE_BYTES) return { ok: false, error: "FILE_TOO_LARGE" };

  let workbook: ExcelJS.Workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    return { ok: false, error: "PARSE_FAILED" };
  }

  const worksheet = selectCpmWorksheet(workbook);
  if (!worksheet) return { ok: false, error: "INVALID_TEMPLATE" };

  const rows: CpmScheduleRow[] = [];
  let blankRowsSkipped = 0;
  const lastRow = Math.max(worksheet.actualRowCount, worksheet.rowCount);

  for (let r = DATA_START_ROW; r <= lastRow; r++) {
    const row = worksheet.getRow(r);
    const kind = classifyRow(row);
    if (kind === "footer") break;
    if (kind === "blank") {
      blankRowsSkipped++;
      continue;
    }
    rows.push(validateRow(r, row));
  }

  if (rows.length === 0) return { ok: false, error: "NO_DATA_ROWS" };

  const validRows = rows.filter((r) => r.status === "valid");
  const totals = {
    totalQuantity: validRows.reduce((sum, r) => sum + Number(r.quantity), 0),
    totalSumInsured: validRows.reduce((sum, r) => sum + Number(r.totalValue), 0),
  };

  return { ok: true, rows, totals, blankRowsSkipped, hasErrors: rows.some((r) => r.status === "error") };
}
