import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE } from "./constants";

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
  // Phase 10 — Customs / Clearing Bond no longer attracts Stamp Duty;
  // always zero, kept in the shape for backward compatibility.
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
  // Phase 10 — no Stamp Duty on Customs / Clearing Bond. Zero, and not part
  // of Total Premium: Total = Gross + PHCF + ITL.
  const stampDutyAmount = toDecimal(0);
  const totalPremium = roundMoney(grossPremium.plus(phcfAmount).plus(itlAmount));

  return { rows, grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}
