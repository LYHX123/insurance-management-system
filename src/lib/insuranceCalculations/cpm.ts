import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";

export type CpmEquipmentRowInput = {
  quantity: number;
  unitValue: DecimalInput;
};

export type CpmStandaloneInput = {
  equipmentRows: CpmEquipmentRowInput[];
  cpmRate: DecimalInput;
  pvtLoadingEnabled: boolean;
  pvtLoadingAmount?: DecimalInput;
};

export type CpmStandaloneResult = {
  totalSumInsured: Prisma.Decimal;
  basicPremium: Prisma.Decimal;
  pvtLoadingAmount: Prisma.Decimal;
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

  return { totalSumInsured, basicPremium, pvtLoadingAmount, grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}
