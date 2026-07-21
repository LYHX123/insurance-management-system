// Machine-readable configuration for templates/quotation template.xlsx,
// built entirely from a manual cell-by-cell inspection of the committed
// workbook (see the Phase 3A inspection report). Every row number and
// placeholder name here was read directly from the file — nothing was
// guessed. This is the ONLY place row numbers are allowed to be hardcoded;
// every other module in this engine must go through sectionRegistry.ts.
//
// Known template quirks (see notes[] below and the Phase 3A report for the
// full write-up):
// - {{CUSTOMER_NAME}} is the only uppercase placeholder in the workbook.
// - customer_pin / quotation_no / quotation_date / valid_until /
//   insurer_name / currency / prepared_by do not exist anywhere in the
//   template — see missingCommonVariables.
// - All four Motor sections reuse the exact same placeholder names
//   ({{motor_plate_no}}, {{motor_gross_premium}}, ...) in different row
//   ranges. Performance Bond and APG both reuse {{guarantee_*}} names in
//   different row ranges too, and unlike Motor, both CAN be selected in the
//   same quotation. replaceVariables.ts MUST scope substitution to each
//   section's own row range — never a sheet-wide find/replace.
// - D184 (GIT Single, row labeled "Gross premium") holds
//   {{git_total_sum_insured}} instead of an expected {{git_gross_premium}}
//   (which already exists, correctly, at D178). Filled literally as named.
// - CPM's dynamic row (row 84) is a two-column repeating pattern:
//   {{cpm_equipment}} (equipment name + 3 spaces + quantity) and
//   {{cpm_total_value}} (that equipment's own quantity x unitValue). The
//   template used to also carry orphaned {{cpm_quantity}}/{{cpm_unit_value}}
//   placeholders on rows 85/86 that never formed a real repeating grid —
//   removed from the template; nothing in this engine ever wrote to them.
// - B74 (`=D62`) and D76 (`=D74`) in Employer's Liability are native Excel
//   formulas that read WIBA's own cells. Because WIBA's payroll rows are a
//   dynamic region, WIBA's row 62 will move whenever the actual payroll row
//   count differs from the reserved 17 — which is the common case — so
//   these two formulas would silently point at the wrong cell after row
//   splicing. They are overwritten with static computed values instead of
//   being left as live formulas. B30 (`SUM(B9:B29)`, CAR) sums together
//   values of different business meaning (contract value + CPM value + TPL
//   limits) and is never referenced elsewhere; left untouched.
// - Motor's Period From/To and Medical's per-category rate cells are
//   embedded inside larger text-sentence cells alongside fixed literal
//   text ("Period: ... - ...") rather than being dedicated date/money-only
//   cells, so they are written as formatted strings substituted into that
//   text rather than as native Excel date values.
// - Medical's per-category "rate" placeholders are a flat KES amount per
//   employee (not a percentage), unlike every other section's rate
//   placeholders — classified as `kind: "money"`, not `kind: "rate"`, so no
//   /100 conversion is applied to them.
//
// Section boundary (startRow/endRow) ownership convention:
// Every section in the pristine template is followed by exactly one blank
// spacer row before the next section's title (Public Liability -> Fire is
// the one exception, with two — see PUBLIC_LIABILITY's notes[]). That
// spacer row is owned by the FOLLOWING section's startRow, never the
// preceding section's endRow — i.e. every section's endRow is its own true
// last content row (never a trailing blank row), and every non-first
// section's startRow is one row earlier than its own title row (claiming
// the spacer as leading padding). This is deliberate: removeUnusedSections.ts
// deletes a section's entire [startRow,endRow] range when it's not
// selected, so a spacer row must be deleted together with whichever section
// would otherwise leave it dangling — which is only correct if the spacer
// belongs to the section that comes AFTER it. Getting this backwards (spacer
// owned by the preceding section) is exactly what caused a stray blank row
// to appear before the "TOTAL PREMIUM (KES)" footer whenever the last
// SELECTED section wasn't Customs Bond (the one section with no trailing
// spacer, since nothing physically follows it but the footer) — the
// preceding section's own spacer row survived (it was inside a kept
// section's range) with nothing left to delete it. CAR_PACKAGE (first
// section) has no predecessor, so its startRow is unchanged; CUSTOMS_BOND
// (last section, no trailing spacer in the template at all) has an
// unchanged endRow.

import type { SectionConfig, StaticVariable, TemplateConfig } from "./types";

function sv(
  name: string,
  cell: string,
  kind: StaticVariable["kind"],
  required = false,
  unit?: { prefix?: string; suffix?: string }
): StaticVariable {
  return { name, cell, kind, required, unitPrefix: unit?.prefix, unitSuffix: unit?.suffix };
}

