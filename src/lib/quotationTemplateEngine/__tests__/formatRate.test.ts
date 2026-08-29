import { describe, it, expect } from "vitest";
import { formatRatePercent, trimNumberString } from "../formatRate";

// Phase 10 issue 3 — quotation Excel percentage formatting. A whole-number
// rate used to render as "1.%" / "2.%" (Excel's "0.###%" custom format
// leaves a dangling decimal point on integers). Rates are now written as
// pre-formatted strings.

describe("formatRatePercent", () => {
  const cases: [number, string][] = [
    [1, "1%"],
    [2, "2%"],
    [1.5, "1.5%"],
    [2.5, "2.5%"],
    [0.075, "0.075%"],
    [0.15, "0.15%"],
    [0.25, "0.25%"],
    [0.2, "0.2%"],
    [0.8, "0.8%"],
    [0.35, "0.35%"],
    [40, "40%"],
    [30, "30%"],
    [0, "0%"],
    [10, "10%"],
    [100, "100%"],
  ];
  for (const [input, expected] of cases) {
    it(`${input} -> "${expected}"`, () => {
      expect(formatRatePercent(input)).toBe(expected);
    });
  }

  it("never produces a dangling decimal point", () => {
    for (const n of [1, 2, 3, 10, 25, 40, 100]) {
      expect(formatRatePercent(n)).not.toMatch(/\.%$/);
      expect(formatRatePercent(n)).toBe(`${n}%`);
    }
  });

  it("kills floating-point artifacts", () => {
    expect(formatRatePercent(0.1 + 0.05)).toBe("0.15%"); // 0.15000000000000002
    expect(formatRatePercent(0.35 / 100 * 100)).toBe("0.35%"); // 0.0034999.. * 100
    expect(formatRatePercent(3 * 0.1)).toBe("0.3%"); // 0.30000000000000004
    expect(formatRatePercent(1.005 * 100 / 100)).toBe("1.005%");
  });

  it("accepts strings and rejects junk", () => {
    expect(formatRatePercent("1.5")).toBe("1.5%");
    expect(formatRatePercent("")).toBe("");
    expect(formatRatePercent(null)).toBe("");
    expect(formatRatePercent(undefined)).toBe("");
    expect(formatRatePercent(Number.NaN)).toBe("");
    expect(formatRatePercent(Infinity)).toBe("");
  });
});

describe("trimNumberString", () => {
  it("trims trailing zeros and dangling points", () => {
    expect(trimNumberString(1)).toBe("1");
    expect(trimNumberString(2)).toBe("2");
    expect(trimNumberString(1.5)).toBe("1.5");
    expect(trimNumberString(0.075)).toBe("0.075");
    expect(trimNumberString(0.2)).toBe("0.2");
    expect(trimNumberString(0)).toBe("0");
    expect(trimNumberString(30)).toBe("30");
  });
});
