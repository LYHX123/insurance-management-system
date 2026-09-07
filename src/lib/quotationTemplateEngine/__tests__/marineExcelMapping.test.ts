import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { mapQuotationData } from "../mapQuotationData";
import { generateQuotationExcel } from "../generateQuotationExcel";
import { calculateMarine } from "@/lib/insuranceCalculations/marine";

// Phase 13B (final rule) — Marine quotation Excel output, PER SHIPMENT:
//   Basic Sum Insured  = Sum Insured x 1.10
//   Raw Premium         = Basic Sum Insured x Rate         (always shown)
//   Chargeable Premium  = max(Raw Premium, KES 5,000)      (per shipment)
//   Gross Premium       = sum of the per-shipment Chargeable Premiums
//   PHCF / ITL          = Gross Premium x 0.25% / 0.20%
//   Stamp Duty          = Total Basic Sum Insured x 0.05%
//   Total               = Gross Premium + PHCF + ITL + Stamp Duty
//
// The Excel generator consumes mapQuotationData() output, which reads the
// persisted MarineSectionDetail snapshot (no recalculation on read) and
// derives the per-shipment "Minimum Premium Applied" note purely from each
// row's stored line premium.

const SHEET = "WITH PVT (INTRA)";

function slots() {
  return {
    carDetail: null, wibaDetail: null, elDetail: null, cpmDetail: null,
    publicLiabilityDetail: null, fireDetail: null, burglaryDetail: null,
    gitSingleDetail: null, gitAnnualDetail: null, marineDetail: null,
    motorCompPrivateDetail: null, motorCompCommercialDetail: null,
    motorTpoPrivateDetail: null, motorTpoCommercialDetail: null,
    gpaDetail: null, medicalDetail: null, tenderSecurityDetail: null,
    performanceBondDetail: null, advancePaymentGuaranteeDetail: null,
    customsBondDetail: null,
  };
}

// Builds a persisted-shape Marine section from raw shipment inputs, using the
// real calculateMarine() so the snapshot is exactly what buildMarineSection
// would have written.
function marineSection(shipments: { sumInsured: number; rate: number }[]) {
  const c = calculateMarine({ shipmentRows: shipments });
  return {
    id: "sec-marine",
    sectionKind: "MARINE_COVER",
    insuranceTypeNameSnapshot: "Marine",
    description: null,
    basePremium: +c.grossPremium,
    phcfAmount: +c.phcfAmount,
    itlAmount: +c.itlAmount,
    stampDuty: +c.marineStampDutyAmount,
    sectionTotal: +c.totalPremium,
    clausesSnapshot: null,
    exclusionsSnapshot: null,
    conditionsSnapshot: null,
    items: [],
    ...slots(),
    marineDetail: {
      cargoDescription: "MACHINERY",
      origin: "SHANGHAI",
      destination: "MOMBASA",
      marineStampDutyRate: 0.05,
      totalSumInsured: +c.totalSumInsured,
      grossPremium: +c.grossPremium,
      phcfAmount: +c.phcfAmount,
      itlAmount: +c.itlAmount,
      marineStampDutyAmount: +c.marineStampDutyAmount,
      totalPremium: +c.totalPremium,
      shipmentRows: c.rows.map((r, i) => ({
        referenceNo: `INV-${i + 1}`,
        sumInsured: +r.sumInsured,
        rate: shipments[i].rate,
        linePremium: +r.linePremium,
        sortOrder: i,
      })),
    },
  };
}

// A pre-13B persisted Marine section: caller supplies the exact stored
// numbers, which must survive the read/Excel path untouched.
function legacyMarineSection(detail: Record<string, unknown>) {
  return {
    id: "sec-marine",
    sectionKind: "MARINE_COVER",
    insuranceTypeNameSnapshot: "Marine",
    description: null,
    basePremium: detail.grossPremium,
    phcfAmount: detail.phcfAmount,
    itlAmount: detail.itlAmount,
    stampDuty: detail.marineStampDutyAmount,
    sectionTotal: detail.totalPremium,
    clausesSnapshot: null,
    exclusionsSnapshot: null,
    conditionsSnapshot: null,
    items: [],
    ...slots(),
    marineDetail: {
      cargoDescription: "MACHINERY",
      origin: "SHANGHAI",
      destination: "MOMBASA",
      marineStampDutyRate: 0.05,
      totalSumInsured: detail.totalSumInsured,
      grossPremium: detail.grossPremium,
      phcfAmount: detail.phcfAmount,
      itlAmount: detail.itlAmount,
      marineStampDutyAmount: detail.marineStampDutyAmount,
      totalPremium: detail.totalPremium,
      shipmentRows: [{ referenceNo: "INV-1", sumInsured: detail.totalSumInsured, rate: 0.8, linePremium: detail.linePremium, sortOrder: 0 }],
    },
  };
}

