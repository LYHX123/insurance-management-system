import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { EL_PERCENT_OF_WIBA, ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";

export type ElResult = {
  linkedWibaGrossPremium: Prisma.Decimal;
  grossPremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

// Employer's Liability is always derived from the WIBA section in the same
// quotation — the caller passes that section's already-computed gross
// premium; there are no independent EL inputs to collect from the user.
export function calculateEl(wibaGrossPremium: DecimalInput): ElResult {
  const linkedWibaGrossPremium = toDecimal(wibaGrossPremium);
  const grossPremium = roundMoney(percentOf(linkedWibaGrossPremium, EL_PERCENT_OF_WIBA));
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const stampDutyAmount = toDecimal(STAMP_DUTY);
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(stampDutyAmount)
  );

  return { linkedWibaGrossPremium, grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}
