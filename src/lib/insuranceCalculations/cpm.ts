import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";
import { calculatePvtLoading } from "./pvtLoading";

export type CpmEquipmentRowInput = {
  quantity: number;
  unitValue: DecimalInput;
};

export type CpmStandaloneInput = {
  equipmentRows: CpmEquipmentRowInput[];
  cpmRate: DecimalInput;
  pvtLoadingEnabled: boolean;
  pvtLoadingRate?: DecimalInput;
};

export type CpmStandaloneResult = {
  totalSumInsured: Prisma.Decimal;
  basicPremium: Prisma.Decimal;
  pvtLoadingAmount: Prisma.Decimal;
  pvtLoadingRate: Prisma.Decimal;
  pvtLoadingPremium: Prisma.Decimal;
  grossPremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

export function calculateCpmStandalone(input: CpmStandaloneInput): CpmStandaloneResult {
  const totalSumInsured = roundMoney(
    input.equipmentRows.reduce(
      (acc, row) => acc.plus(toDecimal(row.quantity).times(toDecimal(row.unitValue))),
      toDecimal(0)
    )
  );

  const basicPremium = roundMoney(percentOf(totalSumInsured, input.cpmRate));
  // PVT Loading Amount is not a manual input for CPM — it always equals
  // this section's own CPM Base Premium (unlike CAR/Fire/GIT, which use
  // calculatePvtLoading's normal user-supplied amount).
  const pvt = calculatePvtLoading({
    enabled: input.pvtLoadingEnabled,
    amount: basicPremium,
    rate: input.pvtLoadingRate,
  });
  const grossPremium = roundMoney(basicPremium.plus(pvt.premium));
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const stampDutyAmount = toDecimal(STAMP_DUTY);
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(stampDutyAmount)
  );

  return {
    totalSumInsured,
    basicPremium,
    pvtLoadingAmount: pvt.amount,
    pvtLoadingRate: pvt.rate,
    pvtLoadingPremium: pvt.premium,
    grossPremium,
    phcfAmount,
    itlAmount,
    stampDutyAmount,
    totalPremium,
  };
}
