import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { generateQuotationExcel } from "../generateQuotationExcel";
import { calculateEl } from "@/lib/insuranceCalculations/el";
import { calculateMarine } from "@/lib/insuranceCalculations/marine";
import { calculateCpmStandalone } from "@/lib/insuranceCalculations/cpm";

// Phase 11 — Clause / Excess / Remark auto-height must grow ONLY the blank
// (flexible) rows of a section's column-E merge. The left-hand A-D
// business/financial rows (Sum Insured / Rate / Premium / Gross Premium /
// PHCF / ITL / Stamp Duty / Total Premium) keep their template height, so a
// multi-section quotation's financial rows all line up regardless of how
// long each section's own clause is.

const SHEET = "WITH PVT (INTRA)";
const TEMPLATE_ROW_HEIGHT = 15.45; // the template's ordinary row height
const STAMP_ROW_HEIGHT = 15.9; // the template's slightly-taller rows

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

function wibaSection(gross: number, occupations = 3) {
  const phcf = +(gross * 0.0025).toFixed(2);
  const itl = +(gross * 0.002).toFixed(2);
  const total = +(gross + phcf + itl + 40).toFixed(2);
  return {
    sectionKind: "WIBA", basePremium: gross, phcfAmount: phcf, itlAmount: itl, stampDuty: 40, sectionTotal: total,
    ...slots(),
    wibaDetail: {
      totalEmployeeCount: occupations * 2, totalAnnualWages: gross / 0.008, wibaRate: 0.8,
      grossPremium: gross, phcfAmount: phcf, itlAmount: itl, stampDutyAmount: 40, totalPremium: total,
      payrollRows: Array.from({ length: occupations }, (_, i) => ({ occupation: `Occupation ${i + 1}`, employeeCount: 2, annualWages: gross / 0.008 / occupations })),
    },
  };
}

function elSection(wibaGross: number, option: number) {
  const c = calculateEl(wibaGross, option);
  return {
    sectionKind: "EMPLOYERS_LIABILITY",
    basePremium: +c.grossPremium, phcfAmount: +c.phcfAmount, itlAmount: +c.itlAmount, stampDuty: +c.stampDutyAmount, sectionTotal: +c.totalPremium,
    ...slots(),
    elDetail: {
      linkedWibaGrossPremium: +c.linkedWibaGrossPremium, elOption: c.elOption, elRatePercent: +c.elRatePercent,
      anyOnePersonLimit: +c.anyOnePersonLimit, anyOneOccurrenceLimit: +c.anyOneOccurrenceLimit, anyOneYearLimit: +c.anyOneYearLimit,
      grossPremium: +c.grossPremium, phcfAmount: +c.phcfAmount, itlAmount: +c.itlAmount, stampDutyAmount: +c.stampDutyAmount, totalPremium: +c.totalPremium,
    },
  };
}

function marineSection(shipments = 3) {
  const shipmentRows = Array.from({ length: shipments }, (_, i) => ({ referenceNo: `INV-${i + 1}`, sumInsured: 1_000_000 + i * 400_000, rate: 0.35 }));
  const c = calculateMarine({ shipmentRows });
  return {
    sectionKind: "MARINE_COVER",
    basePremium: +c.grossPremium, phcfAmount: +c.phcfAmount, itlAmount: +c.itlAmount, stampDuty: +c.marineStampDutyAmount, sectionTotal: +c.totalPremium,
    ...slots(),
    marineDetail: {
      cargoDescription: "ASSORTED MACHINERY", origin: "SHANGHAI", destination: "MOMBASA",
      totalSumInsured: +c.totalSumInsured, grossPremium: +c.grossPremium, phcfAmount: +c.phcfAmount, itlAmount: +c.itlAmount,
      marineStampDutyAmount: +c.marineStampDutyAmount, totalPremium: +c.totalPremium,
      shipmentRows: c.rows.map((r, i) => ({ referenceNo: shipmentRows[i].referenceNo, sumInsured: +r.sumInsured, rate: shipmentRows[i].rate, linePremium: +r.linePremium })),
    },
  };
}

