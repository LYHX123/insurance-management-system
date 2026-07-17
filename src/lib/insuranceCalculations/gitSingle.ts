import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";

export type GitSingleInput = {
  sumInsured: DecimalInput;
  rate: DecimalInput;
  pvtLoadingEnabled: boolean;
  pvtLoadingAmount?: DecimalInput;
};

export type GitSingleResult = {
  basicPremium: Prisma.Decimal;
  pvtLoadingAmount: Prisma.Decimal;
  grossPremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

export function calculateGitSingle(input: GitSingleInput): GitSingleResult {
  const basicPremium = roundMoney(percentOf(input.sumInsured, input.rate));
  const pvtLoadingAmount = input.pvtLoadingEnabled
    ? roundMoney(toDecimal(input.pvtLoadingAmount))
    : toDecimal(0);
  const grossPremium = roundMoney(basicPremium.plus(pvtLoadingAmount));
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const stampDutyAmount = toDecimal(STAMP_DUTY);
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(stampDutyAmount)
  );

  return { basicPremium, pvtLoadingAmount, grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}
