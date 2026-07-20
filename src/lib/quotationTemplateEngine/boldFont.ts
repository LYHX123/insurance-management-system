// The one place bold styling is applied to values the template engine
// writes. Every write site (replaceVariables.ts, fillDynamicRows.ts,
// generateQuotationExcel.ts) goes through setBoldCellValue/boldFont
// instead of touching cell.value or cell.font directly for a written
// value, so "every engine-written value is bold" lives in exactly one
// place — no per-section or per-insurance-type bold logic anywhere else.
// Static template text (labels, headers, clause text) is never touched
// here, since these helpers only ever run at the moment a real value is
// being written.

import type ExcelJS from "exceljs";

/** Returns a copy of a font with bold forced on, preserving every other attribute (family, size, color, italic, underline, ...). */
export function boldFont(font: Partial<ExcelJS.Font> | undefined): Partial<ExcelJS.Font> {
  return { ...font, bold: true };
}

/**
 * Sets a cell's entire value and makes its font bold, preserving every
 * other style already on the cell (border, fill, alignment, number
 * format, ...). Use this whenever the WHOLE cell is the written value
 * (dynamic-row cells, pure-placeholder cells, footer/header totals) — not
 * for cells where a value is embedded inside surrounding static text
 * (see replaceVariables.ts's rich-text handling for that case, since only
 * the substituted run should go bold there, not the static label sharing
 * the cell).
 *
 * ExcelJS gives cells that had identical formatting in the loaded
 * template the SAME shared `cell.style` object reference (a loading
 * optimization) — `cell.font = x` sets a property on that shared object,
 * so without decoupling first, bolding one cell silently bolds every
 * other unrelated cell that happened to share its original style
 * (confirmed: every cell across this template with the plain default
 * "Times New Roman 12" style shares one reference). Replacing
 * cell.style with a shallow copy of itself before touching font gives
 * this cell its own independent style object, so the mutation can no
 * longer leak to any other cell.
 */
export function setBoldCellValue(cell: ExcelJS.Cell, value: ExcelJS.CellValue): void {
  cell.value = value;
  if (value === null || value === undefined || value === "") return;
  cell.style = { ...cell.style };
  cell.font = boldFont(cell.font);
}
