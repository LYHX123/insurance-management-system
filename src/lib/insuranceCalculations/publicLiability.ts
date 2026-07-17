import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";

export type PublicLiabilityInput = {
  anyOneYearLimit: DecimalInput;
  rate: DecimalInput;
};

export type PublicLiabilityResult = {
  grossPremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

// Gross premium is based on the Any One Year limit only — Any One Person and
// Any One Occurrence are informational limits saved for the quotation
// document but are not part of the premium basis.
export function calculatePublicLiability(input: PublicLiabilityInput): PublicLiabilityResult {
  const grossPremium = roundMoney(percentOf(input.anyOneYearLimit, input.rate));
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const stampDutyAmount = toDecimal(STAMP_DUTY);
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(stampDutyAmount)
  );

  return { grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}
