// Shared types for the quotation Excel template engine. Row numbers in this
// module always mean "original template row numbers" (as inspected in
// templates/quotation/quotation template.xlsx) unless explicitly documented
// as "final"/post-mutation — see removeUnusedSections.ts for the bottom-to-
// top row-shift algorithm that turns original rows into final rows.

export type TemplateSectionKind =
  | "CAR_PACKAGE"
  | "WIBA"
  | "EMPLOYERS_LIABILITY"
  | "CPM_STANDALONE"
  | "PUBLIC_LIABILITY"
  | "FIRE_AND_PERILS"
  | "BURGLARY"
  | "GIT_SINGLE"
  | "GIT_ANNUAL"
  | "MARINE_COVER"
  | "MOTOR_COMP_PRIVATE"
  | "MOTOR_COMP_COMMERCIAL"
  | "MOTOR_TPO_PRIVATE"
  | "MOTOR_TPO_COMMERCIAL"
  | "GROUP_PERSONAL_ACCIDENT"
  | "GROUP_MEDICAL"
  | "TENDER_SECURITY"
  | "PERFORMANCE_BOND"
  | "ADVANCE_PAYMENT_GUARANTEE"
  | "CUSTOMS_BOND";

export type TemplateColumn = "A" | "B" | "C" | "D" | "E";

// How a placeholder's value must be written into the cell:
// - "money": raw numeric value, existing cell numFmt (thousand separators) preserved
// - "rate": app convention is "0.25 means 0.25%" but the template cell is
//   %-formatted, so the value written must be divided by 100 first
// - "integer": whole number, no formatting conversion
// - "text": string, preserving embedded line breaks
// - "date": a real Excel date (JS Date), not a formatted string
export type PlaceholderKind = "money" | "rate" | "integer" | "text" | "date";

export type StaticVariable = {
  /** Placeholder name without the surrounding {{ }}. */
  name: string;
  /** Original template cell address, e.g. "D36". */
  cell: string;
  kind: PlaceholderKind;
  /** True if generation must fail when this value is missing for a selected section. */
  required: boolean;
  /**
   * Literal static text immediately before/after this placeholder's token
   * (exact match, as it appears in the template) that is semantically part
   * of the VALUE rather than a label — e.g. the " months" in "CONTRACT
   * PERIOD: {{car_construction_period_months}} months", or the "Employees"
   * suffix (no separating colon) in "{{medical_employee_count}} Employees".
   * Only meaningful for placeholders embedded in a larger literal-text
   * cell (see replaceVariables.ts) — when present, this text is bolded
   * together with the substituted value instead of staying at the cell's
   * normal weight. Never set for cells with no attached unit (a plain
   * label like "Number Plate: {{motor_plate_no}}" needs neither).
   */
  unitPrefix?: string;
  unitSuffix?: string;
  /**
   * Explicit Excel number format to force onto this cell before writing a
   * "rate" value, e.g. "0.##%" — only set when the template cell's own
   * number format cannot be trusted to already be a percentage format (see
   * CPM_STANDALONE's cpm_rate/cpm_pvt_loading_rate in config.ts, whose
   * cells were plain/unformatted, causing 0.75 to render as the raw
   * fraction "0.0075" instead of "0.75%"). Leave unset for every other rate
   * variable — those template cells are already %-formatted correctly, and
   * forcing a format here would override the template author's own choice
   * (e.g. CAR's "0.000%" pattern) for no reason.
   */
  numFmt?: string;
};

export type DynamicRowColumn = {
  column: TemplateColumn;
  name: string;
  kind: PlaceholderKind;
  /**
   * Which physical row within one repeating block this placeholder lives on
   * (0-based, relative to the block's first row). Only meaningful when
   * `rowsPerEntry` > 1 — defaults to 0 (the block's own first/only row) when
   * omitted, which is every section's actual behavior today.
   */
  rowOffset?: number;
  /**
   * Explicit Excel number format to force onto this cell before writing —
   * same purpose/caveats as StaticVariable.numFmt (see its doc comment).
   * Leave unset unless the template cell's own number format cannot be
   * trusted (e.g. Marine's marine_rate needs "0.##%" — its template cell is
   * "0.0000%", which would print trailing zeros like "0.2500%" instead of
   * "0.25%").
   */
  numFmt?: string;
};

