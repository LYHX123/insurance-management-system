import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";

export type WibaPayrollRowInput = {
  employeeCount: number;
  // Legacy/fallback value — see resolveWibaRowAnnualWages below for exactly
  // when this is used instead of the basicMonthlySalary/monthlyAllowance
  // formula.
  annualWages: DecimalInput;
  basicMonthlySalary?: DecimalInput | null;
  monthlyAllowance?: DecimalInput | null;
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
  /** Resolved Annual Salary per row, same order as input.payrollRows — what actually gets persisted/summed. */
  resolvedAnnualWages: Prisma.Decimal[];
};

// Annual Salary = (Basic Monthly Salary + Monthly Allowance) x Employee
// Count x 12. Rows saved before this feature existed (or edited without
// touching the new fields) have neither basicMonthlySalary nor
// monthlyAllowance set — those keep using their existing annualWages
// value untouched, so no historical quotation's total silently changes.
export function resolveWibaRowAnnualWages(row: WibaPayrollRowInput): Prisma.Decimal {
  const hasSalaryInputs = row.basicMonthlySalary != null || row.monthlyAllowance != null;
  if (!hasSalaryInputs) return roundMoney(toDecimal(row.annualWages));

  const basic = row.basicMonthlySalary != null ? toDecimal(row.basicMonthlySalary) : toDecimal(0);
  const allowance = row.monthlyAllowance != null ? toDecimal(row.monthlyAllowance) : toDecimal(0);
  return roundMoney(basic.plus(allowance).times(row.employeeCount).times(12));
}

export function calculateWiba(input: WibaInput): WibaResult {
  const resolvedAnnualWages = input.payrollRows.map(resolveWibaRowAnnualWages);

  const totalEmployeeCount = input.payrollRows.reduce((sum, row) => sum + row.employeeCount, 0);
  const totalAnnualWages = roundMoney(
    resolvedAnnualWages.reduce((acc, wages) => acc.plus(wages), toDecimal(0))
  );

  const grossPremium = roundMoney(percentOf(totalAnnualWages, input.wibaRate));
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const stampDutyAmount = toDecimal(STAMP_DUTY);
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(stampDutyAmount)
  );

  return {
    totalEmployeeCount,
    totalAnnualWages,
    grossPremium,
    phcfAmount,
    itlAmount,
    stampDutyAmount,
    totalPremium,
    resolvedAnnualWages,
  };
}
