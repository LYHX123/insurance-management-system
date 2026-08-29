import { describe, it, expect } from "vitest";
import { calculateEl } from "../el";
import { previewEl } from "../clientPreview";
import { EL_OPTIONS, resolveElOption, DEFAULT_EL_OPTION } from "../constants";

// Phase 10 — Employer's Liability option tiers. WIBA Gross Premium = 100,000
// throughout, matching this phase's spec examples exactly.
const WIBA_GROSS = 100_000;

const EXPECTED: Record<number, { rate: number; gross: number; aop: number; aoe: number; aoy: number }> = {
  1: { rate: 25, gross: 25_000, aop: 2_000_000, aoe: 10_000_000, aoy: 20_000_000 },
  2: { rate: 30, gross: 30_000, aop: 4_000_000, aoe: 15_000_000, aoy: 30_000_000 },
  3: { rate: 35, gross: 35_000, aop: 6_000_000, aoe: 20_000_000, aoy: 40_000_000 },
  4: { rate: 40, gross: 40_000, aop: 8_000_000, aoe: 25_000_000, aoy: 50_000_000 },
};

describe("calculateEl — option tiers", () => {
  for (const option of [1, 2, 3, 4] as const) {
    const e = EXPECTED[option];
    it(`Option ${option}: ${e.rate}% of WIBA -> EL gross ${e.gross}, limits ${e.aop}/${e.aoe}/${e.aoy}`, () => {
      const r = calculateEl(WIBA_GROSS, option);
      expect(r.elOption).toBe(option);
      expect(r.elRatePercent).toBe(e.rate);
      expect(Number(r.grossPremium)).toBe(e.gross);
      expect(Number(r.anyOnePersonLimit)).toBe(e.aop);
      expect(Number(r.anyOneOccurrenceLimit)).toBe(e.aoe);
      expect(Number(r.anyOneYearLimit)).toBe(e.aoy);
      // Levies: PHCF 0.25% + ITL 0.2% of EL gross, + flat KES 40 stamp duty
      // (EL, unlike Bonds, still attracts stamp duty).
      expect(Number(r.phcfAmount)).toBeCloseTo(e.gross * 0.0025, 2);
      expect(Number(r.itlAmount)).toBeCloseTo(e.gross * 0.002, 2);
      expect(Number(r.stampDutyAmount)).toBe(40);
      expect(Number(r.totalPremium)).toBeCloseTo(
        e.gross + e.gross * 0.0025 + e.gross * 0.002 + 40,
        2
      );
    });
  }

  it("defaults to Option 1 (the pre-Phase-10 fixed 25% behaviour) when no option is given", () => {
    const r = calculateEl(WIBA_GROSS);
    expect(r.elOption).toBe(1);
    expect(r.elRatePercent).toBe(25);
    expect(Number(r.grossPremium)).toBe(25_000);
  });

  it("treats an unrecognised / historical option value as Option 1", () => {
    for (const bad of [undefined, null, 0, 5, "", "x", NaN]) {
      const r = calculateEl(WIBA_GROSS, bad as unknown);
      expect(r.elOption).toBe(1);
      expect(Number(r.grossPremium)).toBe(25_000);
    }
  });

  it("accepts a string option (as it arrives from the form)", () => {
    const r = calculateEl(WIBA_GROSS, "3");
    expect(r.elOption).toBe(3);
    expect(Number(r.grossPremium)).toBe(35_000);
  });
});

describe("previewEl (client mirror) matches calculateEl", () => {
  for (const option of [1, 2, 3, 4] as const) {
    it(`Option ${option}`, () => {
      const server = calculateEl(WIBA_GROSS, option);
      const client = previewEl(WIBA_GROSS, option);
      expect(client.elRatePercent).toBe(Number(server.elRatePercent));
      expect(client.grossPremium).toBe(Number(server.grossPremium));
      expect(client.anyOnePersonLimit).toBe(Number(server.anyOnePersonLimit));
      expect(client.anyOneOccurrenceLimit).toBe(Number(server.anyOneOccurrenceLimit));
      expect(client.anyOneYearLimit).toBe(Number(server.anyOneYearLimit));
      expect(client.totalPremium).toBeCloseTo(Number(server.totalPremium), 2);
    });
  }
});

describe("resolveElOption / EL_OPTIONS table", () => {
  it("DEFAULT_EL_OPTION is 1", () => {
    expect(DEFAULT_EL_OPTION).toBe(1);
    expect(resolveElOption(undefined)).toEqual(EL_OPTIONS[1]);
  });

  it("EL_OPTIONS table matches the spec", () => {
    expect(EL_OPTIONS[1]).toMatchObject({ ratePercent: 25, anyOnePersonLimit: 2_000_000, anyOneOccurrenceLimit: 10_000_000, anyOneYearLimit: 20_000_000 });
    expect(EL_OPTIONS[2]).toMatchObject({ ratePercent: 30, anyOnePersonLimit: 4_000_000, anyOneOccurrenceLimit: 15_000_000, anyOneYearLimit: 30_000_000 });
    expect(EL_OPTIONS[3]).toMatchObject({ ratePercent: 35, anyOnePersonLimit: 6_000_000, anyOneOccurrenceLimit: 20_000_000, anyOneYearLimit: 40_000_000 });
    expect(EL_OPTIONS[4]).toMatchObject({ ratePercent: 40, anyOnePersonLimit: 8_000_000, anyOneOccurrenceLimit: 25_000_000, anyOneYearLimit: 50_000_000 });
  });
});
