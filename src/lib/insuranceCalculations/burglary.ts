import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";

export type BurglaryInput = {
  equipmentValue?: DecimalInput;
  stockValue?: DecimalInput;
  firstLossPercentage: DecimalInput;
  rate: DecimalInput;
};

export type BurglaryResult = {
  totalValue: Prisma.Decimal;
  firstLossSumInsured: Prisma.Decimal;
  grossPremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

// firstLossPercentage follows the same percentage-point convention as every
// other rate in this module (e.g. 100 means 100%, 50 means 50%) — it is a
// user-entered, business-flexible figure, not necessarily 100%.
export function calculateBurglary(input: BurglaryInput): BurglaryResult {
  const totalValue = roundMoney(toDecimal(input.equipmentValue).plus(toDecimal(input.stockValue)));
  const firstLossSumInsured = roundMoney(percentOf(totalValue, input.firstLossPercentage));
  const grossPremium = roundMoney(percentOf(firstLossSumInsured, input.rate));
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const stampDutyAmount = toDecimal(STAMP_DUTY);
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(stampDutyAmount)
  );

  return { totalValue, firstLossSumInsured, grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}
