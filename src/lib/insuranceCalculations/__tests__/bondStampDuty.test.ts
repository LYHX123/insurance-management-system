import { describe, it, expect } from "vitest";
import { calculateGuarantee } from "../guarantee";
import { calculateCustomsBond } from "../customsBond";
import { previewGuarantee, previewCustomsBond } from "../clientPreview";

// Phase 10 — the four Bond products (Tender/Bid Bond, Advance Payment Bond,
// Performance Bond, Customs/Clearing Bond) must NOT charge Stamp Duty. The
// calculation engine itself produces zero — it is not merely hidden in the
// Excel — and Stamp Duty is NOT part of Total Premium:
//   Total = Gross + PHCF + ITL   (never + Stamp Duty)

describe("calculateGuarantee — no Stamp Duty (Tender / Performance / APG)", () => {
  const cases = [
    { bondValue: 2_000_000, rate: 1 },
    { bondValue: 5_000_000, rate: 1.5 },
    { bondValue: 8_000_000, rate: 0.75 },
  ];
  for (const { bondValue, rate } of cases) {
    it(`bondValue ${bondValue} @ ${rate}%`, () => {
      const r = calculateGuarantee({ bondValue, rate });
      const gross = bondValue * (rate / 100);
      expect(Number(r.grossPremium)).toBeCloseTo(gross, 2);
      expect(Number(r.stampDutyAmount)).toBe(0);
      expect(Number(r.phcfAmount)).toBeCloseTo(gross * 0.0025, 2);
      expect(Number(r.itlAmount)).toBeCloseTo(gross * 0.002, 2);
      expect(Number(r.totalPremium)).toBeCloseTo(
        Number(r.grossPremium) + Number(r.phcfAmount) + Number(r.itlAmount),
        2
      );
      // explicit: total does NOT include the old flat KES 40
      expect(Number(r.totalPremium)).not.toBeCloseTo(
        Number(r.grossPremium) + Number(r.phcfAmount) + Number(r.itlAmount) + 40,
        2
      );
    });
  }

  it("previewGuarantee mirror also produces zero stamp duty", () => {
    const c = previewGuarantee({ bondValue: "5000000", rate: "1.5" });
    expect(c.stampDutyAmount).toBe(0);
    expect(c.totalPremium).toBeCloseTo(c.grossPremium + c.phcfAmount + c.itlAmount, 2);
  });
});

describe("calculateCustomsBond — no Stamp Duty", () => {
  it("multi-row customs bond: stamp duty zero, total = gross + phcf + itl", () => {
    const r = calculateCustomsBond({
      rows: [
        { bondValue: 500_000, rate: 1 },
        { bondValue: 300_000, rate: 1.5 },
      ],
    });
    const gross = 500_000 * 0.01 + 300_000 * 0.015;
    expect(Number(r.grossPremium)).toBeCloseTo(gross, 2);
    expect(Number(r.stampDutyAmount)).toBe(0);
    expect(Number(r.totalPremium)).toBeCloseTo(
      Number(r.grossPremium) + Number(r.phcfAmount) + Number(r.itlAmount),
      2
    );
    // per-item premiums are untouched by the stamp-duty change
    expect(r.rows).toHaveLength(2);
    expect(Number(r.rows[0].premium)).toBeCloseTo(5_000, 2);
    expect(Number(r.rows[1].premium)).toBeCloseTo(4_500, 2);
  });

  it("previewCustomsBond mirror also produces zero stamp duty", () => {
    const c = previewCustomsBond({ rows: [{ bondValue: "500000", rate: "1" }] });
    expect(c.stampDutyAmount).toBe(0);
    expect(c.totalPremium).toBeCloseTo(c.grossPremium + c.phcfAmount + c.itlAmount, 2);
  });
});
