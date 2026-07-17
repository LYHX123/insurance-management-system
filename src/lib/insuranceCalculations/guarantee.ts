import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";

// Shared by Tender Security, Performance Bond and Advance Payment Guarantee
// — identical bondValue x rate formula. Each still gets its own section
// kind, its own Prisma model, and its own form component/labels so a
// quotation can hold all three at once with separate, unambiguous totals.
export type GuaranteeInput = {
  bondValue: DecimalInput;
  rate: DecimalInput;
};

export type GuaranteeResult = {
  grossPremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

export function calculateGuarantee(input: GuaranteeInput): GuaranteeResult {
  const grossPremium = roundMoney(percentOf(input.bondValue, input.rate));
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const stampDutyAmount = toDecimal(STAMP_DUTY);
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(stampDutyAmount)
  );

  return { grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}