const CAR_PACKAGE: SectionConfig = {
  kind: "CAR_PACKAGE",
  displayName: "CAR Package",
  displayNameZh: "建筑工程一切险（CAR）组合",
  outputOrder: 1,
  startRow: 5,
  endRow: 36,
  staticVariables: [
    sv("project_name", "A8", "text"),
    sv("car_contract_value", "B9", "money", true),
    sv("car_rate", "C9", "rate", true),
    sv("car_premium", "D9", "money", true),
    sv("car_construction_period_months", "A10", "integer", true, { suffix: " months" }),
    sv("car_maintenance_period_months", "A11", "integer", true, { suffix: " months" }),
    sv("cpm_value", "B14", "money"),
    sv("cpm_rate", "C14", "rate"),
    sv("cpm_premium", "D14", "money"),
    sv("tpl_any_one_claim", "B20", "money"),
    sv("tpl_any_one_event", "B21", "money"),
    sv("tpl_any_one_period", "B22", "money"),
    sv("tpl_rate", "C22", "rate"),
    sv("tpl_premium", "D22", "money"),
    sv("car_pvt_loading_amount", "B24", "money"),
    sv("car_pvt_loading_rate", "C24", "rate"),
    sv("car_pvt_loading_premium", "D24", "money"),
    sv("car_gross_premium", "D32", "money", true),
    sv("car_phcf", "D33", "money", true),
    sv("car_itl", "D34", "money", true),
    sv("car_stamp_duty", "D35", "money", true),
    sv("car_total_premium", "D36", "money", true),
  ],
  summaryTotalVariable: "car_total_premium",
  notes: ["B30 SUM(B9:B29) sums dissimilar values (contract value + CPM value + TPL limits) — left untouched, not referenced elsewhere."],
};

const WIBA: SectionConfig = {
  kind: "WIBA",
  displayName: "WIBA",
  displayNameZh: "工伤赔偿保险（WIBA）",
  outputOrder: 2,
  startRow: 37,
  endRow: 66,
  staticVariables: [
    sv("wiba_employee_count", "A41", "integer", true, { suffix: " employees" }),
    sv("wiba_total_wages", "B60", "money", true),
    sv("wiba_rate", "C60", "rate", true),
    sv("wiba_gross_premium", "D60", "money", true),
    sv("wiba_gross_premium", "D62", "money", true),
    sv("wiba_phcf", "D63", "money", true),
    sv("wiba_itl", "D64", "money", true),
    sv("wiba_stamp_duty", "D65", "money", true),
    sv("wiba_total_premium", "D66", "money", true),
  ],
  dynamicRow: {
    templateRow: 43,
    firstBlankRow: 44,
    lastBlankRow: 59,
    totalRow: 60,
    columns: [
      { column: "A", name: "wiba_occupation", kind: "text" },
      { column: "B", name: "wiba_annual_wages", kind: "money" },
    ],
  },
  summaryTotalVariable: "wiba_total_premium",
  excessMergeEndRow: 66,
};

const EMPLOYERS_LIABILITY: SectionConfig = {
  kind: "EMPLOYERS_LIABILITY",
  displayName: "Employer's Liability",
  displayNameZh: "雇主责任险",
  outputOrder: 3,
  startRow: 67,
  endRow: 80,
  staticVariables: [
    sv("el_gross_premium", "D74", "money", true),
    sv("el_phcf", "D77", "money", true),
    sv("el_itl", "D78", "money", true),
    sv("el_stamp_duty", "D79", "money", true),
    sv("el_total_premium", "D80", "money", true),
  ],
  formulaCells: ["B74", "D76"],
  summaryTotalVariable: "el_total_premium",
  notes: ["B70/B71/B72 (Any One Person/Occurrence/Year limits) are hardcoded literals in the template, not placeholders — never written."],
};

