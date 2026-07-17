import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, MARINE_STAMP_DUTY_RATE } from "./constants";

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
  linePremium: Prisma.Decimal;
};

export type MarineResult = {
  rows: MarineRowResult[];
  totalSumInsured: Prisma.Decimal;
  grossPremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  marineStampDutyRate: Prisma.Decimal;
  marineStampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

// Marine is the only section kind whose stamp duty is a percentage of total
// sum insured (MARINE_STAMP_DUTY_RATE) rather than the fixed KES 40 used
// everywhere else — see constants.ts.
export function calculateMarine(input: MarineInput): MarineResult {
  const rows: MarineRowResult[] = input.shipmentRows.map((row) => {
    const sumInsured = toDecimal(row.sumInsured);
    const rate = toDecimal(row.rate);
    return { sumInsured, rate, linePremium: roundMoney(percentOf(sumInsured, rate)) };
  });

  const totalSumInsured = roundMoney(
    rows.reduce((acc, row) => acc.plus(row.sumInsured), toDecimal(0))
  );
  const grossPremium = roundMoney(
    rows.reduce((acc, row) => acc.plus(row.linePremium), toDecimal(0))
  );
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const marineStampDutyRate = toDecimal(MARINE_STAMP_DUTY_RATE);
  const marineStampDutyAmount = roundMoney(percentOf(totalSumInsured, marineStampDutyRate));
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(marineStampDutyAmount)
  );

  return {
    rows,
    totalSumInsured,
    grossPremium,
    phcfAmount,
    itlAmount,
    marineStampDutyRate,
    marineStampDutyAmount,
    totalPremium,
  };
}
