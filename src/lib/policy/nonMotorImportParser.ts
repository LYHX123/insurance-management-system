import ExcelJS from "exceljs";
import { excelValueToDate, parseAmount } from "./normalize";

// Phase 3B: Non-Motor historical import. Unlike Motor (a single messy real
// legacy workbook, parsed by fixed column POSITION because its headers are
// duplicated/ambiguous — see motorImportParser.ts), no real historical
// Non-Motor workbook has been provided yet. This parser instead defines and
// validates a STANDARD column format that this project controls, so columns
// are matched by HEADER TEXT (case-insensitive, exact alias match only — no
// fuzzy/partial matching that could silently map the wrong column). When a
// real legacy Non-Motor workbook is eventually provided, this file is the
// one to extend with its actual column layout — the rest of the import
// pipeline (actions, preview UI) does not need to change.
//
// Also unlike Motor, this uses ExcelJS's regular (non-streaming) Workbook
// API rather than the streaming WorkbookReader — appropriate here because
// standard-format uploads are expected to be small (tens/hundreds of rows,
// not Motor's 1,400+), and the non-streaming API makes "does this worksheet
// have the required headers at all" trivial to check per-sheet before
// committing to parse its rows.

export type NonMotorStandardColumn =
  | "PROCESSING_DATE"
  | "CUSTOMER"
  | "TYPE_OF_COVER"
  | "INSURER"
  | "POLICY_NUMBER"
  | "EFFECTIVE_DATE"
  | "EXPIRY_DATE"
  | "CLIENT_PREMIUM"
  | "INSURER_COST"
  | "REMARKS"
  | "PROJECT";

export const NON_MOTOR_STANDARD_HEADERS: Record<NonMotorStandardColumn, string> = {
  PROCESSING_DATE: "PROCESSING DATE",
  CUSTOMER: "CUSTOMER",
  TYPE_OF_COVER: "TYPE OF COVER",
  INSURER: "INSURER",
  POLICY_NUMBER: "POLICY NUMBER",
  EFFECTIVE_DATE: "EFFECTIVE DATE",
  EXPIRY_DATE: "EXPIRY DATE",
  CLIENT_PREMIUM: "CLIENT PREMIUM",
  INSURER_COST: "INSURER COST",
  REMARKS: "REMARKS",
  PROJECT: "PROJECT",
};

// Reasonable exact aliases only — every entry is a full-string,
// case-insensitive match against a header cell, never a partial/fuzzy match
// that could guess the wrong column.
const COLUMN_ALIASES: Record<NonMotorStandardColumn, string[]> = {
  PROCESSING_DATE: ["PROCESSING DATE", "DATE"],
  CUSTOMER: ["CUSTOMER", "CLIENT NAME", "CLIENT"],
  TYPE_OF_COVER: ["TYPE OF COVER", "COVER TYPE", "INSURANCE TYPE"],
  INSURER: ["INSURER", "INSURANCE COMPANY"],
  POLICY_NUMBER: ["POLICY NUMBER", "POLICY NO", "POLICY NO."],
  EFFECTIVE_DATE: ["EFFECTIVE DATE", "STARTING DATE"],
  EXPIRY_DATE: ["EXPIRY DATE", "EXPIRY"],
  CLIENT_PREMIUM: ["CLIENT PREMIUM", "CUSTOMER PREMIUM"],
  INSURER_COST: ["INSURER COST", "INSURANCE PREMIUM"],
  REMARKS: ["REMARKS", "NOTES"],
  PROJECT: ["PROJECT"],
};

// A worksheet's header row must contain every one of these to be considered
// usable — PROJECT is the only genuinely optional recognized column (per the
// spec). POLICY_NUMBER/INSURER/REMARKS are required as HEADERS (the template
// always has these columns) but individual row VALUES for them may still be
// blank without being an error — see nonMotorImportPreviewBuilder.ts.
const REQUIRED_HEADER_COLUMNS: NonMotorStandardColumn[] = [
  "PROCESSING_DATE",
  "CUSTOMER",
  "TYPE_OF_COVER",
  "INSURER",
  "POLICY_NUMBER",
  "EFFECTIVE_DATE",
  "EXPIRY_DATE",
  "CLIENT_PREMIUM",
  "INSURER_COST",
  "REMARKS",
];