const CPM_STANDALONE: SectionConfig = {
  kind: "CPM_STANDALONE",
  displayName: "Standalone CPM",
  displayNameZh: "独立工程机械险（CPM）",
  outputOrder: 4,
  startRow: 81,
  endRow: 102,
  staticVariables: [
    // Row 84 is the equipment dynamic-row template (A/B only, see
    // dynamicRow below — C/D stay empty on every equipment row). Row 86 is
    // the template's own fixed "TOTAL VALUE" line, one row after row 84's
    // reserved capacity: cpm_sum_insured (all equipment totalValue summed),
    // cpm_rate and cpm_basic_premium all live there now. Because 86 sits
    // past dynamicRow.lastBlankRow, resolveFinalRow/resolveFinalCell shift
    // it down automatically whenever equipment rows are inserted — the same
    // mechanism that already moves PVT LOADING (row 88) and everything
    // below it, no special-casing needed.
    //
    // C86/C88's template cells were never %-formatted (unlike every other
    // rate cell in the workbook), which used to make 0.75 render as the raw
    // fraction "0.0075" instead of "0.75%". Fixed at the template level
    // (numFmt "0.###%" like every other rate cell) as part of the rate-
    // format standardization; replaceVariables.ts also now forces
    // EXCEL_RATE_NUM_FMT unconditionally on every "rate" write, so no
    // per-field override is needed here anymore.
    sv("cpm_sum_insured", "B86", "money", true),
    sv("cpm_rate", "C86", "rate", true),
    sv("cpm_basic_premium", "D86", "money", true),
    sv("cpm_pvt_loading_amount", "B88", "money"),
    sv("cpm_pvt_loading_rate", "C88", "rate"),
    sv("cpm_pvt_loading_premium", "D88", "money"),
    sv("cpm_gross_premium", "D97", "money", true),
    sv("cpm_phcf", "D98", "money", true),
    sv("cpm_itl", "D99", "money", true),
    sv("cpm_stamp_duty", "D100", "money", true),
    sv("cpm_total_premium", "D102", "money", true),
  ],
  // A86 ("TOTAL VALUE") is plain static text, not a {{placeholder}} — it
  // needs to be listed here to render bold like the sum/rate/premium cells
  // beside it (replaceVariables.ts only auto-bolds cells it writes a value
  // into).
  boldLabelCells: ["A86"],
  // The template's own PVT LOADING row now permanently occupies row 88,
  // which used to sit inside this section's reserved blank equipment-row
  // capacity (originally 87-94). Since a fixed row can no longer sit in
  // the middle of a contiguous dynamic-capacity block, the reserved
  // capacity is now just the template row itself (84) — more than 1
  // equipment row inserts new rows below it (pushing the row-85 spacer,
  // row-86 TOTAL VALUE, row-88 PVT LOADING and everything below down),
  // which correctly preserves that whole block via resolveFinalRow, same
  // mechanism used for every other dynamic section.
  dynamicRow: {
    templateRow: 84,
    firstBlankRow: 84,
    lastBlankRow: 84,
    totalRow: 86,
    columns: [
      { column: "A", name: "cpm_equipment", kind: "text" },
      { column: "B", name: "cpm_total_value", kind: "money" },
    ],
  },
  summaryTotalVariable: "cpm_total_premium",
  excessMergeEndRow: 102,
};

const PUBLIC_LIABILITY: SectionConfig = {
  kind: "PUBLIC_LIABILITY",
  displayName: "Public Liability",
  displayNameZh: "公众责任险",
  outputOrder: 5,
  startRow: 103,
  endRow: 124,
  staticVariables: [
    sv("pl_any_one_person", "B106", "money"),
    sv("pl_any_one_occurrence", "B108", "money"),
    sv("pl_any_one_year", "B110", "money", true),
    sv("pl_rate", "C110", "rate", true),
    sv("pl_gross_premium", "D110", "money", true),
    sv("pl_gross_premium", "D119", "money", true),
    sv("pl_phcf", "D120", "money", true),
    sv("pl_itl", "D121", "money", true),
    sv("pl_stamp_duty", "D122", "money", true),
    sv("pl_total_premium", "D124", "money", true),
  ],
  summaryTotalVariable: "pl_total_premium",
  notes: ["Rows 125-126 are a 2-row blank gap before Fire & Perils' title (127) — every other section boundary in this template only has 1. Per the section-boundary-ownership convention documented at the top of this file, both rows are claimed by FIRE_AND_PERILS.startRow (125), not by pl's own endRow."],
};

const FIRE_AND_PERILS: SectionConfig = {
  kind: "FIRE_AND_PERILS",
  displayName: "Fire & Perils",
  displayNameZh: "火灾及自然灾害险",
  outputOrder: 6,
  startRow: 125,
  endRow: 147,
  staticVariables: [
    sv("fire_property_value", "B129", "money", true),
    sv("fire_raw_material_value", "B130", "money"),
    sv("fire_goods_in_stock_value", "B131", "money"),
    sv("fire_total_sum_insured", "B134", "money", true),
    sv("fire_rate", "C134", "rate", true),
    sv("fire_basic_premium", "D134", "money", true),
    // Earthquake/Flood Loading Rate placeholders (C137/C138) were removed
    // from the template — these are fixed business rates now (see
    // FIRE_EARTHQUAKE_LOADING_RATE/FIRE_FLOOD_LOADING_RATE in
    // insuranceCalculations/constants.ts), never shown as an editable
    // number in Excel. Only the resulting amount is still mapped.
    sv("fire_earthquake_loading_amount", "D137", "money"),
    sv("fire_flood_loading_amount", "D138", "money"),
    sv("fire_pvt_loading_amount", "B140", "money"),
    sv("fire_pvt_loading_rate", "C140", "rate"),
    sv("fire_pvt_loading_premium", "D140", "money"),
    sv("fire_gross_premium", "D143", "money", true),
    sv("fire_phcf", "D144", "money", true),
    sv("fire_itl", "D145", "money", true),
    sv("fire_stamp_duty", "D146", "money", true),
    sv("fire_total_premium", "D147", "money", true),
  ],
  summaryTotalVariable: "fire_total_premium",
};

