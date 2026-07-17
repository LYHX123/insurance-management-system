import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";

export type GitAnnualInput = {
  singleLimit: DecimalInput;
  yearLimit: DecimalInput;
  singleLimitRate: DecimalInput;
  yearLimitRate: DecimalInput;
  pvtLoadingEnabled: boolean;
  pvtLoadingAmount?: DecimalInput;
};

export type GitAnnualResult = {
  singlePremium: Prisma.Decimal;
  yearPremium: Prisma.Decimal;
  pvtLoadingAmount: Prisma.Decimal;
  grossPremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

// The two limits are never added together as a combined premium basis — each
// is its own independently rated premium, then summed.
export function calculateGitAnnual(input: GitAnnualInput): GitAnnualResult {
  const singlePremium = roundMoney(percentOf(input.singleLimit, input.singleLimitRate));
  const yearPremium = roundMoney(percentOf(input.yearLimit, input.yearLimitRate));
  const pvtLoadingAmount = input.pvtLoadingEnabled
    ? roundMoney(toDecimal(input.pvtLoadingAmount))
    : toDecimal(0);
  const grossPremium = roundMoney(singlePremium.plus(yearPremium).plus(pvtLoadingAmount));
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const stampDutyAmount = toDecimal(STAMP_DUTY);
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(stampDutyAmount)
  );

  return {
    singlePremium,
    yearPremium,
    pvtLoadingAmount,
    grossPremium,
    phcfAmount,
    itlAmount,
    stampDutyAmount,
    totalPremium,
  };
}
