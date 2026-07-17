import { Prisma } from "@/generated/prisma/client";
import { roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { STAMP_DUTY } from "./constants";

export type MedicalCategoryRowInput = {
  employeeCount: number;
  inpatientRate: DecimalInput;
  outpatientRate: DecimalInput;
};

export type MedicalInput = {
  categoryRows: MedicalCategoryRowInput[];
};

export type MedicalCategoryRowResult = {
  employeeCount: number;
  inpatientRate: Prisma.Decimal;
  outpatientRate: Prisma.Decimal;
  inpatientAmount: Prisma.Decimal;
  outpatientAmount: Prisma.Decimal;
};

export type MedicalResult = {
  rows: MedicalCategoryRowResult[];
  employeeCount: number;
  inpatientPremium: Prisma.Decimal;
  outpatientPremium: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  grossPremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

// Group Medical is taxed differently from every other Phase 1/2A/2B section:
// per the approved template, PHCF and ITL are always zero (never applied) —
// only the flat KES 40 stamp duty carries through to the total.
export function calculateMedical(input: MedicalInput): MedicalResult {
  const rows: MedicalCategoryRowResult[] = input.categoryRows.map((row) => {
    const inpatientRate = toDecimal(row.inpatientRate);
    const outpatientRate = toDecimal(row.outpatientRate);
    return {
      employeeCount: row.employeeCount,
      inpatientRate,
      outpatientRate,
      inpatientAmount: roundMoney(toDecimal(row.employeeCount).times(inpatientRate)),
      outpatientAmount: roundMoney(toDecimal(row.employeeCount).times(outpatientRate)),
    };
  });

  const employeeCount = rows.reduce((sum, row) => sum + row.employeeCount, 0);
  const inpatientPremium = roundMoney(
    rows.reduce((acc, row) => acc.plus(row.inpatientAmount), toDecimal(0))
  );
  const outpatientPremium = roundMoney(
    rows.reduce((acc, row) => acc.plus(row.outpatientAmount), toDecimal(0))
  );
  const subtotal = roundMoney(inpatientPremium.plus(outpatientPremium));
  const grossPremium = subtotal;
  const phcfAmount = toDecimal(0);
  const itlAmount = toDecimal(0);
  const stampDutyAmount = toDecimal(STAMP_DUTY);
  const totalPremium = roundMoney(grossPremium.plus(stampDutyAmount));

  return {
    rows,
    employeeCount,
    inpatientPremium,
    outpatientPremium,
    subtotal,
    grossPremium,
    phcfAmount,
    itlAmount,
    stampDutyAmount,
    totalPremium,
  };
}