const BURGLARY: SectionConfig = {
  kind: "BURGLARY",
  displayName: "Burglary",
  displayNameZh: "盗窃险",
  outputOrder: 7,
  startRow: 148,
  endRow: 164,
  staticVariables: [
    sv("burglary_equipment_value", "B151", "money"),
    sv("burglary_stock_value", "B152", "money"),
    sv("burglary_total_value", "B155", "money", true),
    sv("burglary_rate", "C155", "rate", true),
    sv("burglary_first_loss_sum_insured", "B156", "money", true),
    sv("burglary_first_loss_percentage", "C156", "rate", true),
    sv("burglary_gross_premium", "D156", "money", true),
    sv("burglary_gross_premium", "D160", "money", true),
    sv("burglary_phcf", "D161", "money", true),
    sv("burglary_itl", "D162", "money", true),
    sv("burglary_stamp_duty", "D163", "money", true),
    sv("burglary_total_premium", "D164", "money", true),
  ],
  summaryTotalVariable: "burglary_total_premium",
};

const GIT_SINGLE: SectionConfig = {
  kind: "GIT_SINGLE",
  displayName: "Goods in Transit - Single",
  displayNameZh: "货物运输险（单次）",
  outputOrder: 8,
  startRow: 165,
  endRow: 188,
  staticVariables: [
    sv("git_cargo_description", "A168", "text", true),
    sv("git_route", "A169", "text"),
    sv("git_sum_insured", "B178", "money", true),
    sv("git_rate", "C178", "rate", true),
    sv("git_basic_premium", "D178", "money", true),
    sv("git_single_pvt_loading_amount", "B180", "money"),
    sv("git_single_pvt_loading_rate", "C180", "rate"),
    sv("git_single_pvt_loading_premium", "D180", "money"),
    sv("git_gross_premium", "D184", "money", true),
    sv("git_phcf", "D185", "money", true),
    sv("git_itl", "D186", "money", true),
    sv("git_stamp_duty", "D187", "money", true),
    sv("git_total_premium", "D188", "money", true),
  ],
  summaryTotalVariable: "git_total_premium",
  notes: [
    "Row 178 ('On a single transit') holds Sum Insured/Rate/Base Premium; row 184 ('Gross premium') holds {{git_gross_premium}} — re-inspected after a template edit that previously had these two swapped (D178 was wrongly read as {{git_gross_premium}} and D184 as a stray {{git_total_sum_insured}}), which left {{git_gross_premium}} unresolved at generation time.",
    "The PVT row (180) was re-inspected for this task: previously read as a 2-cell {{git_pvt_rate}}/{{git_pvt_amount}} pair and a stale duplicate {{git_sum_insured}} at B182 — both no longer exist in the current template. The row is now the standard 3-value amount/rate/premium block, and B182 is blank.",
  ],
};

const GIT_ANNUAL: SectionConfig = {
  kind: "GIT_ANNUAL",
  displayName: "Goods in Transit - Annual",
  displayNameZh: "货物运输险（年保）",
  outputOrder: 9,
  startRow: 189,
  endRow: 212,
  staticVariables: [
    sv("git_annual_cargo_description", "A192", "text", true),
    sv("git_annual_single_limit", "B195", "money", true),
    sv("git_annual_single_rate", "C195", "rate", true),
    sv("git_annual_single_premium", "D195", "money", true),
    sv("git_annual_year_limit", "B196", "money", true),
    sv("git_annual_year_rate", "C196", "rate", true),
    sv("git_annual_year_premium", "D196", "money", true),
    sv("git_annual_total_limit", "B206", "money", true),
    sv("git_annual_pvt_loading_amount", "B199", "money"),
    sv("git_annual_pvt_loading_rate", "C199", "rate"),
    sv("git_annual_pvt_loading_premium", "D199", "money"),
    sv("git_annual_gross_premium", "D208", "money", true),
    sv("git_annual_phcf", "D209", "money", true),
    sv("git_annual_itl", "D210", "money", true),
    sv("git_annual_stamp_duty", "D211", "money", true),
    sv("git_annual_total_premium", "D212", "money", true),
  ],
  summaryTotalVariable: "git_annual_total_premium",
  notes: ["git_annual_total_limit (B206) is single+year limit added together for display reference only — never used as a premium basis (the two premiums are always calculated and summed independently)."],
};

