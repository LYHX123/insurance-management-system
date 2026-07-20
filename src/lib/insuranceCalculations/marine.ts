import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, MARINE_STAMP_DUTY_RATE, MARINE_INCIDENTAL_LOADING_RATE } from "./constants";

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
  linePremium: Prisma.Decimal;
};

export type MarineResult = {
  rows: MarineRowResult[];
  /** Legacy sum of raw Sum Insured (pre-loading) — kept for the marine_total_sum_insured compat mapping only. No longer the basis for the Total row OR Stamp Duty; do not use for either. */
  totalSumInsured: Prisma.Decimal;
  /** Sum of every row's Basic Sum Insured — the new Total row's basis. */
  totalBasicSumInsured: Prisma.Decimal;
  grossPremium: Prisma.Decimal;
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

// Marine is the only section kind whose stamp duty is a percentage rather
// than the fixed KES 40 used everywhere else — see MARINE_STAMP_DUTY_RATE in
// constants.ts. The base is Total Basic Sum Insured (post-Incidental-Loading,
// i.e. the same basis the Total row itself displays), NOT the raw Sum
// Insured total — corrected after totalSumInsured was mistakenly left in
// place when Incidental Loading / Basic Sum Insured were introduced.
export function calculateMarine(input: MarineInput): MarineResult {
  const rows: MarineRowResult[] = input.shipmentRows.map((row) => {
    const sumInsured = toDecimal(row.sumInsured);
    const rate = toDecimal(row.rate);
    const incidentalLoading = deriveMarineIncidentalLoading(sumInsured);
    const basicSumInsured = deriveMarineBasicSumInsured(sumInsured);
    // Rate is applied to Basic Sum Insured (Sum Insured + Incidental
    // Loading), not to the raw Sum Insured.
    const linePremium = roundMoney(percentOf(basicSumInsured, rate));
    return { sumInsured, rate, incidentalLoading, basicSumInsured, linePremium };
  });

  const totalSumInsured = roundMoney(
    rows.reduce((acc, row) => acc.plus(row.sumInsured), toDecimal(0))
  );
  const totalBasicSumInsured = roundMoney(
    rows.reduce((acc, row) => acc.plus(row.basicSumInsured), toDecimal(0))
  );
  const grossPremium = roundMoney(
    rows.reduce((acc, row) => acc.plus(row.linePremium), toDecimal(0))
  );
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const marineStampDutyRate = toDecimal(MARINE_STAMP_DUTY_RATE);
  const marineStampDutyAmount = roundMoney(percentOf(totalBasicSumInsured, marineStampDutyRate));
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(marineStampDutyAmount)
  );

  return {
    rows,
    totalSumInsured,
    totalBasicSumInsured,
    grossPremium,
    phcfAmount,
    itlAmount,
    marineStampDutyRate,
    marineStampDutyAmount,
    totalPremium,
  };
}
