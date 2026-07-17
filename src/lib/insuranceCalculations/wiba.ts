import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";

export type WibaPayrollRowInput = {
  employeeCount: number;
  annualWages: DecimalInput;
};

export type WibaInput = {
  payrollRows: WibaPayrollRowInput[];
  wibaRate: DecimalInput;
};

export type WibaResult = {
  totalEmployeeCount: number;
  totalAnnualWages: Prisma.Decimal;
  grossPremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

export function calculateWiba(input: WibaInput): WibaResult {
  const totalEmployeeCount = input.payrollRows.reduce((sum, row) => sum + row.employeeCount, 0);
  const totalAnnualWages = roundMoney(
    input.payrollRows.reduce((acc, row) => acc.plus(toDecimal(row.annualWages)), toDecimal(0))
  );

  const grossPremium = roundMoney(percentOf(totalAnnualWages, input.wibaRate));
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const stampDutyAmount = toDecimal(STAMP_DUTY);
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(stampDutyAmount)
  );

  return { totalEmployeeCount, totalAnnualWages, grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}