// Re-inspected after the Marine template was rebuilt around a 3-physical-row
// shipment block (reference/sum insured, incidental loading, basic sum
// insured/rate/line premium) instead of the old 1-row-per-shipment layout —
// see marine.ts's calculateMarine() for the Incidental Loading / Basic Sum
// Insured formulas this template now displays. The rebuild inserted 3 net
// extra rows into the sheet, so every section from Motor Comprehensive
// (Private) onward shifted down by +3 versus the pre-rebuild inspection —
// re-verified cell-by-cell via scripts/scan-placeholders.ts, not guessed.
const MARINE_COVER: SectionConfig = {
  kind: "MARINE_COVER",
  displayName: "Marine Cover",
  displayNameZh: "海运险",
  outputOrder: 10,
  startRow: 213,
  endRow: 245,
  staticVariables: [
    sv("marine_cargo_description", "A216", "text"),
    sv("marine_origin", "A218", "text"),
    sv("marine_destination", "A218", "text"),
    sv("marine_total_basic_sum_insured", "B239", "money", true),
    sv("marine_gross_premium", "D241", "money", true),
    sv("marine_phcf", "D242", "money", true),
    sv("marine_itl", "D243", "money", true),
    sv("marine_stamp_duty", "D244", "money", true),
    sv("marine_total_premium", "D245", "money", true),
  ],
  // Each shipment is now a 3-physical-row block starting at templateRow:
  //   offset 0 (A/B): reference no. / sum insured
  //   offset 1 (A fixed label / B): "Incidental Loading (10%)" / amount
  //   offset 2 (A fixed label / B/C/D): "Basic Sum Insured" / amount / rate / line premium
  // Capacity is 6 shipments (rows 220-237, 18 rows / 3 = 6); row 238 is a
  // fixed 1-row spacer before the "Total" row (239) — same single-blank-row
  // spacing convention used elsewhere in this section (215/217/219) — and
  // shifts together with the block via resolveFinalRow since 238 > lastBlankRow.
  dynamicRow: {
    templateRow: 220,
    firstBlankRow: 223,
    lastBlankRow: 237,
    totalRow: 239,
    rowsPerEntry: 3,
    columns: [
      { column: "A", name: "marine_reference_no", kind: "text", rowOffset: 0 },
      { column: "B", name: "marine_sum_insured", kind: "money", rowOffset: 0 },
      { column: "B", name: "marine_incidental_loading", kind: "money", rowOffset: 1 },
      { column: "B", name: "marine_basic_sum_insured", kind: "money", rowOffset: 2 },
      // Template cell C222 was "0.0000%" (4 decimals), which used to print
      // "0.2500%" instead of the required "0.25%" — fixed at the template
      // level (numFmt "0.###%") as part of the rate-format standardization;
      // fillDynamicRows.ts also forces EXCEL_RATE_NUM_FMT unconditionally on
      // every "rate" column, so no per-field override is needed here anymore.
      { column: "C", name: "marine_rate", kind: "rate", rowOffset: 2 },
      { column: "D", name: "marine_line_premium", kind: "money", rowOffset: 2 },
    ],
    blockLabels: [
      { column: "A", rowOffset: 1, text: "Incidental Loading (10%)" },
      { column: "A", rowOffset: 2, text: "Basic Sum Insured " },
    ],
  },
  summaryTotalVariable: "marine_total_premium",
  notes: [
    "C244 (marine stamp duty rate, 0.0005) is a pre-baked literal constant, not a placeholder — never written.",
    "marine_total_sum_insured (the old Total row's basis, sum of raw Sum Insured) no longer has a live placeholder in this template — mapMarine() still emits it in the mapped values dict for compat, but no StaticVariable maps it to a cell since there is nothing to write it to.",
  ],
  excessMergeEndRow: 244,
};

function motorComprehensiveSection(
  kind: "MOTOR_COMP_PRIVATE" | "MOTOR_COMP_COMMERCIAL",
  displayName: string,
  displayNameZh: string,
  outputOrder: number,
  startRow: number,
  endRow: number,
  plateRow: number,
  valueRow: number,
  excessRow: number,
  pvtRow: number,
  periodRow: number,
  totalValueRow: number,
  phcfRow: number,
  itlRow: number,
  stampDutyRow: number,
  totalPremiumRow: number,
  grossPremiumRow2: number
): SectionConfig {
  return {
    kind,
    displayName,
    displayNameZh,
    outputOrder,
    startRow,
    endRow,
    staticVariables: [
      sv("motor_plate_no", `A${plateRow}`, "text", true),
      sv("motor_vehicle_value", `B${valueRow}`, "money", true),
      sv("motor_rate", `C${valueRow}`, "rate", true),
      sv("motor_gross_premium", `D${valueRow}`, "money", true),
      sv("motor_vehicle_value", `B${totalValueRow}`, "money", true),
      sv("motor_excess_protector", `B${excessRow}`, "text"),
      sv("motor_pvt", `B${pvtRow}`, "text"),
      sv("motor_period_from", `A${periodRow}`, "text", true),
      sv("motor_period_to", `A${periodRow}`, "text", true),
      sv("motor_gross_premium", `D${grossPremiumRow2}`, "money", true),
      sv("motor_phcf", `D${phcfRow}`, "money", true),
      sv("motor_itl", `D${itlRow}`, "money", true),
      sv("motor_stamp_duty", `D${stampDutyRow}`, "money", true),
      sv("motor_total_premium", `D${totalPremiumRow}`, "money", true),
    ],
    summaryTotalVariable: "motor_total_premium",
  };
}

