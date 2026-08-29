// Phase 11 — Excel row-height auto-fit for long wrapped text in the merged
// column-E Clause / Excess / Remark / Warranty / Conditions /
// Document-Requirement blocks.
//
// Why this exists: ExcelJS does NOT auto-fit row height, and Excel itself
// only auto-fits the height of a single non-merged cell — a value wrapped
// across a *merged* range keeps whatever explicit heights the merged rows
// happen to have, so long clause text silently overflows behind the next
// section / the Total Premium row / the footer. `wrapText = true` (which the
// template already sets) is not enough on its own.
//
// Phase 10 grew EVERY row in the merge evenly to make the clause fit. That
// pulled the left-hand A-D business rows (Sum Insured / Rate / Premium /
// Gross Premium / PHCF / ITL / Stamp Duty / Total Premium …) up too, so in a
// multi-section quotation (e.g. WIBA + EL) each section's financial rows
// ended up a different height depending on how long its own clause was —
// visually ragged.
//
// Phase 11 fix: the merge range and the merge itself are left completely
// untouched. Within the range, rows are split into
//   - PROTECTED business rows  — real A-D content, section titles, dynamic
//     data rows, and every cell the section config maps a value onto. These
//     keep their template height, always.
//   - FLEXIBLE clause rows      — blank in columns A-D. These are the pure
//     vertical space that belongs to the clause text on the right.
// Only FLEXIBLE rows are ever grown, and only enough that the whole merge
// can hold the wrapped clause text. Sections whose clause already fits are
// left entirely alone, so short clauses stay compact.
//
// Safety rules kept from Phase 10:
//   * clause text is NEVER clipped (if the flexible rows genuinely cannot
//     absorb the deficit they exceed the soft cap rather than clip);
//   * rows are only ever GROWN, never shrunk (targetHeight = max(existing,…));
//   * wrapText / vertical-top on the clause cell are the template's, untouched;
//   * borders / fills / fonts / number formats / column widths / merges /
//     page setup / print area are never touched.
//
// Calibration reference (LibreOffice optimal height, column E width 52.5,
// Times New Roman 11):
//   1 short line (28 ch)               -> 15.0 pt   (single-line height)
//   1 long line  (101 ch, wraps to 2)  -> 26.4 pt
//   5 short lines                      -> 63.6 pt   (~12.7 pt / visual line)
//   EL clause     (9 lines / 232 ch)   -> 114.1 pt
//   Perf. Bond    (10 lines / 516 ch)  -> 163.6 pt
//   WIBA clause   (24 lines / 863 ch)  -> 376.4 pt
//   Marine clause (27 lines / 1128 ch) -> 399.5 pt

import type ExcelJS from "exceljs";
import type { SectionConfig, SectionLayout, TemplateSectionKind } from "./types";
import { getSectionConfig } from "./sectionRegistry";
import { resolveFinalRow } from "./removeUnusedSections";

/** Default Excel row height (pt) when a row has no explicit height. */
const DEFAULT_ROW_HEIGHT_PT = 14.5;

/** Extra vertical breathing room added on top of the pure text estimate (pt). */
const BLOCK_VERTICAL_PADDING_PT = 4;

/**
 * Characters that fit on one wrapped line, per unit of Excel column width.
 * The template body font (Times New Roman 11) is proportional and narrower
 * than the nominal "digit" the width unit is defined against, so a line
 * actually holds slightly MORE characters than the raw width — calibrated
 * against LibreOffice (a 101-char line wraps to exactly 2 rows at width
 * 52.5, i.e. ~55 chars/line -> factor ~1.05).
 */
const CHARS_PER_WIDTH_UNIT = 1.05;
const LINE_CHAR_SAFETY_MARGIN = 2;
/**
 * A line up to this many characters OVER the per-line budget still fits on
 * one visual row (word wrap fills the last few characters that a strict
 * ⌈len / perLine⌉ would push onto a second row). Calibrated so the visual
 * line count matches LibreOffice for the real template clause blocks.
 */
const LINE_WRAP_TOLERANCE_CHARS = 4;

const DEFAULT_FONT_SIZE_PT = 11;

/**
 * A template row baked TALLER than this is a deliberately-sized business row
 * (e.g. a "Total Premium" row at 36.55, WIBA's "Compensation …" row at 46.3,
 * CAR's project-name row at 88) — treat it as protected even if a
 * content/config check somehow missed it. The template's ordinary rows are
 * 15.45 / 15.9 and its blank clause spacers 15–19, so 20 is a safe cut.
 */