function cpmSection(equip = 2) {
  const equipmentRows = Array.from({ length: equip }, (_, i) => ({ equipmentName: `Excavator ${i + 1}`, quantity: 1, unitValue: 2_000_000, totalValue: 2_000_000, chassisOrPlate: null }));
  const c = calculateCpmStandalone({ equipmentRows: equipmentRows.map((r) => ({ quantity: r.quantity, unitValue: r.unitValue })), cpmRate: 0.75, pvtLoadingEnabled: false });
  return {
    sectionKind: "CPM_STANDALONE",
    basePremium: +c.grossPremium, phcfAmount: +c.phcfAmount, itlAmount: +c.itlAmount, stampDuty: +c.stampDutyAmount, sectionTotal: +c.totalPremium,
    ...slots(),
    cpmDetail: {
      cpmRate: 0.75, pvtLoadingEnabled: false, pvtLoadingRate: null, pvtLoadingAmount: 0, pvtLoadingPremium: 0,
      totalSumInsured: +c.totalSumInsured, basicPremium: +c.basicPremium, grossPremium: +c.grossPremium, phcfAmount: +c.phcfAmount,
      itlAmount: +c.itlAmount, stampDutyAmount: +c.stampDutyAmount, totalPremium: +c.totalPremium, equipmentRows,
    },
  };
}

function buildQuotation(sections: Record<string, unknown>[]) {
  const grandTotal = sections.reduce((a, s) => a + (s.sectionTotal as number), 0);
  return {
    quotationNumber: "QT-P11", quotationDate: new Date("2026-08-29"), grandTotal,
    customer: { companyName: "PHASE 11 TEST LIMITED" }, project: null, sections,
  } as unknown as Parameters<typeof generateQuotationExcel>[0];
}

async function load(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.getWorksheet(SHEET)!;
}
function cellText(c: ExcelJS.Cell): string {
  const v = c.value as unknown;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "richText" in (v as object)) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  if (typeof v === "object" && "formula" in (v as object)) return "=" + (v as { formula: string }).formula;
  if (typeof v === "object" && "result" in (v as object)) return String((v as { result: unknown }).result);
  return String(v);
}

/** Row numbers whose column B holds one of the section financial labels. */
function financialRows(ws: ExcelJS.Worksheet): { row: number; label: string; height: number }[] {
  const out: { row: number; label: string; height: number }[] = [];
  const last = ws.lastRow?.number ?? ws.rowCount;
  for (let r = 1; r <= last; r++) {
    const b = cellText(ws.getRow(r).getCell(2)).trim().toLowerCase();
    if (["gross premium", "phcf", "itl", "stamp duty", "total premium"].includes(b)) {
      out.push({ row: r, label: b, height: +(ws.getRow(r).height ?? 14.5).toFixed(2) });
    }
  }
  return out;
}

function clauseMerges(ws: ExcelJS.Worksheet): { start: number; end: number; text: string }[] {
  const merges: string[] = (ws.model as { merges?: string[] }).merges ?? [];
  return merges
    .filter((m) => /^E\d+:E\d+$/.test(m))
    .map((m) => {
      const [s, e] = m.split(":");
      const start = Number(s.slice(1));
      return { start, end: Number(e.slice(1)), text: cellText(ws.getCell(start, 5)) };
    })
    .filter((m) => m.text.length >= 24 || m.text.includes("\n"))
    .sort((a, b) => a.start - b.start);
}

describe("Phase 11 — WIBA + EL: clause auto-fit never changes financial rows", () => {
  it("every Gross Premium / PHCF / ITL / Stamp Duty / Total Premium row is at its template height", async () => {
    const res = await generateQuotationExcel(buildQuotation([wibaSection(120940, 3), elSection(120940, 2)]));
    const ws = await load(res.buffer);

    const fin = financialRows(ws);
    // 2 sections x 5 financial labels
    expect(fin.length).toBe(10);
    for (const f of fin) {
      const expected = f.label === "stamp duty" ? STAMP_ROW_HEIGHT
        : f.label === "total premium" ? 36.55
        : TEMPLATE_ROW_HEIGHT;
      expect(f.height, `${f.label} @ r${f.row}`).toBe(expected);
    }

    // WIBA's Gross/PHCF/ITL rows and EL's Gross/PHCF/ITL rows are identical
    const gpi = fin.filter((f) => ["gross premium", "phcf", "itl"].includes(f.label)).map((f) => f.height);
    expect(new Set(gpi).size).toBe(1);
    expect(gpi[0]).toBe(TEMPLATE_ROW_HEIGHT);
  });

  it("both clause blocks are fully contained (merge height >= a wrapped-text floor)", async () => {
    const res = await generateQuotationExcel(buildQuotation([wibaSection(120940, 3), elSection(120940, 2)]));
    const ws = await load(res.buffer);
    for (const m of clauseMerges(ws)) {
      let h = 0;
      for (let r = m.start; r <= m.end; r++) h += ws.getRow(r).height ?? 14.5;
      const explicitLines = m.text.split("\n").length;
      expect(h, `E${m.start}:E${m.end}`).toBeGreaterThanOrEqual(explicitLines * 13);
      expect(ws.getCell(m.start, 5).alignment?.wrapText).toBe(true);
      expect(ws.getCell(m.start, 5).alignment?.vertical).toBe("top");
    }
  });
});

