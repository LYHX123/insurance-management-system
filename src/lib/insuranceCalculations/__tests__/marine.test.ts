import { describe, it, expect } from "vitest";
import {
  calculateMarine,
  deriveMarineChargeableLinePremium,
  isMarineMinimumPremiumApplied,
} from "../marine";
import { previewMarine } from "../clientPreview";
import { calculateCpmStandalone } from "../cpm";
import { calculateFire } from "../fire";
import { calculateGitSingle } from "../gitSingle";
import { MARINE_MINIMUM_BASE_PREMIUM, MARINE_STAMP_DUTY_RATE, STAMP_DUTY } from "../constants";

// Phase 13B (final rule) — Marine Insurance, PER SHIPMENT:
//   Basic Sum Insured   = Sum Insured x 1.10
//   Raw Premium          = Basic Sum Insured x Rate
//   Chargeable Premium   = max(Raw Premium, KES 5,000)      <- floored per shipment
//   Gross Premium        = sum of each shipment's Chargeable Premium
//                          (NEVER max(sum(raw premiums), 5,000))
//   PHCF                 = Gross Premium x 0.25%
//   ITL                  = Gross Premium x 0.20%
//   Marine Stamp Duty    = Total Basic Sum Insured x 0.05%
//   Total Premium        = Gross Premium + PHCF + ITL + Stamp Duty
//
// Every other product keeps its own base-premium rule and its fixed KES 40
// stamp duty unchanged.

const num = (d: { toString(): string }) => Number(d.toString());

describe("Example A — one shipment, minimum premium triggered", () => {
  it("SI 1,000,000 @ 0.15% -> Basic SI 1,100,000, raw 1,650, chargeable 5,000; Stamp 550; Total 5,572.50", () => {
    const r = calculateMarine({ shipmentRows: [{ sumInsured: 1_000_000, rate: 0.15 }] });
    expect(num(r.rows[0].basicSumInsured)).toBe(1_100_000);
    expect(num(r.rows[0].linePremium)).toBe(1650); // raw rated premium, unchanged
    expect(r.rows[0].minimumPremiumApplied).toBe(true);
    expect(num(r.rows[0].chargeableLinePremium)).toBe(5000);
    expect(num(r.grossPremium)).toBe(5000);
    expect(num(r.phcfAmount)).toBe(12.5); // 5,000 x 0.25%
    expect(num(r.itlAmount)).toBe(10); // 5,000 x 0.20%
    expect(num(r.marineStampDutyAmount)).toBe(550); // 1,100,000 x 0.05%
    expect(num(r.totalPremium)).toBe(5572.5);
    expect(r.anyMinimumPremiumApplied).toBe(true);
  });
});

describe("Example B — one shipment, minimum NOT triggered", () => {
  it("SI 1,000,000 @ 0.80% -> raw 8,800, chargeable 8,800, no note; Stamp 550; Total 9,389.60", () => {
    const r = calculateMarine({ shipmentRows: [{ sumInsured: 1_000_000, rate: 0.8 }] });
    expect(num(r.rows[0].linePremium)).toBe(8800);
    expect(r.rows[0].minimumPremiumApplied).toBe(false);
    expect(num(r.rows[0].chargeableLinePremium)).toBe(8800);
    expect(num(r.grossPremium)).toBe(8800);
    expect(num(r.phcfAmount)).toBe(22); // 8,800 x 0.25%
    expect(num(r.itlAmount)).toBe(17.6); // 8,800 x 0.20%
    expect(num(r.marineStampDutyAmount)).toBe(550);
    expect(num(r.totalPremium)).toBe(9389.6);
    expect(r.anyMinimumPremiumApplied).toBe(false);
  });
});

describe("Example C — multiple shipments, each independently floored", () => {
  const r = calculateMarine({
    shipmentRows: [
      { sumInsured: 1_000_000, rate: 0.15 }, // Basic 1,100,000, raw 1,650 -> chargeable 5,000
      { sumInsured: 2_000_000, rate: 0.3 }, // Basic 2,200,000, raw 6,600 -> chargeable 6,600
      { sumInsured: 500_000, rate: 0.15 }, // Basic 550,000, raw 825 -> chargeable 5,000
    ],
  });

  it("Test 3: each shipment applies KES 5,000 independently; note only where floored", () => {
    expect(num(r.rows[0].linePremium)).toBe(1650);
    expect(num(r.rows[0].chargeableLinePremium)).toBe(5000);
    expect(r.rows[0].minimumPremiumApplied).toBe(true);

    expect(num(r.rows[1].linePremium)).toBe(6600);
    expect(num(r.rows[1].chargeableLinePremium)).toBe(6600);
    expect(r.rows[1].minimumPremiumApplied).toBe(false);

    expect(num(r.rows[2].linePremium)).toBe(825);
    expect(num(r.rows[2].chargeableLinePremium)).toBe(5000);
    expect(r.rows[2].minimumPremiumApplied).toBe(true);
  });

  it("Test 4: Gross Premium = sum(per-shipment chargeable), NOT max(sum(raw), 5,000)", () => {
    expect(num(r.grossPremium)).toBe(16600); // 5,000 + 6,600 + 5,000
    expect(num(r.totalRatedPremium)).toBe(9075); // 1,650 + 6,600 + 825
    // the wrong interpretation would give max(9075, 5000) = 9,075
    expect(num(r.grossPremium)).not.toBe(9075);
  });

  it("Test 5: Marine Stamp Duty = sum(Basic Sum Insured) x 0.05%", () => {
    expect(num(r.totalBasicSumInsured)).toBe(3_850_000); // 1,100,000 + 2,200,000 + 550,000
    expect(num(r.marineStampDutyAmount)).toBe(1925); // 3,850,000 x 0.05%
  });

  it("Test 6: Marine Stamp Duty is NOT sum(Sum Insured) x 0.05%", () => {
    expect(num(r.totalSumInsured)).toBe(3_500_000);
    expect(num(r.marineStampDutyAmount)).not.toBe(1750); // 3,500,000 x 0.05%
  });

  it("Test 7: Marine Stamp Duty is NOT Gross Premium x 0.05%", () => {
    expect(num(r.marineStampDutyAmount)).not.toBe(8.3); // 16,600 x 0.05%
    expect(num(r.marineStampDutyAmount)).not.toBe(40);
  });

  it("Test 8/9: PHCF and ITL use Gross Premium", () => {
    expect(num(r.phcfAmount)).toBe(41.5); // 16,600 x 0.25%
    expect(num(r.itlAmount)).toBe(33.2); // 16,600 x 0.20%
  });

  it("Total Premium = Gross + PHCF + ITL + Stamp Duty = 18,599.70", () => {
    expect(num(r.totalPremium)).toBe(18599.7);
    expect(num(r.totalPremium)).toBe(
      num(r.grossPremium) + num(r.phcfAmount) + num(r.itlAmount) + num(r.marineStampDutyAmount)
    );
  });
});

