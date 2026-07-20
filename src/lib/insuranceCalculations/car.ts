import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";
import { calculatePvtLoading } from "./pvtLoading";

export type CarPackageInput = {
  contractValue: DecimalInput;
  carRate: DecimalInput;
  cpmValue?: DecimalInput;
  cpmRate?: DecimalInput;
  pvtLoadingEnabled: boolean;
  pvtLoadingAmount?: DecimalInput;
  pvtLoadingRate?: DecimalInput;
  tplComplimentary: boolean;
  tplAnyOnePeriod?: DecimalInput;
  tplRate?: DecimalInput;
};

export type CarPackageResult = {
  carBasicPremium: Prisma.Decimal;
  carCpmPremium: Prisma.Decimal;
  carPvtLoadingAmount: Prisma.Decimal;
  carPvtLoadingRate: Prisma.Decimal;
  carPvtLoadingPremium: Prisma.Decimal;
  carMainGrossPremium: Prisma.Decimal;
  carMainPhcf: Prisma.Decimal;
  carMainItl: Prisma.Decimal;
  carMainStampDuty: Prisma.Decimal;
  carMainTotal: Prisma.Decimal;
  tplGrossPremium: Prisma.Decimal;
  tplPhcf: Prisma.Decimal;
  tplItl: Prisma.Decimal;
  tplStampDuty: Prisma.Decimal;
  tplTotalPremium: Prisma.Decimal;
  // Section-level roll-up: Main CAR (+ CPM inside CAR, + PVT loading) block,
  // plus the independently taxed TPL block.
  basePremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  sectionTotal: Prisma.Decimal;
};

// CPM inside CAR is folded into the Main CAR gross premium before PHCF/ITL
// are applied — it is not taxed independently. TPL, when not complimentary,
// is charged on its own gross/PHCF/ITL/stamp duty and summed in separately.
export function calculateCarPackage(input: CarPackageInput): CarPackageResult {
  const carBasicPremium = roundMoney(percentOf(input.contractValue, input.carRate));
  const carCpmPremium =
    input.cpmValue != null && input.cpmRate != null
      ? roundMoney(percentOf(input.cpmValue, input.cpmRate))
      : toDecimal(0);
  const carPvtLoading = calculatePvtLoading({
    enabled: input.pvtLoadingEnabled,
    amount: input.pvtLoadingAmount,
    rate: input.pvtLoadingRate,
  });

  const carMainGrossPremium = roundMoney(
    carBasicPremium.plus(carCpmPremium).plus(carPvtLoading.premium)
  );
  const carMainPhcf = roundMoney(percentOf(carMainGrossPremium, PHCF_RATE));
  const carMainItl = roundMoney(percentOf(carMainGrossPremium, ITL_RATE));
  const carMainStampDuty = toDecimal(STAMP_DUTY);
  const carMainTotal = roundMoney(
    carMainGrossPremium.plus(carMainPhcf).plus(carMainItl).plus(carMainStampDuty)
  );

  let tplGrossPremium = toDecimal(0);
  let tplPhcf = toDecimal(0);
  let tplItl = toDecimal(0);
  // TPL is part of the same CAR policy as Main CAR/CPM/PVT Loading — only one
  // stamp duty is charged per policy, already counted in carMainStampDuty
  // above, so TPL's own share stays 0 rather than adding a second KES 40.
  const tplStampDuty = toDecimal(0);
  let tplTotalPremium = toDecimal(0);

  if (!input.tplComplimentary) {
    tplGrossPremium = roundMoney(percentOf(input.tplAnyOnePeriod, input.tplRate));
    tplPhcf = roundMoney(percentOf(tplGrossPremium, PHCF_RATE));
    tplItl = roundMoney(percentOf(tplGrossPremium, ITL_RATE));
    tplTotalPremium = roundMoney(
      tplGrossPremium.plus(tplPhcf).plus(tplItl).plus(tplStampDuty)
    );
  }

  return {
    carBasicPremium,
    carCpmPremium,
    carPvtLoadingAmount: carPvtLoading.amount,
    carPvtLoadingRate: carPvtLoading.rate,
    carPvtLoadingPremium: carPvtLoading.premium,
    carMainGrossPremium,
    carMainPhcf,
    carMainItl,
    carMainStampDuty,
    carMainTotal,
    tplGrossPremium,
    tplPhcf,
    tplItl,
    tplStampDuty,
    tplTotalPremium,
    basePremium: roundMoney(carMainGrossPremium.plus(tplGrossPremium)),
    phcfAmount: roundMoney(carMainPhcf.plus(tplPhcf)),
    itlAmount: roundMoney(carMainItl.plus(tplItl)),
    stampDutyAmount: roundMoney(carMainStampDuty.plus(tplStampDuty)),
    sectionTotal: roundMoney(carMainTotal.plus(tplTotalPremium)),
  };
}
