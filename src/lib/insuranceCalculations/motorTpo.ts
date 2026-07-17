import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";

// Shared by both Motor TPO - Private and Motor TPO - Commercial. There is no
// vehicle-value calculation for TPO — gross premium is the manually entered
// base premium as-is. Commercial's loading capacity (tonnage) is stored for
// reference only in Phase 2B; no automatic tariff table yet.
export type MotorTpoInput = {
  basePremium: DecimalInput;
};

export type MotorTpoResult = {
  grossPremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

export function calculateMotorTpo(input: MotorTpoInput): MotorTpoResult {
  const grossPremium = roundMoney(toDecimal(input.basePremium));
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const stampDutyAmount = toDecimal(STAMP_DUTY);
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(stampDutyAmount)
  );

  return { grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}