export type DynamicRowConfig = {
  /** The first row of the template's one repeating block (its only row, unless rowsPerEntry > 1). */
  templateRow: number;
  /** First reserved-but-blank row after the template block (templateRow + rowsPerEntry if capacity is 0). */
  firstBlankRow: number;
  /** Last reserved blank row (inclusive) before the fixed "Total" row. */
  lastBlankRow: number;
  /** The fixed row (e.g. "Total") immediately after the reserved capacity. Undefined if none. */
  totalRow?: number;
  /** Per-column placeholder mapping for one repeating data entry. */
  columns: DynamicRowColumn[];
  /**
   * Number of physical Excel rows that make up ONE logical data entry.
   * Defaults to 1 (every section except Marine). When > 1, each `columns[]`
   * entry's `rowOffset` selects which physical row of the block it belongs
   * on, and `blockLabels` (below) supplies any static label text that must
   * be re-written into every repeated block beyond the first — the
   * template's own reserved blank rows start out fully empty after row
   * splicing, so a label baked into the template's first block (e.g.
   * "Incidental Loading (10%)") is not automatically present in block 2+.
   */
  rowsPerEntry?: number;
  /** Static (non-placeholder) label cells to (re-)write into every repeated block instance. Only meaningful when rowsPerEntry > 1. */
  blockLabels?: { column: TemplateColumn; rowOffset: number; text: string }[];
};

export type SectionConfig = {
  kind: TemplateSectionKind;
  displayName: string;
  displayNameZh: string;
  /** 1-20, the fixed selector/output order from the Phase 2B spec. */
  outputOrder: number;
  /** Inclusive, original template row numbers. endRow is the row just before the next section's title row. */
  startRow: number;
  endRow: number;
  /** Row holding the section's own subtotal/tax block start (first "Gross premium" row), for readability only. */
  staticVariables: StaticVariable[];
  dynamicRow?: DynamicRowConfig;
  /** Placeholder name that represents this section's grand total (feeds the workbook total). */
  summaryTotalVariable: string;
  /** Template cells containing native Excel formulas that must be overwritten with static computed values. */
  formulaCells?: string[];
  /**
   * Template cells holding literal static text (not a {{placeholder}}) that
   * must render bold — replaceVariables.ts only ever bolds a cell it
   * actually writes a value into, so a fixed label like CPM's "TOTAL VALUE"
   * (which sits beside placeholder cells that DO turn bold automatically)
   * needs to be listed here explicitly to match.
   */
  boldLabelCells?: string[];
  /**
   * Original end row of this section's column-E "excess/clauses" merge
   * (start row is always == startRow). Only set for sections whose merge
   * spans across a dynamic-row region — i.e. the 4 dynamic sections — since
   * only those need the merge unmerged/re-merged when the actual row count
   * differs from the template's reserved capacity. Non-dynamic sections'
   * merges never need adjustment: they're either kept entirely as-is or
   * removed entirely along with the whole section.
   */
  excessMergeEndRow?: number;
  notes?: string[];
};

export type TemplateConfig = {
  templateRelativePath: string;
  sheetName: string;
  /** Common, document-level placeholders that exist in the template today. */
  commonVariables: StaticVariable[];
  /** Common variables the spec asked for that do NOT exist in this template — reported, never invented. */
  missingCommonVariables: string[];
  grandTotalVariable: string;
  grandTotalCell: string;
  sections: SectionConfig[];
  /**
   * The printed quotation table's outer edge, in ORIGINAL template
   * coordinates — used to redraw a continuous outer border after row
   * deletion/insertion may have broken it. Row 1 holds only the header
   * drawing (logo + company text box) and carries no cell border in the
   * template, so the bordered area's top edge starts at row 2. The last row
   * is not fixed — it must be read from the worksheet at generation time
   * (see applyOuterBorder.ts) because it shifts with whichever sections/
   * dynamic rows end up in the final workbook.
   */
  contentAreaFirstRow: number;
  contentAreaFirstCol: number;
  contentAreaLastCol: number;
};

// ---- Runtime layout (computed after row removal / dynamic-row sizing) ----

export type SectionLayout = {
  kind: TemplateSectionKind;
  /**
   * Row offset applied to every original row at-or-before this section's
   * own dynamic region (or the whole section, if it has none) — i.e. the
   * cumulative delta contributed by every operation that was originally
   * ABOVE this section. Add this to any original row number that sits at
   * or before dynamicRow.lastBlankRow (or any row, for sections with no
   * dynamic region) to get its final row.
   */
  rowOffset: number;
  /**
   * This section's OWN dynamic-row count delta (actual data rows minus
   * template capacity; 0 if no dynamic region or no change). Original rows
   * AFTER dynamicRow.lastBlankRow need rowOffset + dynamicDelta added, not
   * just rowOffset, since they sit below this section's own insertion/
   * deletion point too.
   */
  dynamicDelta: number;
  /** Final inclusive row range for this section (for reference/logging). */
  startRow: number;
  endRow: number;
  /** Final row of the one templated dynamic row, if this section has one. */
  dynamicTemplateRow?: number;
  /** Final first/last row actually holding data rows (after insertion/removal), if dynamic. */
  dynamicDataStartRow?: number;
  dynamicDataEndRow?: number;
  dynamicTotalRow?: number;
};

export type GeneratedWorkbookResult = {
  buffer: Buffer;
  filename: string;
  warnings: string[];
};
