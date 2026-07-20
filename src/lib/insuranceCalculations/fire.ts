import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { FIRE_EARTHQUAKE_LOADING_RATE, FIRE_FLOOD_LOADING_RATE, ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";
import { calculatePvtLoading } from "./pvtLoading";

export type FireInput = {
  propertyValue: DecimalInput;
  rawMaterialValue?: DecimalInput;
  goodsInStockValue?: DecimalInput;
  rate: DecimalInput;
  earthquakeLoadingEnabled: boolean;
  floodLoadingEnabled: boolean;
  pvtLoadingEnabled: boolean;
  pvtLoadingAmount?: DecimalInput;
  pvtLoadingRate?: DecimalInput;
};

export type FireResult = {
  totalSumInsured: Prisma.Decimal;
  basicPremium: Prisma.Decimal;
  earthquakeLoadingRate: Prisma.Decimal;
  earthquakeLoadingAmount: Prisma.Decimal;
  floodLoadingRate: Prisma.Decimal;
  floodLoadingAmount: Prisma.Decimal;
  pvtLoadingAmount: Prisma.Decimal;
  pvtLoadingRate: Prisma.Decimal;
  pvtLoadingPremium: Prisma.Decimal;
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
  // Earthquake/Flood Loading are fixed business rates, not user input — see
  // FIRE_EARTHQUAKE_LOADING_RATE/FIRE_FLOOD_LOADING_RATE's doc comment.
  const earthquakeLoadingRate = input.earthquakeLoadingEnabled ? toDecimal(FIRE_EARTHQUAKE_LOADING_RATE) : toDecimal(0);
  const floodLoadingRate = input.floodLoadingEnabled ? toDecimal(FIRE_FLOOD_LOADING_RATE) : toDecimal(0);
  const earthquakeLoadingAmount = roundMoney(percentOf(totalSumInsured, earthquakeLoadingRate));
  const floodLoadingAmount = roundMoney(percentOf(totalSumInsured, floodLoadingRate));
  const pvt = calculatePvtLoading({
    enabled: input.pvtLoadingEnabled,
    amount: input.pvtLoadingAmount,
    rate: input.pvtLoadingRate,
  });

  const grossPremium = roundMoney(
    basicPremium.plus(earthquakeLoadingAmount).plus(floodLoadingAmount).plus(pvt.premium)
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
    earthquakeLoadingRate,
    earthquakeLoadingAmount,
    floodLoadingRate,
    floodLoadingAmount,
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