// Row numbers below (Motor Comprehensive onward) are all +3 versus their
// pre-Marine-rebuild values — see MARINE_COVER's note above.
const MOTOR_COMP_PRIVATE = motorComprehensiveSection(
  "MOTOR_COMP_PRIVATE", "Motor Comprehensive - Private", "私家车全险", 11,
  246, 270, 249, 250, 251, 252, 254, 264, 267, 268, 269, 270, 266
);

const MOTOR_COMP_COMMERCIAL = motorComprehensiveSection(
  "MOTOR_COMP_COMMERCIAL", "Motor Comprehensive - Commercial", "商用车全险", 12,
  271, 295, 274, 275, 276, 277, 279, 289, 292, 293, 294, 295, 291
);

const MOTOR_TPO_PRIVATE: SectionConfig = {
  kind: "MOTOR_TPO_PRIVATE",
  displayName: "Motor TPO - Private",
  displayNameZh: "私家车强制第三者险",
  outputOrder: 13,
  startRow: 296,
  endRow: 320,
  staticVariables: [
    sv("motor_plate_no", "A299", "text", true),
    sv("motor_tpo_base_premium", "B303", "money", true),
    sv("motor_gross_premium", "D303", "money", true),
    sv("motor_period_from", "A304", "text", true),
    sv("motor_period_to", "A304", "text", true),
    sv("motor_gross_premium", "D316", "money", true),
    sv("motor_phcf", "D317", "money", true),
    sv("motor_itl", "D318", "money", true),
    sv("motor_stamp_duty", "D319", "money", true),
    sv("motor_total_premium", "D320", "money", true),
  ],
  summaryTotalVariable: "motor_total_premium",
  notes: ["C303 holds a hardcoded literal '1' (100%), not a placeholder — never written."],
};

const MOTOR_TPO_COMMERCIAL: SectionConfig = {
  kind: "MOTOR_TPO_COMMERCIAL",
  displayName: "Motor TPO - Commercial",
  displayNameZh: "商用车强制第三者险",
  outputOrder: 14,
  startRow: 321,
  endRow: 345,
  staticVariables: [
    sv("motor_plate_no", "A324", "text", true),
    sv("motor_loading_capacity", "B326", "money"),
    sv("motor_tpo_base_premium", "D326", "money", true),
    sv("motor_period_from", "A329", "text", true),
    sv("motor_period_to", "A329", "text", true),
    sv("motor_gross_premium", "D341", "money", true),
    sv("motor_phcf", "D342", "money", true),
    sv("motor_itl", "D343", "money", true),
    sv("motor_stamp_duty", "D344", "money", true),
    sv("motor_total_premium", "D345", "money", true),
  ],
  summaryTotalVariable: "motor_total_premium",
};

const GROUP_PERSONAL_ACCIDENT: SectionConfig = {
  kind: "GROUP_PERSONAL_ACCIDENT",
  displayName: "Group Personal Accident",
  displayNameZh: "团体意外险",
  outputOrder: 15,
  startRow: 346,
  endRow: 367,
  staticVariables: [
    sv("gpa_death_limit", "B351", "money"),
    sv("gpa_death_rate", "C351", "rate"),
    sv("gpa_death_premium", "D351", "money", true),
    sv("gpa_ptd_limit", "B352", "money"),
    sv("gpa_ptd_rate", "C352", "rate"),
    sv("gpa_ptd_premium", "D352", "money", true),
    sv("gpa_ttd_limit", "B353", "money"),
    sv("gpa_ttd_rate", "C353", "rate"),
    sv("gpa_ttd_premium", "D353", "money", true),
    sv("gpa_medical_limit", "B354", "money"),
    sv("gpa_medical_rate", "C354", "rate"),
    sv("gpa_medical_premium", "D354", "money", true),
    sv("gpa_funeral_limit", "B355", "money"),
    sv("gpa_funeral_rate", "C355", "rate"),
    sv("gpa_funeral_premium", "D355", "money", true),
    sv("gpa_per_person_premium", "D358", "money", true),
    sv("gpa_number_of_people", "D360", "integer", true),
    sv("gpa_total_basic_premium", "D361", "money", true),
    sv("gpa_gross_premium", "D363", "money", true),
    sv("gpa_phcf", "D364", "money", true),
    sv("gpa_itl", "D365", "money", true),
    sv("gpa_stamp_duty", "D366", "money", true),
    sv("gpa_total_premium", "D367", "money", true),
  ],
  summaryTotalVariable: "gpa_total_premium",
};