function buildQuotation(sections: Record<string, unknown>[]) {
  const grandTotal = sections.reduce((acc, s) => acc + Number(s.sectionTotal), 0);
  return {
    quotationNumber: "QT-13B-0001",
    quotationDate: new Date("2026-08-10"),
    grandTotal,
    customer: { companyName: "MARINE TEST CUSTOMER LIMITED" },
    project: null,
    sections,
  } as unknown as Parameters<typeof generateQuotationExcel>[0];
}

async function loadWs(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.getWorksheet(SHEET)!;
}

function cellStr(ws: ExcelJS.Worksheet, row: number, col: number): string {
  const v = ws.getRow(row).getCell(col).value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "richText" in (v as object)) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  return String(v);
}

function scanSheet(ws: ExcelJS.Worksheet) {
  const last = ws.lastRow?.number ?? ws.rowCount;
  const literals: string[] = [];
  const notes: string[] = [];
  const rawPremiums: number[] = [];
  let gross = 0;
  let stamp = 0;
  let total = 0;
  for (let r = 1; r <= last; r++) {
    for (let c = 1; c <= 5; c++) {
      const t = cellStr(ws, r, c);
      if (t.includes("{{")) literals.push(`${r},${c}=${t}`);
      if (/Minimum Premium Applied/i.test(t)) notes.push(`B${r}`);
    }
    const label = cellStr(ws, r, 2).trim().toLowerCase();
    if (label === "gross premium") gross = Number(ws.getRow(r).getCell(4).value);
    if (label === "stamp duty") stamp = Number(ws.getRow(r).getCell(4).value);
    if (label === "total premium") total = Number(ws.getRow(r).getCell(4).value);
    if (cellStr(ws, r, 1).trim() === "Basic Sum Insured") rawPremiums.push(Number(ws.getRow(r).getCell(4).value));
  }
  return { literals, notes, rawPremiums, gross, stamp, total };
}

function clauseMerge(ws: ExcelJS.Worksheet) {
  const merges: string[] = (ws.model as { merges?: string[] }).merges ?? [];
  for (const m of merges.filter((x) => /^E\d+:E\d+$/.test(x))) {
    const [s, e] = m.split(":");
    const start = Number(s.slice(1));
    const end = Number(e.slice(1));
    const text = cellStr(ws, start, 5);
    if (text.includes("Institute classification")) return { start, end, text };
  }
  return null;
}

describe("mapQuotationData — Marine per-shipment minimum-premium note", () => {
  it("floored shipment -> label + amount; unaffected shipment -> both blank", () => {
    const mapped = mapQuotationData(
      buildQuotation([
        marineSection([
          { sumInsured: 1_000_000, rate: 0.15 }, // raw 1,650 -> floored
          { sumInsured: 2_000_000, rate: 0.3 }, // raw 6,600 -> not floored
          { sumInsured: 500_000, rate: 0.15 }, // raw 825 -> floored
        ]),
      ])
    );
    const dyn = mapped.sections[0].dynamicRows!;
    expect(dyn[0].marine_minimum_premium_label).toBe("Minimum Premium Applied:");
    expect(dyn[0].marine_minimum_premium_amount).toBe(5000);
    expect(dyn[0].marine_line_premium).toBe(1650); // raw premium NOT replaced

    expect(dyn[1].marine_minimum_premium_label).toBe("");
    expect(dyn[1].marine_minimum_premium_amount).toBe("");
    expect(dyn[1].marine_line_premium).toBe(6600);

    expect(dyn[2].marine_minimum_premium_label).toBe("Minimum Premium Applied:");
    expect(dyn[2].marine_minimum_premium_amount).toBe(5000);

    // summary section
    const v = mapped.sections[0].values;
    expect(v.marine_gross_premium).toBe(16600); // 5,000 + 6,600 + 5,000
    expect(v.marine_stamp_duty).toBe(1925); // 3,850,000 x 0.05%
    expect(v.marine_total_premium).toBe(18599.7);
  });

  it("a legacy Marine quotation maps its stored monetary numbers unchanged", () => {
    const LEGACY = { totalSumInsured: 1_000_000, grossPremium: 8800, phcfAmount: 22, itlAmount: 17.6, marineStampDutyAmount: 550, totalPremium: 9389.6, linePremium: 8800 };
    const mapped = mapQuotationData(buildQuotation([legacyMarineSection(LEGACY)]));
    const v = mapped.sections[0].values;
    expect(v.marine_gross_premium).toBe(8800);
    expect(v.marine_stamp_duty).toBe(550);
    expect(v.marine_total_premium).toBe(9389.6);
    // rated premium >= 5,000 -> no note
    expect(mapped.sections[0].dynamicRows![0].marine_minimum_premium_label).toBe("");
  });
});

