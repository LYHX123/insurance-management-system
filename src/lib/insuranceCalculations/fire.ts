import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";

export type FireInput = {
  propertyValue: DecimalInput;
  rawMaterialValue?: DecimalInput;
  goodsInStockValue?: DecimalInput;
  rate: DecimalInput;
  earthquakeLoadingRate?: DecimalInput;
  floodLoadingRate?: DecimalInput;
  pvtLoadingEnabled: boolean;
  pvtLoadingAmount?: DecimalInput;
};

export type FireResult = {
  totalSumInsured: Prisma.Decimal;
  basicPremium: Prisma.Decimal;
  earthquakeLoadingAmount: Prisma.Decimal;
  floodLoadingAmount: Prisma.Decimal;
  pvtLoadingAmount: Prisma.Decimal;
  grossPremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

export function calculateFire(input: FireInput): FireResult {
  const totalSumInsured = roundMoney(
    toDecimal(input.propertyValue).plus(toDecimal(input.rawMaterialValue)).plus(toDecimal(input.goodsInStockValue))
  );

  const basicPremium = roundMoney(percentOf(totalSumInsured, input.rate));
  const earthquakeLoadingAmount = roundMoney(percentOf(totalSumInsured, input.earthquakeLoadingRate ?? 0));
  const floodLoadingAmount = roundMoney(percentOf(totalSumInsured, input.floodLoadingRate ?? 0));
  const pvtLoadingAmount = input.pvtLoadingEnabled
    ? roundMoney(toDecimal(input.pvtLoadingAmount))
    : toDecimal(0);

  const grossPremium = roundMoney(
    basicPremium.plus(earthquakeLoadingAmount).plus(floodLoadingAmount).plus(pvtLoadingAmount)
  );
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const stampDutyAmount = toDecimal(STAMP_DUTY);
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(stampDutyAmount)
  );

  return {
    totalSumInsured,
    basicPremium,
    earthquakeLoadingAmount,
    floodLoadingAmount,
    pvtLoadingAmount,
    grossPremium,
    phcfAmount,
    itlAmount,
    stampDutyAmount,
    totalPremium,
  };
}