const GROUP_MEDICAL: SectionConfig = {
  kind: "GROUP_MEDICAL",
  displayName: "Group Medical Insurance",
  displayNameZh: "团体医疗险",
  outputOrder: 16,
  startRow: 368,
  endRow: 398,
  staticVariables: [
    sv("medical_inpatient_limit", "A371", "money"),
    sv("medical_inpatient_m_rate", "D372", "money"),
    sv("medical_inpatient_m1_rate", "D373", "money"),
    sv("medical_inpatient_m2_rate", "D374", "money"),
    sv("medical_inpatient_m3_rate", "D375", "money"),
    sv("medical_inpatient_m4_rate", "D376", "money"),
    sv("medical_inpatient_m5_rate", "D377", "money"),
    sv("medical_outpatient_limit", "A379", "money"),
    sv("medical_outpatient_m_rate", "D380", "money"),
    sv("medical_outpatient_m1_rate", "D381", "money"),
    sv("medical_outpatient_m2_rate", "D382", "money"),
    sv("medical_outpatient_m3_rate", "D383", "money"),
    sv("medical_outpatient_m4_rate", "D384", "money"),
    sv("medical_outpatient_m5_rate", "D385", "money"),
    // M..M+5 count cells were moved up one row (389-394 -> 388-393) by the
    // Medical template rebuild that also merged the "employee count" label
    // into its own single cell "{{medical_employee_count}} Employees" (see
    // medical_employee_count below) — re-inspected cell-by-cell via
    // scripts/scan-medical.ts, not guessed.
    sv("medical_m_count", "A388", "integer"),
    sv("medical_m1_count", "A389", "integer"),
    sv("medical_m2_count", "A390", "integer"),
    sv("medical_m3_count", "A391", "integer"),
    sv("medical_m4_count", "A392", "integer"),
    sv("medical_m5_count", "A393", "integer"),
    sv("medical_inpatient_premium", "D389", "money", true),
    sv("medical_outpatient_premium", "D390", "money", true),
    sv("medical_subtotal", "D391", "money", true),
    sv("medical_gross_premium", "D394", "money", true),
    // The old template had two separate cells for this value (a bare count
    // and a "... Employees" suffixed one); the rebuilt template has only
    // the single suffixed cell at A394 — the bare-count StaticVariable was
    // removed, not just left unused, since there is no cell left to map it to.
    sv("medical_employee_count", "A394", "integer", true, { suffix: " Employees" }),
    sv("medical_phcf", "D395", "money", true),
    sv("medical_itl", "D396", "money", true),
    sv("medical_stamp_duty", "D397", "money", true),
    sv("medical_total_premium", "D398", "money", true),
  ],
  summaryTotalVariable: "medical_total_premium",
  notes: [
    "Medical's per-category rate placeholders are a flat KES amount per employee, not a percentage — classified as kind:'money', not kind:'rate' (no /100 conversion), unlike every other section's rate placeholders.",
    "medical_phcf and medical_itl are always written as 0 per the approved template tax rule — Group Medical never applies PHCF or ITL.",
  ],
};

const TENDER_SECURITY: SectionConfig = {
  kind: "TENDER_SECURITY",
  displayName: "Tender Security",
  displayNameZh: "投标保函",
  outputOrder: 17,
  startRow: 399,
  endRow: 410,
  staticVariables: [
    sv("bond_project_name", "A402", "text", true),
    sv("bond_value", "B403", "money", true),
    sv("bond_rate", "C403", "rate", true),
    sv("bond_premium", "D403", "money", true),
    sv("bond_gross_premium", "D406", "money", true),
    sv("bond_phcf", "D407", "money", true),
    sv("bond_itl", "D408", "money", true),
    sv("bond_stamp_duty", "D409", "money", true),
    sv("bond_total_premium", "D410", "money", true),
  ],
  summaryTotalVariable: "bond_total_premium",
  notes: ["Uses the bond_* placeholder prefix, unlike Performance Bond/APG's guarantee_* prefix — inconsistent naming in the template, not something Phase 3A alters."],
};