describe("Phase 11 — Marine: financial rows keep template height for a very long clause", () => {
  for (const shipments of [1, 3]) {
    it(`${shipments} shipment(s): Gross/PHCF/ITL/Stamp/Total rows are template height, full clause fits`, async () => {
      const res = await generateQuotationExcel(buildQuotation([marineSection(shipments)]));
      const ws = await load(res.buffer);

      const fin = financialRows(ws);
      expect(fin.length).toBe(5);
      expect(fin.find((f) => f.label === "gross premium")!.height).toBe(TEMPLATE_ROW_HEIGHT);
      expect(fin.find((f) => f.label === "phcf")!.height).toBe(TEMPLATE_ROW_HEIGHT);
      expect(fin.find((f) => f.label === "itl")!.height).toBe(TEMPLATE_ROW_HEIGHT);
      expect(fin.find((f) => f.label === "stamp duty")!.height).toBe(STAMP_ROW_HEIGHT);

      // the 23-item Marine clause is all present in the merged master cell
      const [m] = clauseMerges(ws);
      expect(m.text).toContain("Institute classification cluase");
      expect(m.text).toContain("Sanction Clause");
      expect(m.text).toContain("EXCESS");
      expect(m.text).toContain("10% of consignment value minimum Kshs 50,000/-");

      // merge is tall enough for the wrapped text
      let h = 0;
      for (let r = m.start; r <= m.end; r++) h += ws.getRow(r).height ?? 14.5;
      expect(h).toBeGreaterThanOrEqual(m.text.split("\n").length * 13);

      // Total Premium sits BELOW the clause block
      const totalRow = fin.find((f) => f.label === "total premium")!.row;
      expect(totalRow).toBeGreaterThanOrEqual(m.end);
    });
  }
});

describe("Phase 11 — multi-section (WIBA + EL + CPM + Marine)", () => {
  it("financial rows are uniform across all four sections; clauses complete; totals correct; no overlap", async () => {
    const wiba = wibaSection(120940, 3);
    const el = elSection(120940, 2);
    const cpm = cpmSection(2);
    const marine = marineSection(3);
    const res = await generateQuotationExcel(buildQuotation([wiba, el, cpm, marine]));
    const ws = await load(res.buffer);

    // 1. every Gross/PHCF/ITL row across all 4 sections is exactly the template height
    const fin = financialRows(ws);
    const gpi = fin.filter((f) => ["gross premium", "phcf", "itl"].includes(f.label));
    expect(gpi.length).toBe(12); // 4 sections x 3
    expect(new Set(gpi.map((f) => f.height))).toEqual(new Set([TEMPLATE_ROW_HEIGHT]));

    // 2. no unresolved placeholders
    let unresolved = 0;
    ws.eachRow((row) => row.eachCell((c) => { if (/\{\{.*?\}\}/.test(cellText(c))) unresolved++; }));
    expect(unresolved).toBe(0);

    // 3. merges: one per section, non-overlapping, sorted
    const cm = clauseMerges(ws);
    expect(cm.length).toBe(4);
    for (let i = 1; i < cm.length; i++) expect(cm[i].start).toBeGreaterThan(cm[i - 1].end);

    // 4. each section's clause survives in full
    const allClauseText = cm.map((m) => m.text).join("\n");
    expect(allClauseText).toContain("COVERAGE COMPENSATION"); // WIBA
    expect(allClauseText).toContain("Cover on claims made basis"); // EL
    expect(allClauseText).toContain("Watchman Warranty"); // CPM
    expect(allClauseText).toContain("Institute classification cluase"); // Marine

    // 5. grand total
    const grand = (wiba.sectionTotal as number) + (el.sectionTotal as number) + (cpm.sectionTotal as number) + (marine.sectionTotal as number);
    let footerAmount = 0;
    ws.eachRow((row) => {
      if (cellText(row.getCell(2)).includes("TOTAL PREMIUM (KES)")) footerAmount = Number(cellText(row.getCell(4)));
    });
    expect(footerAmount).toBeCloseTo(grand, 2);

    // 6. print area covers the whole sheet
    expect(ws.pageSetup?.printArea).toBe(`A1:E${ws.lastRow?.number}`);

    // 7. no generation warnings about unresolved content
    expect(res.warnings.filter((w) => /unresolved/i.test(w))).toHaveLength(0);
  });
});
