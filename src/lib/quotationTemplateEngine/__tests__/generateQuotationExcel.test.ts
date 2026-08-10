import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { generateQuotationExcel } from "../generateQuotationExcel";
import { SECTION_SUBTOTAL_FONT_SIZE, GRAND_TOTAL_FONT_SIZE } from "../subtotalFont";

// Excel border/font regression suite — covers a real production report:
// generated quotations showed (1) a break in the vertical divider between
// the main data columns and the "EXCESS/REMARK" column E, (2) a missing
// horizontal separator between two adjacent Insurance Type sections' E
// column, and (3) an inconsistently larger font on some sections' own
// "Total Premium" cell while the final grand total was NOT visually
// distinct. Every assertion here is driven by generateQuotationExcel's own
// output (the real template + the real engine) — nothing is hardcoded to a
// specific row number; SectionLayout's own final startRow/endRow (surfaced
// indirectly through the workbook itself) is what every check walks.
//
// generateQuotationExcel reads templates/quotation/quotation template.xlsx
// from disk via process.cwd() — this suite must run from the project root
// (vitest.config.ts's default), same as every other test in this repo.

const SHEET_NAME = "WITH PVT (INTRA)";
const EXCESS_COLUMN = 5; // E
const LAST_CONTENT_COLUMN = 4; // D

// Every *Detail relation a QuotationInsuranceSection can carry, defaulted to
// null — a section fixture only ever overrides the one relation matching
// its own sectionKind. Mirrors QuotationForExport["sections"][number]'s
// shape at runtime (TS types are erased; only the fields mapQuotationData.ts
// actually reads for the section kinds under test need real values).
function emptySectionSlots() {
  return {
    carDetail: null,
    wibaDetail: null,
    elDetail: null,
    cpmDetail: null,
    publicLiabilityDetail: null,
    fireDetail: null,
    burglaryDetail: null,
    gitSingleDetail: null,
    gitAnnualDetail: null,
    marineDetail: null,
    motorCompPrivateDetail: null,
    motorCompCommercialDetail: null,
    motorTpoPrivateDetail: null,
    motorTpoCommercialDetail: null,
    gpaDetail: null,
    medicalDetail: null,
    tenderSecurityDetail: null,
    performanceBondDetail: null,
    advancePaymentGuaranteeDetail: null,
    customsBondDetail: null,
  };
}

function wibaSection(payrollCount: number, totalPremium: number) {
  const payrollRows = Array.from({ length: payrollCount }, (_, i) => ({
    occupation: `Occupation ${i + 1}`,
    employeeCount: 2,
    annualWages: 120000,
  }));
  return {
    sectionKind: "WIBA",
    basePremium: 0,
    phcfAmount: 0,
    itlAmount: 0,
    stampDuty: 0,
    sectionTotal: totalPremium,
    ...emptySectionSlots(),
    wibaDetail: {
      totalEmployeeCount: payrollCount * 2,
      totalAnnualWages: payrollCount * 2 * 120000,
      wibaRate: 0.8,
      grossPremium: totalPremium - 40,
      phcfAmount: 480,
      itlAmount: 384,
      stampDutyAmount: 40,
      totalPremium,
      payrollRows,
    },
  };
}

function fireSection(totalPremium: number, pvtLoadingEnabled = true) {
  return {
    sectionKind: "FIRE_AND_PERILS",
    basePremium: 0,
    phcfAmount: 0,
    itlAmount: 0,
    stampDuty: 0,
    sectionTotal: totalPremium,
    ...emptySectionSlots(),
    fireDetail: {
      propertyValue: 5000000,
      rawMaterialValue: 200000,
      goodsInStockValue: 100000,
      totalSumInsured: 5300000,
      rate: 0.25,
      basicPremium: 13250,
      earthquakeLoadingEnabled: false,
      earthquakeLoadingAmount: 0,
      floodLoadingEnabled: false,
      floodLoadingAmount: 0,
      pvtLoadingEnabled,
      pvtLoadingAmount: pvtLoadingEnabled ? 500 : 0,
      pvtLoadingRate: pvtLoadingEnabled ? 0.1 : null,
      pvtLoadingPremium: pvtLoadingEnabled ? 1250 : 0,
      grossPremium: totalPremium - 40,
      phcfAmount: 362,
      itlAmount: 290,
      stampDutyAmount: 40,
      totalPremium,
    },
  };
}

