// Phase 9 — WIBA / CPM Schedule Import. Header/cell text normalization used
// only to (a) confirm a workbook is genuinely the expected WIBA or CPM
// template (never to remap columns — actual data extraction is by fixed
// column position, matching the real templates' inspected structure, and
// this project's existing convention in src/lib/policy/motorImportParser.ts
// for exactly the same reason: several real-world sheets have ambiguous or
// duplicated header text), and (b) recognize the TOTAL/footer row and skip
// it as data.

import type ExcelJS from "exceljs";

// Excel header cells in both real templates are bilingual richText (English
// line + Chinese line in one cell, e.g. "Occupation\n员工的职业（工种）").
// Plain strings/numbers pass through unchanged; richText is flattened by
// concatenating every run's own text.
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray((value as { richText: unknown }).richText)) {
      return (value as { richText: { text?: string }[] }).richText.map((run) => run.text ?? "").join("");
    }
    // A formula cell's already-computed result (never trusted as the
    // authoritative value for numeric business fields — see
    // cellFormulaResult below — but header cells are never formulas, this
    // is just defensive).
    if ("result" in value) return cellText((value as { result: ExcelJS.CellValue }).result);
    if ("text" in value) return String((value as { text: unknown }).text ?? "");
  }
  return String(value);
}

// trim + collapse internal whitespace (including the literal newline inside
// bilingual header cells) + lowercase — exactly the "trim, normalize
// whitespace, case-insensitive" rule this phase's spec asks for.
export function normalizeHeader(value: ExcelJS.CellValue): string {
  return cellText(value)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// A cell counts as a TOTAL/footer marker if its normalized text is exactly
// one of these — deliberately an exact match (not "contains total"), so a
// genuine occupation/equipment name that happens to contain the word
// "total" is never misclassified as a footer.
const FOOTER_MARKERS = new Set(["total", "total sum", "grand total", "合计", "总计"]);

export function isFooterMarkerText(value: ExcelJS.CellValue): boolean {
  return FOOTER_MARKERS.has(normalizeHeader(value));
}

// The value actually used for numeric business fields (Basic Salary,
// Quantity, etc.) — a plain number/string cell passes through, but a
// formula cell's `result` is intentionally never read here for anything
// that feeds a calculation (see wibaParser.ts/cpmParser.ts: only raw
// user-entered cells — never columns G/H for WIBA or F for CPM — are ever
// passed to this). This helper exists only for the rare case a raw input
// cell was itself accidentally saved as a formula; it is not how this
// module satisfies "never trust Excel's calculated values" — that
// guarantee comes from which COLUMNS are read, not from this function.
export function rawCellValue(value: ExcelJS.CellValue): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "result" in value) {
    const result = (value as { result: ExcelJS.CellValue }).result;
    if (typeof result === "number") return result;
    if (typeof result === "string") return result;
    return null;
  }
  return null;
}

export function isBlankCell(value: ExcelJS.CellValue): boolean {
  const raw = rawCellValue(value);
  return raw === null || (typeof raw === "string" && raw.trim() === "");
}
