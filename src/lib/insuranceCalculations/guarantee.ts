import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE } from "./constants";

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
  // Phase 10 — Bond products (Tender Security / Bid Bond, Performance Bond,
  // Advance Payment Guarantee) do NOT attract Stamp Duty. It is genuinely
  // zero here (not merely hidden in the Excel), and is therefore NOT part
  // of Total Premium: Total = Gross + PHCF + ITL.
  const stampDutyAmount = toDecimal(0);
  const totalPremium = roundMoney(grossPremium.plus(phcfAmount).plus(itlAmount));

  return { grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}
