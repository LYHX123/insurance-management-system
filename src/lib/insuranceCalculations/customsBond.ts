import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";

export type CustomsBondRowInput = {
  bondValue: DecimalInput;
  rate: DecimalInput;
};

export type CustomsBondRowResult = {
  bondValue: Prisma.Decimal;
  rate: Prisma.Decimal;
  premium: Prisma.Decimal;
};

export type CustomsBondInput = {
  rows: CustomsBondRowInput[];
};

export type CustomsBondResult = {
  rows: CustomsBondRowResult[];
  grossPremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  // One flat KES 40 for the whole section, never per row.
  stampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

export function calculateCustomsBond(input: CustomsBondInput): CustomsBondResult {
  const rows: CustomsBondRowResult[] = input.rows.map((row) => {
    const bondValue = toDecimal(row.bondValue);
    const rate = toDecimal(row.rate);
    return { bondValue, rate, premium: roundMoney(percentOf(bondValue, rate)) };
  });

  const grossPremium = roundMoney(rows.reduce((acc, row) => acc.plus(row.premium), toDecimal(0)));
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const stampDutyAmount = toDecimal(STAMP_DUTY);
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(stampDutyAmount)
  );

  return { rows, grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}
