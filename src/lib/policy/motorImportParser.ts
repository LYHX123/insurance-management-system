import ExcelJS from "exceljs";
import { Readable } from "stream";
import { excelValueToDate, parseAmount, normalizeCommissionReceived, parseBalanceCell, type BalanceWarningReason } from "./normalize";

export const MOTOR_SHEET_NAME = "BUSINESS RECORD(MOTOR)";

// Fixed column positions for BUSINESS RECORD(MOTOR) — mapped by position,
// not header text, per the Phase 1A spec (columns I/J and column-position
// 11/16/19 all share a duplicated "DATE"/"INSURANCE PREMIUM" header, so
// header-text lookup alone is ambiguous). EXPECTED_HEADERS below is only
// used as a sanity check that the sheet hasn't been restructured, never as
// the actual lookup key.
const EXPECTED_HEADERS = [
  "DATE", "CLIENT NAME", "TYPE OF COVER", "NUMBER PLATE", "CAR VALUE",
  "INSURANCE COMPANY", "STARTING DATE", "EXPRIY DATE", "INSURANCE PREMIUM",
  "INSURANCE PREMIUM", "DATE", "ACCOUNT PAYABLE", "RECEIPT", "CLIENT PREMIUM",
  "PAYMENT RECEIVED", "DATE", "ACCOUNTS RECEIVABLE", "COMMISSION", "DATE",
  "NET PROFIT", "REMARKS",
];

export type ParsedMotorRow = {
  rowNumber: number;
  processingDate: Date | null;
  customerNameRaw: string | null;
  insuranceType: string | null;
  registrationNumber: string | null;
  vehicleValue: number | null;
  insurerName: string | null;
  effectiveDate: Date | null;
  expiryDate: Date | null;
  insurerCost: number | null;
  amountPaidToInsurer: number | null;
  insurerPaymentDate: Date | null;
  originalInsurerBalance: number | null;
  originalInsurerBalanceRaw: string | null;
  insurerBalanceWarningReason: BalanceWarningReason | null;
  // Column M ("RECEIPT") — inspected and found to hold a sparse Y/N flag
  // (only 40/1,436 rows, concentrated in a narrow row range), not a receipt
  // number/reference despite its header. Carried through as free text into
  // remarks rather than given its own schema field — see the Phase 1A
  // completion report.
  columnMReceiptFlag: string | null;
  clientPremium: number | null;
  amountReceivedFromClient: number | null;
  clientReceiptDate: Date | null;
  originalClientBalance: number | null;
  originalClientBalanceRaw: string | null;
  clientBalanceWarningReason: BalanceWarningReason | null;
  commissionReceived: boolean;
  commissionWasRateValue: boolean;
  commissionReceivedDate: Date | null;
  historicalNetProfit: number | null;
  remarks: string | null;
};

export type WorkbookParseResult = {
  sheetNames: string[];
  motorSheetFound: boolean;
  headerMismatches: { column: number; expected: string; actual: string }[];
  totalRowsInSheet: number;
  blankRowsSkipped: number;
  rows: ParsedMotorRow[];
};

function resultOf(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === "object" && "result" in (v as object)) return (v as { result: unknown }).result;
  return v;
}

function textOf(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export async function parseMotorWorkbook(buffer: Buffer): Promise<WorkbookParseResult> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {});

  const sheetNames: string[] = [];
  let motorSheetFound = false;
  const headerMismatches: { column: number; expected: string; actual: string }[] = [];
  let totalRowsInSheet = 0;
  let blankRowsSkipped = 0;
  const rows: ParsedMotorRow[] = [];

  for await (const wsReader of reader) {
    // exceljs's WorksheetReader has a real runtime `.name` property (set in
    // its constructor) that its own .d.ts doesn't declare — see
    // node_modules/exceljs/lib/stream/xlsx/worksheet-reader.js.
    const ws = wsReader as ExcelJS.stream.xlsx.WorksheetReader & { name: string };
    sheetNames.push(ws.name);
    if (ws.name !== MOTOR_SHEET_NAME) continue;
    motorSheetFound = true;

    let rowNumber = 0;
    for await (const row of ws) {
      rowNumber++;
      const get = (c: number) => resultOf(row.getCell(c).value);
      const getRaw = (c: number) => row.getCell(c).value;

      if (rowNumber === 1) {
        for (let c = 1; c <= EXPECTED_HEADERS.length; c++) {
          const actual = textOf(get(c)) ?? "";
          const expected = EXPECTED_HEADERS[c - 1];
          if (actual.toUpperCase() !== expected.toUpperCase()) {
            headerMismatches.push({ column: c, expected, actual });
          }
        }
        continue;
      }

      totalRowsInSheet++;

      const customerNameRaw = textOf(get(2));
      const insuranceType = textOf(get(3));
      const registrationNumber = textOf(get(4));
      const isBlankRow = !customerNameRaw && !insuranceType && !registrationNumber;
      if (isBlankRow) {
        blankRowsSkipped++;
        continue;
      }

      const insurerBalanceCell = parseBalanceCell(getRaw(12));
      const clientBalanceCell = parseBalanceCell(getRaw(17));

      rows.push({
        rowNumber,
        processingDate: excelValueToDate(get(1)),
        customerNameRaw,
        insuranceType,
        registrationNumber,
        vehicleValue: parseAmount(get(5)),
        insurerName: textOf(get(6)),
        effectiveDate: excelValueToDate(get(7)),
        expiryDate: excelValueToDate(get(8)),
        insurerCost: parseAmount(get(9)),
        amountPaidToInsurer: parseAmount(get(10)),
        insurerPaymentDate: excelValueToDate(get(11)),
        originalInsurerBalance: insurerBalanceCell.parsed,
        originalInsurerBalanceRaw: insurerBalanceCell.raw,
        insurerBalanceWarningReason: insurerBalanceCell.reason,
        columnMReceiptFlag: textOf(get(13)),
        clientPremium: parseAmount(get(14)),
        amountReceivedFromClient: parseAmount(get(15)),
        clientReceiptDate: excelValueToDate(get(16)),
        originalClientBalance: clientBalanceCell.parsed,
        originalClientBalanceRaw: clientBalanceCell.raw,
        clientBalanceWarningReason: clientBalanceCell.reason,
        ...(() => {
          const c = normalizeCommissionReceived(get(18));
          return { commissionReceived: c.received, commissionWasRateValue: c.wasRateValue };
        })(),
        commissionReceivedDate: excelValueToDate(get(19)),
        historicalNetProfit: parseAmount(get(20)),
        remarks: textOf(get(21)),
      });
    }
    totalRowsInSheet = rowNumber - 1; // exclude header
  }

  return { sheetNames, motorSheetFound, headerMismatches, totalRowsInSheet, blankRowsSkipped, rows };
}
