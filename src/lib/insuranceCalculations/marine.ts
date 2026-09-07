import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import {
  ITL_RATE,
  PHCF_RATE,
  MARINE_STAMP_DUTY_RATE,
  MARINE_INCIDENTAL_LOADING_RATE,
  MARINE_MINIMUM_BASE_PREMIUM,
} from "./constants";

export type MarineShipmentRowInput = {
  sumInsured: DecimalInput;
  rate: DecimalInput;
};

export type MarineInput = {
  shipmentRows: MarineShipmentRowInput[];
};

export type MarineRowResult = {
  sumInsured: Prisma.Decimal;
  rate: Prisma.Decimal;
  incidentalLoading: Prisma.Decimal;
  basicSumInsured: Prisma.Decimal;
  /** Rated (raw) premium for this shipment: Basic Sum Insured x Rate. Always shown on the quote — never replaced by the minimum. */
  linePremium: Prisma.Decimal;
  /** Phase 13B — max(linePremium, KES 5,000). The value this shipment contributes to Gross Premium. */
  chargeableLinePremium: Prisma.Decimal;
  /** Phase 13B — true when this shipment's rated premium was below KES 5,000 and the floor was applied to it. */
  minimumPremiumApplied: boolean;
};

export type MarineResult = {
  rows: MarineRowResult[];
  /** Sum of every row's raw Sum Insured (pre Incidental Loading). Kept for the marine_total_sum_insured compat mapping only — NOT a basis for any amount. */
  totalSumInsured: Prisma.Decimal;
  /** Sum of every row's Basic Sum Insured (Sum Insured x 1.10) — the basis for the Total row AND for Marine Stamp Duty. */
  totalBasicSumInsured: Prisma.Decimal;
  /** Sum of every shipment's RAW rated premium, before any minimum is applied. Diagnostic / display only. */
  totalRatedPremium: Prisma.Decimal;
  /** Phase 13B — Gross Premium = sum of each shipment's CHARGEABLE premium (its rated premium floored at KES 5,000, per shipment). PHCF / ITL / Total all derive from this, and it is persisted as the Marine "Gross premium". */
  grossPremium: Prisma.Decimal;
  /** True when at least one shipment triggered the per-shipment KES 5,000 minimum. */
  anyMinimumPremiumApplied: boolean;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  marineStampDutyRate: Prisma.Decimal;
  marineStampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

// Single authoritative definition of Incidental Loading / Basic Sum Insured
// — reused by calculateMarine() below AND by the Excel export mapping
// (mapQuotationData.ts), which re-derives these from a shipment row's
// persisted sumInsured rather than storing them as their own DB columns
// (they are a pure deterministic function of sumInsured, so there is
// nothing for a separate column to disagree with).
export function deriveMarineIncidentalLoading(sumInsured: DecimalInput): Prisma.Decimal {
  return roundMoney(percentOf(sumInsured, MARINE_INCIDENTAL_LOADING_RATE));
}

export function deriveMarineBasicSumInsured(sumInsured: DecimalInput): Prisma.Decimal {
  return roundMoney(toDecimal(sumInsured).plus(deriveMarineIncidentalLoading(sumInsured)));
}

// Phase 13B — max(ratedPremium, KES 5,000). The single definition of "the
// chargeable premium for one shipment", reused by calculateMarine() and by
// the Excel mapping (mapMarine derives the per-shipment minimum-premium note
// from a persisted linePremium the same way).
export function isMarineMinimumPremiumApplied(linePremium: DecimalInput): boolean {
  return toDecimal(linePremium).lessThan(MARINE_MINIMUM_BASE_PREMIUM);
}

export function deriveMarineChargeableLinePremium(linePremium: DecimalInput): Prisma.Decimal {
  return isMarineMinimumPremiumApplied(linePremium) ? toDecimal(MARINE_MINIMUM_BASE_PREMIUM) : roundMoney(toDecimal(linePremium));
}

// Marine has rules unique to it (Phase 13B):
//   1. Minimum premium of KES 5,000 applied PER SHIPMENT — each shipment's
//      rated premium (Basic Sum Insured x Rate) is floored at 5,000
//      individually, then Gross Premium = sum of those floored amounts. The
//      combined raw total is NEVER compared to 5,000.
//   2. Stamp Duty = 0.05% of the total Basic Sum Insured (Sum Insured x 1.10)
//      — NOT the fixed KES 40 used by every other product.
// Every other product keeps its own base-premium + fixed-KES-40 stamp-duty
// rules unchanged.
export function calculateMarine(input: MarineInput): MarineResult {
  const rows: MarineRowResult[] = input.shipmentRows.map((row) => {
    const sumInsured = toDecimal(row.sumInsured);
    const rate = toDecimal(row.rate);
    const incidentalLoading = deriveMarineIncidentalLoading(sumInsured);
    const basicSumInsured = deriveMarineBasicSumInsured(sumInsured);
    // Rate is applied to Basic Sum Insured (Sum Insured + Incidental
    // Loading), not to the raw Sum Insured.
    const linePremium = roundMoney(percentOf(basicSumInsured, rate));
    // Rule 1 — the minimum is applied to THIS shipment's rated premium.
    const minimumPremiumApplied = isMarineMinimumPremiumApplied(linePremium);
    const chargeableLinePremium = deriveMarineChargeableLinePremium(linePremium);
    return { sumInsured, rate, incidentalLoading, basicSumInsured, linePremium, chargeableLinePremium, minimumPremiumApplied };
  });

  const totalSumInsured = roundMoney(rows.reduce((acc, row) => acc.plus(row.sumInsured), toDecimal(0)));
  const totalBasicSumInsured = roundMoney(rows.reduce((acc, row) => acc.plus(row.basicSumInsured), toDecimal(0)));
  const totalRatedPremium = roundMoney(rows.reduce((acc, row) => acc.plus(row.linePremium), toDecimal(0)));

  // Gross Premium = sum of each shipment's chargeable (per-shipment-floored)
  // premium — NEVER max(sum(raw premiums), 5,000).
  const grossPremium = roundMoney(rows.reduce((acc, row) => acc.plus(row.chargeableLinePremium), toDecimal(0)));
  const anyMinimumPremiumApplied = rows.some((row) => row.minimumPremiumApplied);

  // PHCF / ITL derive from Gross Premium.
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));

  // Rule 2 — Stamp Duty is 0.05% of the total Basic Sum Insured.
  const marineStampDutyRate = toDecimal(MARINE_STAMP_DUTY_RATE);
  const marineStampDutyAmount = roundMoney(percentOf(totalBasicSumInsured, marineStampDutyRate));

  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(marineStampDutyAmount)
  );

  return {
    rows,
    totalSumInsured,
    totalBasicSumInsured,
    totalRatedPremium,
    grossPremium,
    anyMinimumPremiumApplied,
    phcfAmount,
    itlAmount,
    marineStampDutyRate,
    marineStampDutyAmount,
    totalPremium,
  };
}