describe("per-shipment floor helpers", () => {
  it("isMarineMinimumPremiumApplied / deriveMarineChargeableLinePremium", () => {
    expect(isMarineMinimumPremiumApplied(1650)).toBe(true);
    expect(isMarineMinimumPremiumApplied(5000)).toBe(false);
    expect(isMarineMinimumPremiumApplied(8800)).toBe(false);
    expect(num(deriveMarineChargeableLinePremium(1650))).toBe(5000);
    expect(num(deriveMarineChargeableLinePremium(8800))).toBe(8800);
    expect(num(deriveMarineChargeableLinePremium(5000))).toBe(5000);
  });

  it("Regression B: SI 5,000,000 -> Basic 5,500,000 -> Stamp Duty 2,750", () => {
    const r = calculateMarine({ shipmentRows: [{ sumInsured: 5_000_000, rate: 1 }] });
    expect(num(r.marineStampDutyAmount)).toBe(2750);
  });

  it("Regression C: SI 10,000,000 -> Basic 11,000,000 -> Stamp Duty 5,500", () => {
    const r = calculateMarine({ shipmentRows: [{ sumInsured: 10_000_000, rate: 1 }] });
    expect(num(r.marineStampDutyAmount)).toBe(5500);
  });
});

describe("previewMarine mirrors calculateMarine exactly (one calculation, everywhere)", () => {
  const cases = [
    { shipmentRows: [{ sumInsured: "1000000", rate: "0.15" }] }, // floored
    { shipmentRows: [{ sumInsured: "1000000", rate: "0.80" }] }, // not floored
    {
      shipmentRows: [
        { sumInsured: "1000000", rate: "0.15" },
        { sumInsured: "2000000", rate: "0.30" },
        { sumInsured: "500000", rate: "0.15" },
      ],
    },
  ];
  for (const [i, input] of cases.entries()) {
    it(`case ${i + 1}`, () => {
      const backend = calculateMarine(input);
      const preview = previewMarine(input);
      expect(preview.grossPremium).toBe(num(backend.grossPremium));
      expect(preview.anyMinimumPremiumApplied).toBe(backend.anyMinimumPremiumApplied);
      expect(preview.phcfAmount).toBe(num(backend.phcfAmount));
      expect(preview.itlAmount).toBe(num(backend.itlAmount));
      expect(preview.marineStampDutyAmount).toBe(num(backend.marineStampDutyAmount));
      expect(preview.totalPremium).toBe(num(backend.totalPremium));
      expect(preview.rows.map((r) => r.minimumPremiumApplied)).toEqual(backend.rows.map((r) => r.minimumPremiumApplied));
      expect(preview.rows.map((r) => r.linePremium)).toEqual(backend.rows.map((r) => num(r.linePremium)));
      expect(preview.rows.map((r) => r.chargeableLinePremium)).toEqual(backend.rows.map((r) => num(r.chargeableLinePremium)));
    });
  }
});

describe("Test 20/21: Non-Marine products keep the fixed KES 40 Stamp Duty unchanged", () => {
  it("STAMP_DUTY constant is still 40", () => {
    expect(STAMP_DUTY).toBe(40);
  });
  it("CPM standalone still charges exactly KES 40", () => {
    const r = calculateCpmStandalone({ equipmentRows: [{ quantity: 1, unitValue: 2_000_000 }], cpmRate: 0.75, pvtLoadingEnabled: false });
    expect(Number(r.stampDutyAmount.toString())).toBe(40);
  });
  it("Fire & Perils still charges exactly KES 40", () => {
    const r = calculateFire({
      propertyValue: 5_000_000,
      rate: 0.25,
      earthquakeLoadingEnabled: false,
      floodLoadingEnabled: false,
      pvtLoadingEnabled: false,
    });
    expect(Number(r.stampDutyAmount.toString())).toBe(40);
  });
  it("Goods in Transit (single) still charges exactly KES 40", () => {
    const r = calculateGitSingle({ sumInsured: 1_000_000, rate: 0.5, pvtLoadingEnabled: false });
    expect(Number(r.stampDutyAmount.toString())).toBe(40);
  });
});

describe("constants", () => {
  it("MARINE_MINIMUM_BASE_PREMIUM is 5000; MARINE_STAMP_DUTY_RATE is 0.05", () => {
    expect(MARINE_MINIMUM_BASE_PREMIUM).toBe(5000);
    expect(MARINE_STAMP_DUTY_RATE).toBe(0.05);
  });
});