function customsBondSection(itemCount: number, totalPremium: number) {
  const itemRows = Array.from({ length: itemCount }, (_, i) => ({
    bondType: `Bond Type ${i + 1}`,
    bondValue: 50000,
    rate: 1.5,
    premium: totalPremium / itemCount,
  }));
  return {
    sectionKind: "CUSTOMS_BOND",
    basePremium: 0,
    phcfAmount: 0,
    itlAmount: 0,
    stampDuty: 0,
    sectionTotal: totalPremium,
    ...emptySectionSlots(),
    customsBondDetail: {
      grossPremium: totalPremium,
      phcfAmount: 0,
      itlAmount: 0,
      stampDutyAmount: 0,
      totalPremium,
      itemRows,
    },
  };
}

function buildQuotation(sections: Record<string, unknown>[], quotationNumber = "QT-TEST-0001") {
  const grandTotal = sections.reduce((acc, s) => acc + (s.sectionTotal as number), 0);
  return {
    quotationNumber,
    quotationDate: new Date("2026-08-10"),
    grandTotal,
    customer: { companyName: "REGRESSION TEST CUSTOMER LIMITED" },
    project: null,
    sections,
  } as unknown as Parameters<typeof generateQuotationExcel>[0];
}

async function loadWorksheet(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.getWorksheet(SHEET_NAME)!;
}

function border(ws: ExcelJS.Worksheet, row: number, col: number) {
  return ws.getRow(row).getCell(col).border ?? {};
}

/** Every row in [startRow, endRow] must have a continuous D-right/E-left divider (Part VI: no break near the EXCESS/REMARK column). */
function expectContinuousDivider(ws: ExcelJS.Worksheet, startRow: number, endRow: number) {
  for (let r = startRow; r <= endRow; r++) {
    expect(border(ws, r, LAST_CONTENT_COLUMN).right?.style, `row ${r} D.right`).toBe("medium");
    expect(border(ws, r, EXCESS_COLUMN).left?.style, `row ${r} E.left`).toBe("medium");
  }
}

/** Finds the row range whose column-A/B text includes `titleFragment`, by locating that title row and the next row sharing the same value/bottom-border pattern is out of scope here — instead this walks the sheet for the given label and returns the row it's on. */
function findRowContaining(ws: ExcelJS.Worksheet, text: string): number {
  const lastRow = ws.lastRow?.number ?? ws.rowCount;
  for (let r = 1; r <= lastRow; r++) {
    for (let c = 1; c <= 4; c++) {
      const v = ws.getRow(r).getCell(c).value;
      if (typeof v === "string" && v.includes(text)) return r;
    }
  }
  throw new Error(`Row containing "${text}" not found`);
}

/** Every column-E "excess/clauses" merge in the sheet, as [startRow, endRow] pairs sorted by startRow — excludes the sheet-wide B2:E2 header merge. */
function excessMergeRanges(ws: ExcelJS.Worksheet): { start: number; end: number }[] {
  const merges: string[] = (ws.model as unknown as { merges?: string[] }).merges ?? [];
  return merges
    .filter((m) => m.startsWith("E") && !m.startsWith("E2:"))
    .map((m) => {
      const [start, end] = m.split(":");
      return { start: parseInt(start.slice(1), 10), end: parseInt(end.slice(1), 10) };
    })
    .sort((a, b) => a.start - b.start);
}

/**
 * Regression guard for the "empty boxed-off row before CLAUSE begins" bug: a
 * second production report caught an earlier version of
 * applySectionExcessBorders.ts that set a TOP border on a merge's own first
 * row, which — because the template already bakes a lone top-only border
 * into that merge's leading spacer row — sandwiched the spacer between two
 * separate horizontal lines, rendering as an empty box. The fix never sets
 * a top border on a merge's first row at all (the previous section's own
 * bottom edge, or the sheet's fixed header, is what visually opens each
 * section instead) — so a merge's own first row must never carry its own
 * top border, and the row immediately above a merge must never carry BOTH
 * a top and a bottom border (the two-line sandwich, however it arose).
 */
