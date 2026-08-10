// Font-size normalization confirmed by direct inspection of a generated
// workbook: most sections' own "Total Premium" cell already renders at the
// same size as its sibling Gross premium/PHCF/ITL/Stamp Duty rows (12pt),
// but at least one section's template cell (Fire & Perils) is baked in at
// 14pt — a template authoring inconsistency, not something any section
// should have on purpose. setBoldCellValue only ever forces bold, it never
// touches size, so nothing before this normalized it.
//
// The workbook's own dominant body size (12pt, confirmed across every
// other subtotal row) is the reference every section's own Total Premium
// cell is normalized to — never hardcoded per section, so this applies
// uniformly regardless of which sections a given quotation selects.
import type ExcelJS from "exceljs";

export const SECTION_SUBTOTAL_FONT_SIZE = 12;

/** The final report's single grand-total row must stay visually more prominent than any one section's own subtotal. */
export const GRAND_TOTAL_FONT_SIZE = 14;

function setFontSize(cell: ExcelJS.Cell, size: number, bold: boolean): void {
  cell.style = { ...cell.style };
  cell.font = { ...cell.font, size, bold };
}

/** Normalizes one section's own Total Premium cell down to the workbook's standard subtotal size, keeping it bold. */
export function normalizeSectionTotalFontSize(cell: ExcelJS.Cell): void {
  setFontSize(cell, SECTION_SUBTOTAL_FONT_SIZE, true);
}

/** Bumps a grand-total row's cells (label + amount) up to the prominent size, keeping them bold. */
export function applyGrandTotalFontSize(cell: ExcelJS.Cell): void {
  setFontSize(cell, GRAND_TOTAL_FONT_SIZE, true);
}