export type ParsedNonMotorRow = {
  rowNumber: number;
  processingDate: Date | null;
  customerNameRaw: string | null;
  insuranceTypeRaw: string | null;
  insurerName: string | null;
  policyNumber: string | null;
  effectiveDate: Date | null;
  expiryDate: Date | null;
  clientPremium: number | null;
  insurerCost: number | null;
  remarks: string | null;
  projectNameRaw: string | null;
};

export type NonMotorWorkbookParseResult = {
  sheetNames: string[];
  usableSheetFound: boolean;
  sheetName: string | null;
  // Populated only when no sheet qualified — the missing headers from the
  // first sheet inspected, to guide the user toward the standard format.
  missingRequiredColumns: string[];
  totalRowsInSheet: number;
  blankRowsSkipped: number;
  rows: ParsedNonMotorRow[];
};

function textOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function findColumns(headerRow: ExcelJS.Row): Partial<Record<NonMotorStandardColumn, number>> {
  const found: Partial<Record<NonMotorStandardColumn, number>> = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = textOf(cell.value)?.toUpperCase();
    if (!text) return;
    for (const key of Object.keys(COLUMN_ALIASES) as NonMotorStandardColumn[]) {
      if (found[key] !== undefined) continue;
      if (COLUMN_ALIASES[key].includes(text)) found[key] = colNumber;
    }
  });
  return found;
}

export async function parseNonMotorWorkbook(buffer: Buffer): Promise<NonMotorWorkbookParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const sheetNames = workbook.worksheets.map((ws) => ws.name);

  let usableSheet: ExcelJS.Worksheet | null = null;
  let columnIndex: Partial<Record<NonMotorStandardColumn, number>> = {};
  let missingRequiredColumns: string[] = [];

  for (const ws of workbook.worksheets) {
    const found = findColumns(ws.getRow(1));
    const missing = REQUIRED_HEADER_COLUMNS.filter((c) => found[c] === undefined);
    if (missing.length === 0) {
      usableSheet = ws;
      columnIndex = found;
      break;
    }
    if (missingRequiredColumns.length === 0) {
      missingRequiredColumns = missing.map((c) => NON_MOTOR_STANDARD_HEADERS[c]);
    }
  }

  if (!usableSheet) {
    return {
      sheetNames,
      usableSheetFound: false,
      sheetName: null,
      missingRequiredColumns,
      totalRowsInSheet: 0,
      blankRowsSkipped: 0,
      rows: [],
    };
  }

  const get = (row: ExcelJS.Row, col: NonMotorStandardColumn): unknown => {
    const idx = columnIndex[col];
    return idx !== undefined ? row.getCell(idx).value : null;
  };

  const rows: ParsedNonMotorRow[] = [];
  let totalRowsInSheet = 0;
  let blankRowsSkipped = 0;

  usableSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header row

    const customerNameRaw = textOf(get(row, "CUSTOMER"));
    const insuranceTypeRaw = textOf(get(row, "TYPE_OF_COVER"));
    const isBlankRow = !customerNameRaw && !insuranceTypeRaw;
    if (isBlankRow) {
      blankRowsSkipped++;
      return;
    }

    totalRowsInSheet++;
    rows.push({
      rowNumber,
      processingDate: excelValueToDate(get(row, "PROCESSING_DATE")),
      customerNameRaw,
      insuranceTypeRaw,
      insurerName: textOf(get(row, "INSURER")),
      policyNumber: textOf(get(row, "POLICY_NUMBER")),
      effectiveDate: excelValueToDate(get(row, "EFFECTIVE_DATE")),
      expiryDate: excelValueToDate(get(row, "EXPIRY_DATE")),
      clientPremium: parseAmount(get(row, "CLIENT_PREMIUM")),
      insurerCost: parseAmount(get(row, "INSURER_COST")),
      remarks: textOf(get(row, "REMARKS")),
      projectNameRaw: columnIndex.PROJECT !== undefined ? textOf(get(row, "PROJECT")) : null,
    });
  });

  return {
    sheetNames,
    usableSheetFound: true,
    sheetName: usableSheet.name,
    missingRequiredColumns: [],
    totalRowsInSheet,
    blankRowsSkipped,
    rows,
  };
}