const PERFORMANCE_BOND: SectionConfig = {
  kind: "PERFORMANCE_BOND",
  displayName: "Performance Bond",
  displayNameZh: "履约保函",
  outputOrder: 18,
  startRow: 411,
  endRow: 433,
  staticVariables: [
    sv("guarantee_project_name", "A414", "text", true),
    sv("guarantee_bond_value", "B416", "money", true),
    sv("guarantee_rate", "C416", "rate", true),
    sv("guarantee_premium", "D416", "money", true),
    sv("guarantee_gross_premium", "D428", "money", true),
    sv("guarantee_phcf", "D429", "money", true),
    sv("guarantee_itl", "D430", "money", true),
    sv("guarantee_stamp_duty", "D431", "money", true),
    sv("guarantee_total_premium", "D433", "money", true),
  ],
  summaryTotalVariable: "guarantee_total_premium",
  notes: ["Shares placeholder names with APG (different row range, 435-455) — must be filled by scoped row-range substitution only."],
};

const ADVANCE_PAYMENT_GUARANTEE: SectionConfig = {
  kind: "ADVANCE_PAYMENT_GUARANTEE",
  displayName: "Advance Payment Guarantee",
  displayNameZh: "预付款保函",
  outputOrder: 19,
  startRow: 434,
  endRow: 454,
  staticVariables: [
    sv("guarantee_project_name", "A437", "text", true),
    sv("guarantee_bond_value", "B439", "money", true),
    sv("guarantee_rate", "C439", "rate", true),
    sv("guarantee_premium", "D439", "money", true),
    sv("guarantee_gross_premium", "D449", "money", true),
    sv("guarantee_phcf", "D450", "money", true),
    sv("guarantee_itl", "D451", "money", true),
    sv("guarantee_stamp_duty", "D452", "money", true),
    sv("guarantee_total_premium", "D454", "money", true),
  ],
  summaryTotalVariable: "guarantee_total_premium",
  notes: ["Shares placeholder names with Performance Bond (different row range, 412-434) — must be filled by scoped row-range substitution only."],
};

const CUSTOMS_BOND: SectionConfig = {
  kind: "CUSTOMS_BOND",
  displayName: "Customs Bond",
  displayNameZh: "清关保函",
  outputOrder: 20,
  startRow: 455,
  endRow: 474,
  staticVariables: [
    sv("custom_bond_gross_premium", "D470", "money", true),
    sv("custom_bond_phcf", "D471", "money", true),
    sv("custom_bond_itl", "D472", "money", true),
    sv("custom_bond_stamp_duty", "D473", "money", true),
    sv("custom_bond_total_premium", "D474", "money", true),
  ],
  dynamicRow: {
    templateRow: 459,
    firstBlankRow: 460,
    lastBlankRow: 469,
    // No fixed "Total" row for Customs Bond — row 470 (Gross premium) follows directly.
    columns: [
      { column: "A", name: "custom_bond_type", kind: "text" },
      { column: "B", name: "custom_bond_value", kind: "money" },
      { column: "C", name: "custom_bond_rate", kind: "rate" },
      { column: "D", name: "custom_bond_premium", kind: "money" },
    ],
  },
  summaryTotalVariable: "custom_bond_total_premium",
  excessMergeEndRow: 474,
};

export const TEMPLATE_CONFIG: TemplateConfig = {
  templateRelativePath: "templates/quotation/quotation template.xlsx",
  sheetName: "WITH PVT (INTRA)",
  commonVariables: [
    sv("CUSTOMER_NAME", "B2", "text", true),
  ],
  missingCommonVariables: [
    "customer_pin",
    "quotation_no",
    "quotation_date",
    "valid_until",
    "insurer_name",
    "currency",
    "prepared_by",
  ],
  grandTotalVariable: "quotation_total_premium",
  grandTotalCell: "D475",
  // Row 1 is the header drawing (logo + company text box) only, no cell
  // border. Row 2 ("INSURED" / customer name) is the first row carrying the
  // table's medium outer border in the pristine template. Columns A-E are
  // the template's entire content width (columnCount === 5) — confirmed by
  // direct inspection, not assumed.
  contentAreaFirstRow: 2,
  contentAreaFirstCol: 1,
  contentAreaLastCol: 5,
  sections: [
    CAR_PACKAGE,
    WIBA,
    EMPLOYERS_LIABILITY,
    CPM_STANDALONE,
    PUBLIC_LIABILITY,
    FIRE_AND_PERILS,
    BURGLARY,
    GIT_SINGLE,
    GIT_ANNUAL,
    MARINE_COVER,
    MOTOR_COMP_PRIVATE,
    MOTOR_COMP_COMMERCIAL,
    MOTOR_TPO_PRIVATE,
    MOTOR_TPO_COMMERCIAL,
    GROUP_PERSONAL_ACCIDENT,
    GROUP_MEDICAL,
    TENDER_SECURITY,
    PERFORMANCE_BOND,
    ADVANCE_PAYMENT_GUARANTEE,
    CUSTOMS_BOND,
  ],
};