describe("generateQuotationExcel — Marine per-shipment (end to end)", () => {
  it("Test A: single floored shipment — raw premium shown, note shown, Gross 5,000, Stamp 550, Total 5,572.50", async () => {
    const res = await generateQuotationExcel(buildQuotation([marineSection([{ sumInsured: 1_000_000, rate: 0.15 }])]));
    expect(res.warnings).toEqual([]);
    const ws = await loadWs(res.buffer);
    const s = scanSheet(ws);
    expect(s.literals).toEqual([]); // no leftover {{marine_minimum_premium_*}}
    expect(s.rawPremiums).toContain(1650); // the raw rated premium is still on the sheet
    expect(s.notes.length).toBe(1); // exactly one shipment note
    expect(s.gross).toBe(5000);
    expect(s.stamp).toBe(550);
    expect(s.total).toBe(5572.5);
  });

  it("Test B: single non-floored shipment — no note, Gross 8,800, Total 9,389.60", async () => {
    const res = await generateQuotationExcel(buildQuotation([marineSection([{ sumInsured: 1_000_000, rate: 0.8 }])]));
    expect(res.warnings).toEqual([]);
    const s = scanSheet(await loadWs(res.buffer));
    expect(s.literals).toEqual([]);
    expect(s.notes.length).toBe(0);
    expect(s.gross).toBe(8800);
    expect(s.stamp).toBe(550);
    expect(s.total).toBe(9389.6);
  });

  it("Test C: 3 shipments (floor / no-floor / floor) — independent notes, Gross 16,600, Stamp 1,925, Total 18,599.70", async () => {
    const res = await generateQuotationExcel(
      buildQuotation([
        marineSection([
          { sumInsured: 1_000_000, rate: 0.15 },
          { sumInsured: 2_000_000, rate: 0.3 },
          { sumInsured: 500_000, rate: 0.15 },
        ]),
      ])
    );
    expect(res.warnings).toEqual([]);
    const ws = await loadWs(res.buffer);
    const s = scanSheet(ws);
    expect(s.literals).toEqual([]);
    expect(s.notes.length).toBe(2); // shipments 1 & 3 only
    expect(s.rawPremiums).toEqual(expect.arrayContaining([1650, 6600, 825]));
    expect(s.gross).toBe(16600);
    expect(s.stamp).toBe(1925);
    expect(s.total).toBe(18599.7);

    // Test 18/19 — the full current clause + EXCESS text is present, and the
    // clause merge extended to hold it (never truncated by the extra rows).
    const cm = clauseMerge(ws)!;
    expect(cm.text).toContain("Institute classification cluase");
    expect(cm.text).toContain("Excluding Hull War, Piracy, Terrorism and Related Perils");
    expect(cm.text).toContain("EXCESS");
    expect(cm.text).toContain("10% of consignment value minimum Kshs 50,000/-");
    let h = 0;
    for (let r = cm.start; r <= cm.end; r++) h += ws.getRow(r).height ?? 14.5;
    expect(h).toBeGreaterThanOrEqual(cm.text.split("\n").length * 13);
  });

  it("Test 13: 6 shipments (beyond the template's reserved capacity) — dynamic rows expand, notes stay per-shipment, no crash", async () => {
    const res = await generateQuotationExcel(
      buildQuotation([marineSection(Array.from({ length: 6 }, (_, i) => ({ sumInsured: 1_000_000 * (i + 1), rate: 0.15 })))])
    );
    expect(res.warnings).toEqual([]);
    const s = scanSheet(await loadWs(res.buffer));
    expect(s.literals).toEqual([]);
    // raw premiums 1,650 / 3,300 / 4,950 are < 5,000 -> 3 notes; 6,600 / 8,250 / 9,900 -> none
    expect(s.notes.length).toBe(3);
    expect(s.gross).toBe(39750); // 5,000*3 + 6,600 + 8,250 + 9,900
  });
});
