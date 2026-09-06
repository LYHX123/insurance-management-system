import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

// Phase 13A — shared "one worksheet, clean header, download as .xlsx" helper
// for the Customer and Policy list exports. Mirrors the in-memory generation
// style already used by the Ledger export routes (ExcelJS buffer, never
// written to disk). Deliberately plain: no formulas, no totals — these
// exports are operational schedules, not financial reports.

export type ExportColumn = {
  header: string;
  key: string;
  width?: number;
};

export type BuildExportWorkbookOptions = {
  sheetName: string;
  columns: ExportColumn[];
  rows: Array<Record<string, string | number | null | undefined>>;
};

export async function buildExportWorkbookBuffer({ sheetName, columns, rows }: BuildExportWorkbookOptions): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  // Excel caps a sheet name at 31 chars and forbids : \ / ? * [ ].
  const sheet = workbook.addWorksheet(sheetName.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Export");

  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 20 }));
  sheet.getRow(1).font = { bold: true };
  // Freeze the header row and add a filter dropdown, matching the System
  // Ledger export.
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  for (const row of rows) {
    sheet.addRow(columns.map((c) => row[c.key] ?? ""));
  }

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// `Customers-20260906.xlsx` / `Customers-Filtered-20260906.xlsx`.
export function buildExportFilename(base: string, filtered: boolean, now: Date = new Date()): string {
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  return `${base}${filtered ? "-Filtered" : ""}-${stamp}.xlsx`;
}

export function xlsxResponse(buffer: ArrayBuffer, filename: string): NextResponse {
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