const PROTECTED_MIN_TEMPLATE_HEIGHT_PT = 20;

/**
 * Soft cap for a single flexible clause row. The deficit is spread evenly
 * across the flexible rows; a row that would exceed this is capped and its
 * overflow redistributed to the others. Only if EVERY flexible row hits the
 * cap and the clause still would not fit do the flexible rows exceed it
 * (never a business row, never a clipped clause). ~4-5 clause lines.
 */
const MAX_FLEXIBLE_ROW_HEIGHT_PT = 62;

/** Height of one wrapped visual line (pt). LibreOffice renders ~12.7 for
 *  TNR 11; 1.17x the point size (~12.9) keeps a small safety margin without
 *  over-inflating the flexible clause rows. */
function pointsPerVisualLine(fontSizePt: number): number {
  return Math.max(12.9, fontSizePt * 1.19);
}

/** Reads a cell's plain text, flattening rich-text runs; never throws. */
export function readCellText(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null && "richText" in v) {
    const runs = (v as { richText: { text: string }[] }).richText;
    return runs.map((r) => r.text).join("");
  }
  if (typeof v === "object" && v !== null && "text" in v) {
    return String((v as { text: unknown }).text ?? "");
  }
  return String(v);
}

export type EstimateTextHeightInput = {
  text: string;
  /** Total effective width of the (possibly merged) area, in Excel width units. */
  effectiveColumnWidth: number;
  /** Font size in points, if known. Falls back to 11pt. */
  fontSizePt?: number;
  /** Row count the text is allowed to occupy (a merged range's row span). */
  rowSpan: number;
  /** The current summed height of those rows (pt) — the result never goes below this. */
  existingHeight: number;
};

export type EstimateTextHeightResult = {
  estimatedLines: number;
  requiredHeight: number;
  /** max(existingHeight, requiredHeight) — what the block should end up at. */
  targetHeight: number;
};

/** Characters that fit on one wrapped visual line for the given width. */
export function charsPerLine(effectiveColumnWidth: number): number {
  return Math.max(
    12,
    Math.round(effectiveColumnWidth * CHARS_PER_WIDTH_UNIT) - LINE_CHAR_SAFETY_MARGIN
  );
}

/** Visual (wrapped) line count for a block of text at a given width. */
export function countVisualLines(text: string, effectiveColumnWidth: number): number {
  const perLine = charsPerLine(effectiveColumnWidth);
  let lines = 0;
  for (const raw of text.split("\n")) {
    const len = raw.trimEnd().length;
    if (len === 0) {
      lines += 1;
      continue;
    }
    lines += Math.max(1, Math.ceil((len - LINE_WRAP_TOLERANCE_CHARS) / perLine));
  }
  return lines;
}

/**
 * Floor estimate of the total point height a wrapped, possibly multi-line
 * string needs inside a column of `effectiveColumnWidth`.
 *
 *   estimatedLines = Σ over explicit "\n" lines of max(1, ⌈lineLen / charsPerLine⌉)
 *   requiredHeight = estimatedLines × pointsPerVisualLine + padding
 *   targetHeight   = max(existingHeight, requiredHeight)
 */
export function estimateTextHeight(input: EstimateTextHeightInput): EstimateTextHeightResult {
  const fontSizePt = input.fontSizePt && input.fontSizePt > 0 ? input.fontSizePt : DEFAULT_FONT_SIZE_PT;
  const perLine = pointsPerVisualLine(fontSizePt);

  const estimatedLines = countVisualLines(input.text, input.effectiveColumnWidth);
  const requiredHeight = estimatedLines * perLine + BLOCK_VERTICAL_PADDING_PT;
  const targetHeight = Math.max(input.existingHeight, requiredHeight);

  return { estimatedLines, requiredHeight, targetHeight };
}

type SingleColumnMerge = {
  col: number;
  startRow: number;
  endRow: number;
};

/** Parses "E68:E80" -> { col: 5, startRow: 68, endRow: 80 } for single-column merges only. */
function parseSingleColumnMerge(range: string): SingleColumnMerge | null {
  const m = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!m) return null;
  const [, c1, r1, c2, r2] = m;
  if (c1 !== c2) return null;
  const col = columnLettersToNumber(c1);
  const startRow = Number(r1);
  const endRow = Number(r2);
  if (endRow <= startRow) return null;
  return { col, startRow, endRow };
}

function columnLettersToNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function rowNumberOfCell(address: string): number | null {
  const m = address.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/**
 * The final (post-splice) row numbers that this section's config maps a real
 * value, label or dynamic data row onto — every one of these is a business
 * row that must keep its template height regardless of clause length.
 * Derived from the section config + its runtime layout, so it stays correct
 * after removeUnusedSections / fillDynamicRows move rows around.
 */
function configProtectedRows(config: SectionConfig, layout: SectionLayout): Set<number> {
  const rows = new Set<number>();
  const addOriginal = (originalRow: number | null) => {
    if (originalRow != null) rows.add(resolveFinalRow(config, layout, originalRow));
  };

  for (const sv of config.staticVariables) addOriginal(rowNumberOfCell(sv.cell));
  for (const fc of config.formulaCells ?? []) addOriginal(rowNumberOfCell(fc));
  for (const bl of config.boldLabelCells ?? []) addOriginal(rowNumberOfCell(bl));

  // Section title (config.startRow is a leading spacer for every section
  // except CAR; the title is on startRow or startRow+1).
  addOriginal(config.startRow);
  addOriginal(config.startRow + 1);

  // Dynamic data rows + their block labels + the fixed "Total" row.
  if (layout.dynamicDataStartRow != null && layout.dynamicDataEndRow != null) {
    for (let r = layout.dynamicDataStartRow; r <= layout.dynamicDataEndRow; r++) rows.add(r);
  }
  if (layout.dynamicTotalRow != null) rows.add(layout.dynamicTotalRow);

  return rows;
}

/** True if any of columns A-D on this row carries a real value. */
function hasBusinessContent(worksheet: ExcelJS.Worksheet, rowNumber: number): boolean {
  const row = worksheet.getRow(rowNumber);
  for (let c = 1; c <= 4; c++) {
    const v = row.getCell(c).value as unknown;
    if (v === null || v === undefined || v === "") continue;
    // A shared-formula slave with no own formula/result would read as an
    // object with only { sharedFormula } — treat that as empty. Anything
    // else (string, number incl. 0, formula, richText, hyperlink) counts.
    if (
      typeof v === "object" &&
      v !== null &&
      "sharedFormula" in v &&
      !("formula" in v) &&
      !("result" in v) &&
      !("richText" in v)
    ) {
      continue;
    }
    return true;
  }
  return false;
}

type MergeClassification = {
  flexibleRows: number[];
  currentTotalHeight: number;
};

function classifyMergeRows(
  worksheet: ExcelJS.Worksheet,
  merge: SingleColumnMerge,
  config?: SectionConfig,
  layout?: SectionLayout
): MergeClassification {
  const cfgProtected = config && layout ? configProtectedRows(config, layout) : new Set<number>();
  const flexibleRows: number[] = [];
  let currentTotalHeight = 0;

  for (let r = merge.startRow; r <= merge.endRow; r++) {
    const h = worksheet.getRow(r).height ?? DEFAULT_ROW_HEIGHT_PT;
    currentTotalHeight += h;
    const isProtected =
      hasBusinessContent(worksheet, r) ||
      cfgProtected.has(r) ||
      h > PROTECTED_MIN_TEMPLATE_HEIGHT_PT;
    if (!isProtected) flexibleRows.push(r);
  }

  return { flexibleRows, currentTotalHeight };
}

/**
 * Adds `deficit` pt of height across `flexibleRows`, spread evenly, each row
 * soft-capped at MAX_FLEXIBLE_ROW_HEIGHT_PT with the overflow redistributed
 * to the rows still under the cap. If every flexible row reaches the cap and
 * height is still owed, the remainder is spread evenly across all the
 * flexible rows anyway (they exceed the cap) — never a business row, never a
 * clipped clause.
 */
function growFlexibleRows(worksheet: ExcelJS.Worksheet, flexibleRows: number[], deficit: number): void {
  const heights = new Map<number, number>();
  for (const r of flexibleRows) heights.set(r, worksheet.getRow(r).height ?? DEFAULT_ROW_HEIGHT_PT);

  let owed = deficit;
  const uncapped = new Set(flexibleRows);
  let guard = flexibleRows.length + 2;

  while (owed > 0.5 && uncapped.size > 0 && guard-- > 0) {
    const share = owed / uncapped.size;
    let consumed = 0;
    for (const r of [...uncapped]) {
      const cur = heights.get(r)!;
      const room = MAX_FLEXIBLE_ROW_HEIGHT_PT - cur;
      if (room <= 0.01) {
        uncapped.delete(r);
        continue;
      }
      const add = Math.min(share, room);
      heights.set(r, cur + add);
      consumed += add;
      if (heights.get(r)! >= MAX_FLEXIBLE_ROW_HEIGHT_PT - 0.01) uncapped.delete(r);
    }
    owed -= consumed;
    if (consumed < 0.01) break;
  }

  // Every flexible row is at the soft cap and the clause still would not fit
  // — let the flexible rows exceed the cap rather than clip or touch a
  // business row. (Does not happen for any real template section's clause.)
  if (owed > 0.5 && flexibleRows.length > 0) {
    const extra = owed / flexibleRows.length;
    for (const r of flexibleRows) heights.set(r, heights.get(r)! + extra);
  }

  for (const [r, h] of heights) worksheet.getRow(r).height = round2(h);
}

/**
 * Grows the FLEXIBLE (blank-in-A-D) rows of every multi-row single-column
 * Clause/Excess/Remark merge just enough that its wrapped text fits. Call
 * this LAST — after all row splicing, dynamic-row fills and variable
 * substitution — so the merge ranges, row contents and heights are final.
 *
 * `layouts` (from removeUnusedSections) lets each merge be matched to its
 * owning section so config-mapped business rows are protected even when a
 * value happens to resolve to blank. Without it (standalone use / tests) the
 * classification falls back to pure A-D content inspection.
 *
 * Returns the addresses of merges whose flexible rows were grown.
 */
export function autoFitMergedTextHeights(
  worksheet: ExcelJS.Worksheet,
  layouts?: Map<TemplateSectionKind, SectionLayout>
): string[] {
  const grown: string[] = [];
  const merges: string[] = (worksheet.model as { merges?: string[] }).merges ?? [];

  for (const range of merges) {
    const parsed = parseSingleColumnMerge(range);
    if (!parsed) continue;

    const masterCell = worksheet.getCell(parsed.startRow, parsed.col);
    const text = readCellText(masterCell);
    // Only real paragraphs — a short label in a tall merge is never the
    // overflow problem this guards against.
    if (text.length < 24 && !text.includes("\n")) continue;

    let config: SectionConfig | undefined;
    let layout: SectionLayout | undefined;
    if (layouts) {
      for (const l of layouts.values()) {
        const end = l.excessColumnEndRow ?? l.endRow;
        if (parsed.startRow >= l.startRow && parsed.startRow <= end) {
          layout = l;
          config = getSectionConfig(l.kind);
          break;
        }
      }
      // A single-column merge that no section owns is the footer's, not a
      // clause block — leave it alone.
      if (!layout) continue;
    }

    const { flexibleRows, currentTotalHeight } = classifyMergeRows(worksheet, parsed, config, layout);

    const effectiveColumnWidth = worksheet.getColumn(parsed.col).width ?? 8.43;
    const fontSizePt =
      (masterCell.font && typeof masterCell.font.size === "number" ? masterCell.font.size : undefined) ??
      DEFAULT_FONT_SIZE_PT;

    const { requiredHeight } = estimateTextHeight({
      text,
      effectiveColumnWidth,
      fontSizePt,
      rowSpan: parsed.endRow - parsed.startRow + 1,
      existingHeight: 0,
    });

    if (requiredHeight <= currentTotalHeight + 0.5) continue; // already fits — leave every row alone

    const deficit = requiredHeight - currentTotalHeight;

    if (flexibleRows.length === 0) {
      // No blank rows to absorb the clause (should not happen for any real
      // template section) — spread across every row rather than clip.
      const span = parsed.endRow - parsed.startRow + 1;
      const perRow = deficit / span;
      for (let r = parsed.startRow; r <= parsed.endRow; r++) {
        const row = worksheet.getRow(r);
        row.height = round2((row.height ?? DEFAULT_ROW_HEIGHT_PT) + perRow);
      }
    } else {
      growFlexibleRows(worksheet, flexibleRows, deficit);
    }

    grown.push(range);
  }

  return grown;
}
