import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";

export type GpaInput = {
  deathLimit: DecimalInput;
  ptdLimit: DecimalInput;
  ttdLimit: DecimalInput;
  medicalLimit: DecimalInput;
  funeralLimit: DecimalInput;
  deathRate: DecimalInput;
  ptdRate: DecimalInput;
  ttdRate: DecimalInput;
  medicalRate: DecimalInput;
  funeralRate: DecimalInput;
  numberOfPeople: number;
};

export type GpaResult = {
  deathPremium: Prisma.Decimal;
  ptdPremium: Prisma.Decimal;
  ttdPremium: Prisma.Decimal;
  medicalPremium: Prisma.Decimal;
  funeralPremium: Prisma.Decimal;
  premiumPerPerson: Prisma.Decimal;
  grossPremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

export function calculateGpa(input: GpaInput): GpaResult {
  const deathPremium = roundMoney(percentOf(input.deathLimit, input.deathRate));
  const ptdPremium = roundMoney(percentOf(input.ptdLimit, input.ptdRate));
  const ttdPremium = roundMoney(percentOf(input.ttdLimit, input.ttdRate));
  const medicalPremium = roundMoney(percentOf(input.medicalLimit, input.medicalRate));
  const funeralPremium = roundMoney(percentOf(input.funeralLimit, input.funeralRate));

  const premiumPerPerson = roundMoney(
    deathPremium.plus(ptdPremium).plus(ttdPremium).plus(medicalPremium).plus(funeralPremium)
  );
  const grossPremium = roundMoney(premiumPerPerson.times(toDecimal(input.numberOfPeople)));
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const stampDutyAmount = toDecimal(STAMP_DUTY);
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(stampDutyAmount)
  );

  return {
    deathPremium,
    ptdPremium,
    ttdPremium,
    medicalPremium,
    funeralPremium,
    premiumPerPerson,
    grossPremium,
    phcfAmount,
    itlAmount,
    stampDutyAmount,
    totalPremium,
  };
}
