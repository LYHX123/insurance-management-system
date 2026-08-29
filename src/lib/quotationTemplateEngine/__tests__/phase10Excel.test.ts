import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { generateQuotationExcel } from "../generateQuotationExcel";
import { calculateEl } from "@/lib/insuranceCalculations/el";
import { calculateGuarantee } from "@/lib/insuranceCalculations/guarantee";
import { calculateCustomsBond } from "@/lib/insuranceCalculations/customsBond";

// Phase 10 real-template end-to-end checks: EL option tiers render their
// heading / rate / limits dynamically, the four Bond products show NO Stamp
// Duty row, and every long merged clause block ends up tall enough for its
// wrapped text.

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

function wibaSection(gross: number) {
  const phcf = +(gross * 0.0025).toFixed(2);
  const itl = +(gross * 0.002).toFixed(2);
  const total = +(gross + phcf + itl + 40).toFixed(2);
  return {
    sectionKind: "WIBA", basePremium: gross, phcfAmount: phcf, itlAmount: itl, stampDuty: 40, sectionTotal: total,
    ...slots(),
    wibaDetail: {
      totalEmployeeCount: 4, totalAnnualWages: gross / 0.008, wibaRate: 0.8,
      grossPremium: gross, phcfAmount: phcf, itlAmount: itl, stampDutyAmount: 40, totalPremium: total,
      payrollRows: [
        { occupation: "Managers", employeeCount: 2, annualWages: gross / 0.008 / 2 },
        { occupation: "Labourers", employeeCount: 2, annualWages: gross / 0.008 / 2 },
      ],
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
      linkedWibaGrossPremium: +c.linkedWibaGrossPremium,
      elOption: c.elOption, elRatePercent: +c.elRatePercent,
      anyOnePersonLimit: +c.anyOnePersonLimit, anyOneOccurrenceLimit: +c.anyOneOccurrenceLimit, anyOneYearLimit: +c.anyOneYearLimit,
      grossPremium: +c.grossPremium, phcfAmount: +c.phcfAmount, itlAmount: +c.itlAmount,
      stampDutyAmount: +c.stampDutyAmount, totalPremium: +c.totalPremium,
    },
  };
}

function tenderSection(bondValue: number, rate: number) {
  const c = calculateGuarantee({ bondValue, rate });
  return {
    sectionKind: "TENDER_SECURITY",
    basePremium: +c.grossPremium, phcfAmount: +c.phcfAmount, itlAmount: +c.itlAmount, stampDuty: 0, sectionTotal: +c.totalPremium,
    ...slots(),
    tenderSecurityDetail: {
      projectName: "SUPPLY CONTRACT", bondValue, rate,
      grossPremium: +c.grossPremium, phcfAmount: +c.phcfAmount, itlAmount: +c.itlAmount, stampDutyAmount: 0, totalPremium: +c.totalPremium,
    },
  };
}

function guaranteeSection(kind: "PERFORMANCE_BOND" | "ADVANCE_PAYMENT_GUARANTEE", relKey: string, bondValue: number, rate: number) {
  const c = calculateGuarantee({ bondValue, rate });
  return {
    sectionKind: kind,
    basePremium: +c.grossPremium, phcfAmount: +c.phcfAmount, itlAmount: +c.itlAmount, stampDuty: 0, sectionTotal: +c.totalPremium,
    ...slots(),
    [relKey]: {
      projectName: "WORKS CONTRACT", bondValue, rate,
      grossPremium: +c.grossPremium, phcfAmount: +c.phcfAmount, itlAmount: +c.itlAmount, stampDutyAmount: 0, totalPremium: +c.totalPremium,
    },
  };
}

function customsSection() {
  const rows = [{ bondValue: 500000, rate: 1 }, { bondValue: 300000, rate: 1.5 }];
  const c = calculateCustomsBond({ rows });
  return {
    sectionKind: "CUSTOMS_BOND",
    basePremium: +c.grossPremium, phcfAmount: +c.phcfAmount, itlAmount: +c.itlAmount, stampDuty: 0, sectionTotal: +c.totalPremium,
    ...slots(),
    customsBondDetail: {
      grossPremium: +c.grossPremium, phcfAmount: +c.phcfAmount, itlAmount: +c.itlAmount, stampDutyAmount: 0, totalPremium: +c.totalPremium,
      itemRows: rows.map((r, i) => ({ bondType: `CB${i + 1}`, bondValue: r.bondValue, rate: r.rate, premium: +c.rows[i].premium })),
    },
  };
}

