import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import { ITL_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";

export type WibaPayrollRowInput = {
  employeeCount: number;
  // Legacy/fallback value — see resolveWibaRowAnnualWages below for exactly
  // when this is used instead of the basicMonthlySalary/monthlyAllowance/
  // monthlyOtherEarnings formula.
  annualWages: DecimalInput;
  basicMonthlySalary?: DecimalInput | null;
  monthlyAllowance?: DecimalInput | null;
  // Phase 9 (WIBA Schedule Import) — "Overtime / Bonus / Other Earnings /
  // month". Optional/additive, same null-means-not-yet-used convention as
  // basicMonthlySalary/monthlyAllowance.
  monthlyOtherEarnings?: DecimalInput | null;
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

// Annual Salary = (Basic Monthly Salary + Monthly Allowance + Monthly Other
// Earnings) x Employee Count x 12. Rows saved before this feature existed
// (or edited without touching any of the three fields) have none of them
// set — those keep using their existing annualWages value untouched, so no
// historical quotation's total silently changes. monthlyOtherEarnings
// (Phase 9, WIBA Schedule Import's "Overtime / Bonus / Other Earnings")
// defaults to 0 exactly like basicMonthlySalary/monthlyAllowance already
// did — a row that has never set it calculates identically to before this
// field existed.
export function resolveWibaRowAnnualWages(row: WibaPayrollRowInput): Prisma.Decimal {
  const hasSalaryInputs =
    row.basicMonthlySalary != null || row.monthlyAllowance != null || row.monthlyOtherEarnings != null;
  if (!hasSalaryInputs) return roundMoney(toDecimal(row.annualWages));

  const basic = row.basicMonthlySalary != null ? toDecimal(row.basicMonthlySalary) : toDecimal(0);
  const allowance = row.monthlyAllowance != null ? toDecimal(row.monthlyAllowance) : toDecimal(0);
  const otherEarnings = row.monthlyOtherEarnings != null ? toDecimal(row.monthlyOtherEarnings) : toDecimal(0);
  return roundMoney(basic.plus(allowance).plus(otherEarnings).times(row.employeeCount).times(12));
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