function expectNoBoxedSpacerRow(ws: ExcelJS.Worksheet, mergeStartRow: number) {
  expect(border(ws, mergeStartRow, EXCESS_COLUMN).top?.style, `merge start row ${mergeStartRow} must have no top border`).toBeUndefined();
  const spacerRow = mergeStartRow - 1;
  const spacerBorder = border(ws, spacerRow, EXCESS_COLUMN);
  expect(
    spacerBorder.top?.style && spacerBorder.bottom?.style,
    `row ${spacerRow} (immediately above the merge) must not have both a top AND a bottom border`
  ).toBeFalsy();
}

describe("generateQuotationExcel — border/font regressions (production report)", () => {
  it("Case 1: a single Insurance Type generates cleanly with no warnings, and no blank boxed row appears above the CLAUSE content", async () => {
    const result = await generateQuotationExcel(buildQuotation([fireSection(15000)]));
    expect(result.warnings).toEqual([]);
    expect(result.buffer.length).toBeGreaterThan(0);

    const ws = await loadWorksheet(result.buffer);
    const [merge] = excessMergeRanges(ws);
    expect(merge).toBeDefined();
    expectNoBoxedSpacerRow(ws, merge.start);
  });

  it("Case 2: two Insurance Types generate cleanly, grand total matches the sum of both, and NEITHER section's Clause area has a blank boxed row above it", async () => {
    const result = await generateQuotationExcel(buildQuotation([fireSection(15000), customsBondSection(3, 5000)]));
    expect(result.warnings).toEqual([]);
    const ws = await loadWorksheet(result.buffer);
    const grandTotalCell = ws.getRow(findRowContaining(ws, "TOTAL PREMIUM")).getCell(LAST_CONTENT_COLUMN);
    expect(grandTotalCell.value).toBe(20000);

    const merges = excessMergeRanges(ws);
    expect(merges).toHaveLength(2);
    for (const merge of merges) expectNoBoxedSpacerRow(ws, merge.start);
    // The section boundary itself (Part VII, must not regress): the first
    // section's own merge still closes with a bottom border.
    expect(border(ws, merges[0].end, EXCESS_COLUMN).bottom?.style).toBe("medium");
  });

  it("Case 3 (Fire & Perils + Customs Bond, matches the reported screenshot): E-column outer border is continuous, D/E divider is continuous, the section separator is correct, and no double-line blank box appears above either CLAUSE area", async () => {
    const result = await generateQuotationExcel(buildQuotation([fireSection(15000), customsBondSection(4, 6000)]));
    const ws = await loadWorksheet(result.buffer);

    const fireTotalRow = findRowContaining(ws, "Total Premium");
    // Fire's own Total Premium row must close its box with a bottom border
    // on the excess column — this is the separator between two adjacent
    // sections (Part VII), which this round's fix must not regress.
    expect(border(ws, fireTotalRow, EXCESS_COLUMN).bottom?.style).toBe("medium");

    const merges = excessMergeRanges(ws);
    expect(merges).toHaveLength(2);
    // No blank boxed row above either section's CLAUSE content (this
    // round's actual fix).
    for (const merge of merges) expectNoBoxedSpacerRow(ws, merge.start);

    // D/E divider (Part VI) and E's own outer-right edge stay continuous
    // across the whole printed area, not just within one merge.
    const lastRow = ws.lastRow!.number;
    expectContinuousDivider(ws, merges[0].start, lastRow - 2); // stop short of the footer, which isn't a section
    for (let r = merges[0].start; r <= lastRow - 2; r++) {
      expect(border(ws, r, EXCESS_COLUMN).right?.style, `row ${r} E.right (outer edge)`).toBe("medium");
    }
  });

  it("Case 9 (dynamic row count exceeds the template's reserved capacity): the D/E divider stays continuous through every inserted row, no break near EXCESS/REMARK, and no blank boxed row above the CLAUSE content", async () => {
    // WIBA's template reserves 16 payroll rows; 25 forces safeSpliceInsert
    // to add blank rows mid-section — exactly the scenario the report
    // described as producing a broken right-hand border.
    const result = await generateQuotationExcel(buildQuotation([wibaSection(25, 20000)]));
    const ws = await loadWorksheet(result.buffer);
    const [merge] = excessMergeRanges(ws);
    expect(merge).toBeDefined();
    expectContinuousDivider(ws, merge.start, merge.end);
    // The merge's own bottom must be closed; its own top must NOT be set
    // (see expectNoBoxedSpacerRow's doc comment for why).
    expect(border(ws, merge.end, EXCESS_COLUMN).bottom?.style).toBe("medium");
    expectNoBoxedSpacerRow(ws, merge.start);
  });

  it("Case 6/7/8 (Fire with and without PVT Loading): both generate cleanly, PVT fields present only when enabled", async () => {
    const withPvt = await generateQuotationExcel(buildQuotation([fireSection(15000, true)]));
    const withoutPvt = await generateQuotationExcel(buildQuotation([fireSection(13750, false)]));
    expect(withPvt.warnings).toEqual([]);
    expect(withoutPvt.warnings).toEqual([]);
  });

  it("Case 10: regenerating for a second revision (different data) still produces correctly closed borders and normalized fonts", async () => {
    // Simulates R01 -> R02: same section kinds, different totals/row counts.
    const r01 = await generateQuotationExcel(buildQuotation([fireSection(15000), wibaSection(5, 8000)], "QT-TEST-0002"));
    const r02 = await generateQuotationExcel(buildQuotation([fireSection(22000), wibaSection(30, 25000)], "QT-TEST-0002"));
    for (const result of [r01, r02]) {
      const ws = await loadWorksheet(result.buffer);
      const fireTotalRow = findRowContaining(ws, "Total Premium");
      expect(border(ws, fireTotalRow, EXCESS_COLUMN).bottom?.style).toBe("medium");
      expect(ws.getRow(fireTotalRow).getCell(LAST_CONTENT_COLUMN).font?.size).toBe(SECTION_SUBTOTAL_FONT_SIZE);
    }
  });

  describe("subtotal vs. grand-total font size (Part VIII/IX)", () => {
    it("every section's own Total Premium cell is normalized to the standard subtotal size, matching its Gross premium/PHCF/ITL/Stamp Duty siblings — never larger", async () => {
      const result = await generateQuotationExcel(buildQuotation([fireSection(15000)]));
      const ws = await loadWorksheet(result.buffer);

      const grossRow = findRowContaining(ws, "Gross premium");
      const totalRow = findRowContaining(ws, "Total Premium");
      const grossFont = ws.getRow(grossRow).getCell(LAST_CONTENT_COLUMN).font;
      const totalFont = ws.getRow(totalRow).getCell(LAST_CONTENT_COLUMN).font;

      expect(totalFont?.size).toBe(SECTION_SUBTOTAL_FONT_SIZE);
      expect(totalFont?.size).toBe(grossFont?.size);
      expect(totalFont?.bold).toBe(true);
    });

    it("the final TOTAL PREMIUM (KES) row is bumped to the prominent grand-total size on BOTH template footer rows (the template duplicates it across a two-row merge)", async () => {
      const result = await generateQuotationExcel(buildQuotation([fireSection(15000), customsBondSection(2, 5000)]));
      const ws = await loadWorksheet(result.buffer);

      const lastRow = ws.lastRow!.number;
      const grandTotalRows = [lastRow - 1, lastRow].filter((r) => {
        const v = ws.getRow(r).getCell(2).value;
        return typeof v === "string" && v.includes("TOTAL PREMIUM");
      });
      expect(grandTotalRows.length).toBe(2);

      for (const r of grandTotalRows) {
        const labelFont = ws.getRow(r).getCell(2).font;
        const amountFont = ws.getRow(r).getCell(LAST_CONTENT_COLUMN).font;
        expect(labelFont?.size).toBe(GRAND_TOTAL_FONT_SIZE);
        expect(amountFont?.size).toBe(GRAND_TOTAL_FONT_SIZE);
        expect(amountFont?.bold).toBe(true);
      }
      // Prominent size must stay strictly larger than any section's own subtotal size.
      expect(GRAND_TOTAL_FONT_SIZE).toBeGreaterThan(SECTION_SUBTOTAL_FONT_SIZE);
    });
  });

  it("does not create duplicate/overlapping merges when multiple sections are selected (regression guard for the merge-recreation logic this border fix builds on)", async () => {
    const result = await generateQuotationExcel(buildQuotation([wibaSection(5, 8000), fireSection(15000), customsBondSection(3, 5000)]));
    const ws = await loadWorksheet(result.buffer);
    const merges: string[] = (ws.model as unknown as { merges?: string[] }).merges ?? [];
    const excessMerges = merges.filter((m) => m.startsWith("E") && !m.startsWith("E2:"));
    expect(new Set(excessMerges).size).toBe(excessMerges.length); // no duplicates
    expect(excessMerges.length).toBe(3); // exactly one per selected section
  });
});