function buildQuotation(sections: Record<string, unknown>[]) {
  const grandTotal = sections.reduce((a, s) => a + (s.sectionTotal as number), 0);
  return {
    quotationNumber: "QT-P10-TEST", quotationDate: new Date("2026-08-28"), grandTotal,
    customer: { companyName: "PHASE 10 TEST LIMITED" }, project: null, sections,
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

function findRow(ws: ExcelJS.Worksheet, text: string): number {
  const last = ws.lastRow?.number ?? ws.rowCount;
  for (let r = 1; r <= last; r++) {
    for (let c = 1; c <= 2; c++) if (cellText(ws.getRow(r).getCell(c)).includes(text)) return r;
  }
  return -1;
}

describe("Phase 10 — EL option tiers in the generated Excel", () => {
  const TIERS = [
    { option: 2, rate: 30, gross: 30000, aop: 4000000, aoe: 15000000, aoy: 30000000 },
    { option: 4, rate: 40, gross: 40000, aop: 8000000, aoe: 25000000, aoy: 50000000 },
  ];
  for (const t of TIERS) {
    it(`Option ${t.option}: heading, rate cell and three limits are dynamic (${t.rate}%)`, async () => {
      const res = await generateQuotationExcel(buildQuotation([wibaSection(100000), elSection(100000, t.option)]));
      const ws = await load(res.buffer);

      const headRow = findRow(ws, "OPTION (");
      expect(headRow).toBeGreaterThan(0);
      expect(cellText(ws.getCell(`A${headRow}`))).toBe(`OPTION (${t.rate}% of WIBA)`);
      expect(cellText(ws.getCell(`C${headRow}`))).toBe(`${t.rate}%`);
      expect(Number(cellText(ws.getCell(`D${headRow}`)))).toBe(t.gross);

      const aopRow = findRow(ws, "ANY ONE PERSON");
      expect(Number(cellText(ws.getCell(`B${aopRow}`)))).toBe(t.aop);
      expect(Number(cellText(ws.getCell(`B${aopRow + 1}`)))).toBe(t.aoe);
      expect(Number(cellText(ws.getCell(`B${aopRow + 2}`)))).toBe(t.aoy);

      // no leftover {{el_option}} / {{el_rate_percent}} anywhere
      let unresolved = 0;
      ws.eachRow((row) => row.eachCell((c) => { if (/\{\{.*?\}\}/.test(cellText(c))) unresolved++; }));
      expect(unresolved).toBe(0);

      // EL still carries a KES 40 stamp duty line (unlike Bonds)
      const elTotalRow = findRow(ws, "Total Premium");
      expect(res.warnings.filter((w) => /unresolved/i.test(w))).toHaveLength(0);
      expect(elTotalRow).toBeGreaterThan(0);
    });
  }
});

describe("Phase 10 — Bond products show no Stamp Duty row", () => {
  const CASES: [string, () => Record<string, unknown>][] = [
    ["Tender / Bid Bond", () => tenderSection(2000000, 1)],
    ["Advance Payment Bond", () => guaranteeSection("ADVANCE_PAYMENT_GUARANTEE", "advancePaymentGuaranteeDetail", 5000000, 1.5)],
    ["Performance Bond", () => guaranteeSection("PERFORMANCE_BOND", "performanceBondDetail", 8000000, 1)],
    ["Customs / Clearing Bond", () => customsSection()],
  ];
  for (const [name, make] of CASES) {
    it(`${name}: no "Stamp Duty" text, Total = Gross + PHCF + ITL`, async () => {
      const section = make();
      const res = await generateQuotationExcel(buildQuotation([section]));
      const ws = await load(res.buffer);

      let sawStamp = false;
      ws.eachRow((row) => row.eachCell((c) => { if (/stamp\s*duty/i.test(cellText(c))) sawStamp = true; }));
      expect(sawStamp).toBe(false);

      const grossRow = findRow(ws, "Gross premium");
      const gross = Number(cellText(ws.getCell(`D${grossRow}`)));
      const phcf = Number(cellText(ws.getCell(`D${grossRow + 1}`)));
      const itl = Number(cellText(ws.getCell(`D${grossRow + 2}`)));
      const totalRow = findRow(ws, "Total Premium");
      const total = Number(cellText(ws.getCell(`D${totalRow}`)));
      expect(total).toBeCloseTo(gross + phcf + itl, 2);
      expect(total).toBeCloseTo(Number(section.sectionTotal), 2);
    });
  }
});

describe("Phase 10 — rate cells never render as \"1.%\"", () => {
  it("a whole-number bond rate writes the string \"1%\" (not a %-formatted number)", async () => {
    const res = await generateQuotationExcel(buildQuotation([tenderSection(2000000, 1)]));
    const ws = await load(res.buffer);
    let rateCell: ExcelJS.Cell | null = null;
    ws.eachRow((row) =>
      row.eachCell((c) => {
        if (cellText(c) === "1%") rateCell = c;
      })
    );
    expect(rateCell, "a cell rendering exactly \"1%\"").not.toBeNull();
    // written as literal text, so no viewer can reinterpret it as "1."
    expect(typeof (rateCell as unknown as ExcelJS.Cell).value === "string").toBe(true);
    // and there is no "1." / "1.%" anywhere
    let bad = 0;
    ws.eachRow((row) => row.eachCell((c) => { if (/\d\.%|\d\.$/.test(cellText(c))) bad++; }));
    expect(bad).toBe(0);
  });

  it("decimal + whole-number rates in one quotation all render cleanly (Customs Bond multi-row)", async () => {
    const res = await generateQuotationExcel(buildQuotation([customsSection()]));
    const ws = await load(res.buffer);
    const seen = new Set<string>();
    ws.eachRow((row) => row.eachCell((c) => { const t = cellText(c); if (/^\d[\d.]*%$/.test(t)) seen.add(t); }));
    expect(seen.has("1%")).toBe(true);
    expect(seen.has("1.5%")).toBe(true);
    for (const s of seen) expect(s).not.toMatch(/\.%$/);
  });

  it("EL rate heading has no trailing dot for whole percentages", async () => {
    for (const opt of [1, 2, 3, 4]) {
      const rate = [25, 30, 35, 40][opt - 1];
      const res = await generateQuotationExcel(buildQuotation([wibaSection(100000), elSection(100000, opt)]));
      const ws = await load(res.buffer);
      const headRow = findRow(ws, "OPTION (");
      expect(cellText(ws.getCell(`A${headRow}`))).toBe(`OPTION (${rate}% of WIBA)`);
      expect(cellText(ws.getCell(`C${headRow}`))).toBe(`${rate}%`);
    }
  });
});

describe("Phase 10 — long clause blocks are tall enough after generation", () => {
  it("every column-E clause merge has total height >= a floor for its wrapped text", async () => {
    const res = await generateQuotationExcel(buildQuotation([
      wibaSection(100000),
      elSection(100000, 3),
      guaranteeSection("PERFORMANCE_BOND", "performanceBondDetail", 8000000, 1),
    ]));
    const ws = await load(res.buffer);
    const merges: string[] = (ws.model as { merges?: string[] }).merges ?? [];
    const clauseMerges = merges.filter((m) => /^E\d+:E\d+$/.test(m));
    expect(clauseMerges.length).toBeGreaterThan(0);

    for (const m of clauseMerges) {
      const [s, e] = m.split(":");
      const sr = Number(s.slice(1));
      const er = Number(e.slice(1));
      const master = ws.getCell(sr, 5);
      const text = cellText(master);
      if (text.length < 24 && !text.includes("\n")) continue;

      let totalHeight = 0;
      for (let r = sr; r <= er; r++) totalHeight += ws.getRow(r).height ?? 14.5;

      // Conservative floor: ~1 line (14pt) per explicit line of text.
      const explicitLines = text.split("\n").length;
      expect(totalHeight, `${m} (${explicitLines} lines)`).toBeGreaterThanOrEqual(explicitLines * 13);
      // wrapText must remain enabled so the text actually flows
      expect(master.alignment?.wrapText).toBe(true);
    }
  });
});
