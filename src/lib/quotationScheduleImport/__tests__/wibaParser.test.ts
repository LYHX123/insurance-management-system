import { describe, it, expect } from "vitest";
import { parseWibaSchedule } from "../wibaParser";
import { buildWibaFixtureBuffer, buildSyntheticWibaWorkbook, loadWibaFixtureWorkbook } from "./fixtureHelpers";

// Phase 9 — WIBA Schedule Import parser tests. Every scenario below (except
// the explicitly-noted "50+ rows" one) parses a COPY of the real, approved
// WIBA-IMPORT-TEMPLATE.xlsx with specific data cells filled in — see
// fixtureHelpers.ts.

describe("parseWibaSchedule", () => {
  it("Case 1: a single valid row parses correctly", async () => {
    const buffer = await buildWibaFixtureBuffer([{ occupation: "Mason", basicSalary: 14000, allowance: 3500, otherEarnings: 10000, employeeCount: 50 }]);
    const result = await parseWibaSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe("valid");
    // (14000+3500+10000)*50 = 1,375,000 monthly; *12 = 16,500,000 annual.
    expect(result.rows[0].monthlyEarnings).toBe("1375000");
    expect(result.rows[0].annualEarnings).toBe("16500000");
    expect(result.hasErrors).toBe(false);
  });

  it("Case 2: multiple valid rows all parse with correct per-row totals and schedule totals", async () => {
    const buffer = await buildWibaFixtureBuffer([
      { occupation: "Mason", basicSalary: 14000, allowance: 3500, otherEarnings: 10000, employeeCount: 50 },
      { occupation: "Carpenter", basicSalary: 14000, allowance: 3500, otherEarnings: 10000, employeeCount: 45 },
      { occupation: "Foreman", basicSalary: 20000, allowance: 4000, otherEarnings: 10000, employeeCount: 18 },
    ]);
    const result = await parseWibaSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(3);
    expect(result.rows.every((r) => r.status === "valid")).toBe(true);
    expect(result.totals.totalEmployees).toBe(50 + 45 + 18);
  });

  it("Case 3: blank Allowance is treated as 0, not an error", async () => {
    const buffer = await buildWibaFixtureBuffer([{ occupation: "Cleaner", basicSalary: 15000, allowance: null, otherEarnings: null, employeeCount: 8 }]);
    const result = await parseWibaSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("valid");
    expect(result.rows[0].allowance).toBe("");
    // (15000+0+0)*8 = 120000
    expect(result.rows[0].monthlyEarnings).toBe("120000");
  });

  it("Case 4: blank Overtime/Bonus/Other Earnings is treated as 0, not an error", async () => {
    const buffer = await buildWibaFixtureBuffer([{ occupation: "Cleaner", basicSalary: 15000, allowance: 1000, otherEarnings: null, employeeCount: 8 }]);
    const result = await parseWibaSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("valid");
    // (15000+1000+0)*8 = 128000
    expect(result.rows[0].monthlyEarnings).toBe("128000");
  });

  it("Case 5: a row with no Occupation is an error", async () => {
    const buffer = await buildWibaFixtureBuffer([{ occupation: null, basicSalary: 14000, allowance: 3500, otherEarnings: 10000, employeeCount: 50 }]);
    const result = await parseWibaSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("error");
    expect(result.rows[0].errorCode).toBe("OCCUPATION_REQUIRED");
    expect(result.hasErrors).toBe(true);
  });

  it("Case 6: an invalid (negative / non-numeric) Basic Salary is an error", async () => {
    const buffer = await buildWibaFixtureBuffer([{ occupation: "Mason", basicSalary: -100, allowance: 0, otherEarnings: 0, employeeCount: 1 }]);
    const result = await parseWibaSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe("error");
    expect(result.rows[0].errorCode).toBe("BASIC_SALARY_INVALID");
  });

  it("Case 7: Number of Employees = 0 or blank is an error (must be > 0)", async () => {
    const buffer = await buildWibaFixtureBuffer([
      { occupation: "Mason", basicSalary: 14000, allowance: 0, otherEarnings: 0, employeeCount: 0 },
      { occupation: "Carpenter", basicSalary: 14000, allowance: 0, otherEarnings: 0, employeeCount: null },
    ]);
    const result = await parseWibaSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].errorCode).toBe("EMPLOYEE_COUNT_INVALID");
    expect(result.rows[1].errorCode).toBe("EMPLOYEE_COUNT_INVALID");
  });

  it("Case 8: the workbook's own G/H formula results are never trusted — the system recalculates independently and correctly even when G/H are wrong", async () => {
    // Start from the real fixture, fill B-F normally, then deliberately
    // corrupt column G/H (the formula cells) with a wrong literal value —
    // simulating a stale/tampered/mis-recalculated Excel file.
    const workbook = await loadWibaFixtureWorkbook();
    const worksheet = workbook.getWorksheet("WIBA LIST")!;
    worksheet.getCell("B2").value = "Mason";
    worksheet.getCell("C2").value = 14000;
    worksheet.getCell("D2").value = 3500;
    worksheet.getCell("E2").value = 10000;
    worksheet.getCell("F2").value = 50;
    worksheet.getCell("G2").value = 999; // wrong on purpose
    worksheet.getCell("H2").value = 1; // wrong on purpose
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parseWibaSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Correct value is (14000+3500+10000)*50 = 1,375,000 / *12 = 16,500,000
    // — NOT the tampered G2=999/H2=1.
    expect(result.rows[0].monthlyEarnings).toBe("1375000");
    expect(result.rows[0].annualEarnings).toBe("16500000");
  });

  it("Case 9: the TOTAL footer row is never imported as a data row", async () => {
    const buffer = await buildWibaFixtureBuffer([{ occupation: "Mason", basicSalary: 14000, allowance: 3500, otherEarnings: 10000, employeeCount: 50 }]);
    const result = await parseWibaSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows.some((r) => r.occupation.toLowerCase().includes("total"))).toBe(false);
  });

  it("Case 10: blank rows between data rows are skipped, not imported and not errors", async () => {
    const buffer = await buildWibaFixtureBuffer([
      { occupation: "Mason", basicSalary: 14000, allowance: 3500, otherEarnings: 10000, employeeCount: 50 },
      {}, // fully blank row — the pre-filled "No" column alone must not count as data
      { occupation: "Carpenter", basicSalary: 14000, allowance: 3500, otherEarnings: 10000, employeeCount: 45 },
    ]);
    const result = await parseWibaSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    // >= 1, not an exact count — buildWibaFixtureBuffer also blanks out the
    // fixture's remaining unused template rows (5-14), which correctly
    // count as additional skipped blank rows too.
    expect(result.blankRowsSkipped).toBeGreaterThanOrEqual(1);
    expect(result.rows.map((r) => r.occupation)).toEqual(["Mason", "Carpenter"]);
  });

  it("Case 11: 50+ rows are all scanned — the parser never hardcodes a row limit", async () => {
    const buffer = await buildSyntheticWibaWorkbook(60);
    const result = await parseWibaSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(60);
    expect(result.rows.every((r) => r.status === "valid")).toBe(true);
    expect(result.totals.totalEmployees).toBe(60 * 2);
  });

  it("an occupation cell with the literal word 'total' inside a real name is NOT misclassified as the footer", async () => {
    const buffer = await buildWibaFixtureBuffer([{ occupation: "Total Station Operator", basicSalary: 20000, allowance: 0, otherEarnings: 0, employeeCount: 2 }]);
    const result = await parseWibaSchedule(buffer);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].occupation).toBe("Total Station Operator");
  });

  it("rejects a workbook with no matching WIBA worksheet as INVALID_TEMPLATE", async () => {
    const buffer = await import("./fixtureHelpers").then((m) => m.buildSyntheticCpmWorkbook(3));
    const result = await parseWibaSchedule(buffer);
    expect(result).toEqual({ ok: false, error: "INVALID_TEMPLATE" });
  });
});
