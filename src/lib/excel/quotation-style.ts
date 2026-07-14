import type { Cell, Column, Row, Worksheet } from "exceljs";

// Centralized style constants so quotation-export.ts (and any future sheet)
// reads like a layout description, not a pile of ExcelJS style literals.

export const BRAND_DARK_GREEN = "FF1B5E20";
export const HEADER_TEXT_COLOR = "FFFFFFFF";

export const MONEY_FORMAT = "#,##0.00";
// Our rate values are already stored as the percentage number itself (e.g.
// 0.45 means "0.45%"), not a 0–1 fraction — so we append a literal "%" via
// a quoted format token instead of Excel's "%" code, which would multiply
// the underlying value by 100 and display "45.00%" instead of "0.45%".
export const PERCENT_LITERAL_FORMAT = '0.00"%"';
export const DATE_FORMAT = "dd mmm yyyy";

export const THIN_BORDER = {
  top: { style: "thin" as const },
  left: { style: "thin" as const },
  bottom: { style: "thin" as const },
  right: { style: "thin" as const },
};

export function applyTitleStyle(cell: Cell) {
  cell.font = { size: 24, bold: true };
  cell.alignment = { horizontal: "center", vertical: "middle" };
}

export function applySectionHeadingStyle(cell: Cell) {
  cell.font = { size: 14, bold: true, color: { argb: BRAND_DARK_GREEN } };
}

export function applyLabelStyle(cell: Cell) {
  cell.font = { bold: true };
}

export function applyTableHeaderStyle(cell: Cell) {
  cell.font = { bold: true, color: { argb: HEADER_TEXT_COLOR } };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: BRAND_DARK_GREEN },
  };
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.border = THIN_BORDER;
}

export function applyBodyCellStyle(cell: Cell) {
  cell.border = THIN_BORDER;
  cell.alignment = { vertical: "middle", wrapText: true };
}

export function applyMoneyCellStyle(cell: Cell) {
  cell.border = THIN_BORDER;
  cell.numFmt = MONEY_FORMAT;
  cell.alignment = { horizontal: "right", vertical: "middle" };
}

export function applyPercentCellStyle(cell: Cell) {
  cell.border = THIN_BORDER;
  cell.numFmt = PERCENT_LITERAL_FORMAT;
  cell.alignment = { horizontal: "right", vertical: "middle" };
}

export function applyTotalLabelStyle(cell: Cell) {
  cell.font = { bold: true };
  cell.alignment = { horizontal: "right", vertical: "middle" };
}

export function applyGrandTotalCellStyle(cell: Cell) {
  cell.font = { bold: true, size: 12 };
  cell.numFmt = MONEY_FORMAT;
  cell.alignment = { horizontal: "right", vertical: "middle" };
  cell.border = THIN_BORDER;
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE8F5E9" },
  };
}

// Auto-fits every column on the sheet to its widest cell's rendered text,
// bounded so a single long clause paragraph can't blow out the layout.
export function autoFitColumns(worksheet: Worksheet, minWidth = 10, maxWidth = 60) {
  worksheet.columns.forEach((column: Partial<Column>) => {
    let maxLength = minWidth;
    column.eachCell?.({ includeEmpty: true }, (cell: Cell) => {
      const value = cell.value;
      const text = value === null || value === undefined ? "" : String(value);
      const longestLine = text.split("\n").reduce((max, line) => Math.max(max, line.length), 0);
      maxLength = Math.max(maxLength, longestLine + 2);
    });
    column.width = Math.min(maxLength, maxWidth);
  });
}

export function setRowBorder(row: Row, fromCol: number, toCol: number) {
  for (let col = fromCol; col <= toCol; col++) {
    row.getCell(col).border = THIN_BORDER;
  }
}
