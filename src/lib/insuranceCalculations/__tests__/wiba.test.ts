import { describe, it, expect } from "vitest";
import { resolveWibaRowAnnualWages, calculateWiba } from "../wiba";

// Phase 9 — WIBA Schedule Import, Case 18 (calculation backward-compat) +
// direct coverage of the monthlyOtherEarnings extension. No existing tests
// covered this module before this phase.

describe("resolveWibaRowAnnualWages", () => {
  it("a legacy row with only annualWages (no salary components at all) is returned untouched", () => {
    const result = resolveWibaRowAnnualWages({ employeeCount: 3, annualWages: 500000 });
    expect(result.toString()).toBe("500000");
  });

  it("Backward compatibility: basic + allowance only (monthlyOtherEarnings omitted) computes exactly as before this field existed", () => {
    const result = resolveWibaRowAnnualWages({ employeeCount: 2, annualWages: 0, basicMonthlySalary: 10000, monthlyAllowance: 1000 });
    // (10000 + 1000) * 2 * 12 = 264000 — the pre-Phase-9 formula's result.
    expect(result.toString()).toBe("264000");
  });

  it("basic + allowance + monthlyOtherEarnings all combine correctly", () => {
    const result = resolveWibaRowAnnualWages({ employeeCount: 2, annualWages: 0, basicMonthlySalary: 10000, monthlyAllowance: 1000, monthlyOtherEarnings: 500 });
    // (10000 + 1000 + 500) * 2 * 12 = 276000
    expect(result.toString()).toBe("276000");
  });

  it("monthlyOtherEarnings alone (basic/allowance both null) still enters the formula branch, treating the missing ones as 0", () => {
    const result = resolveWibaRowAnnualWages({ employeeCount: 1, annualWages: 999999, monthlyOtherEarnings: 2000 });
    // (0 + 0 + 2000) * 1 * 12 = 24000 — NOT the legacy annualWages=999999,
    // because monthlyOtherEarnings being set means "the formula branch
    // applies now."
    expect(result.toString()).toBe("24000");
  });

  it("monthlyOtherEarnings = null (never set) behaves identically to it not being in the object at all", () => {
    const withNull = resolveWibaRowAnnualWages({ employeeCount: 2, annualWages: 0, basicMonthlySalary: 10000, monthlyAllowance: 1000, monthlyOtherEarnings: null });
    const withoutField = resolveWibaRowAnnualWages({ employeeCount: 2, annualWages: 0, basicMonthlySalary: 10000, monthlyAllowance: 1000 });
    expect(withNull.toString()).toBe(withoutField.toString());
  });
});

describe("calculateWiba — schedule totals include monthlyOtherEarnings correctly", () => {
  it("totalAnnualWages/grossPremium reflect every row's monthlyOtherEarnings contribution", () => {
    const result = calculateWiba({
      wibaRate: 0.5,
      payrollRows: [
        { employeeCount: 2, annualWages: 0, basicMonthlySalary: 10000, monthlyAllowance: 1000, monthlyOtherEarnings: 500 }, // 276000
        { employeeCount: 1, annualWages: 0, basicMonthlySalary: 20000, monthlyAllowance: 0, monthlyOtherEarnings: 0 }, // 240000
      ],
    });
    expect(result.totalEmployeeCount).toBe(3);
    expect(result.totalAnnualWages.toString()).toBe("516000");
    // grossPremium = 516000 * 0.5 / 100 = 2580
    expect(result.grossPremium.toString()).toBe("2580");
  });
});
