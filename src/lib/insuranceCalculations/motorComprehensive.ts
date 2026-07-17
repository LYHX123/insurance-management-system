import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";

// Shared by both Motor Comprehensive - Private and Motor Comprehensive -
// Commercial — identical formula, kept as separate section kinds/models
// only because their Excel template section and fixed clauses differ.
export type MotorComprehensiveInput = {
  vehicleValue: DecimalInput;
  rate: DecimalInput;
};

export type MotorComprehensiveResult = {
  grossPremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

export function calculateMotorComprehensive(input: MotorComprehensiveInput): MotorComprehensiveResult {
  const grossPremium = roundMoney(percentOf(input.vehicleValue, input.rate));
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const stampDutyAmount = toDecimal(STAMP_DUTY);
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(stampDutyAmount)
  );

  return { grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}
