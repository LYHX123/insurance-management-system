import { describe, it, expect } from "vitest";
import { buildCustomerFolderName } from "../customer-folder-names";

describe("buildCustomerFolderName (Part 23.B)", () => {
  it("formats a normal company name", () => {
    expect(buildCustomerFolderName({ customerNumber: "CUST-0001", companyName: "ABC Company Limited" })).toBe(
      "CUST-0001 - ABC Company Limited"
    );
  });

  it("keeps duplicate/similar names distinct via the stable record number", () => {
    const a = buildCustomerFolderName({ customerNumber: "CUST-0001", companyName: "ABC Company Limited" });
    const b = buildCustomerFolderName({ customerNumber: "CUST-0002", companyName: "ABC Company Limited" });
    expect(a).not.toBe(b);
    expect(a).toContain("CUST-0001");
    expect(b).toContain("CUST-0002");
  });

  it("trims leading/trailing spaces", () => {
    expect(buildCustomerFolderName({ customerNumber: "CUST-0003", companyName: "  Spacey Co  " })).toBe(
      "CUST-0003 - Spacey Co"
    );
  });

  it("collapses multiple internal spaces", () => {
    expect(buildCustomerFolderName({ customerNumber: "CUST-0004", companyName: "Multi   Space   Co" })).toBe(
      "CUST-0004 - Multi Space Co"
    );
  });

  it("replaces slashes and backslashes", () => {
    const name = buildCustomerFolderName({ customerNumber: "CUST-0005", companyName: "A/B\\C Ltd" });
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
  });

  it("strips control characters", () => {
    const name = buildCustomerFolderName({ customerNumber: "CUST-0006", companyName: "Bad\x00Name\x1f" });
    expect(/[\x00-\x1f\x7f]/.test(name)).toBe(false);
  });

  it("caps a very long company name while preserving the record-number prefix", () => {
    const longName = "A".repeat(300);
    const result = buildCustomerFolderName({ customerNumber: "CUST-0007", companyName: longName });
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.startsWith("CUST-0007")).toBe(true);
  });

  it("preserves readable Unicode company names", () => {
    expect(buildCustomerFolderName({ customerNumber: "CUST-0008", companyName: "北京国际贸易有限公司" })).toBe(
      "CUST-0008 - 北京国际贸易有限公司"
    );
  });

  it("falls back to the customer number alone when the company name sanitizes to blank", () => {
    expect(buildCustomerFolderName({ customerNumber: "CUST-0009", companyName: "///\\\\\x00\x01" })).toBe("CUST-0009");
  });

  it("is deterministic for the same input", () => {
    const input = { customerNumber: "CUST-0010", companyName: "Deterministic Co" };
    expect(buildCustomerFolderName(input)).toBe(buildCustomerFolderName(input));
  });

  it("never produces a blank result", () => {
    const result = buildCustomerFolderName({ customerNumber: "CUST-0011", companyName: "" });
    expect(result.trim().length).toBeGreaterThan(0);
  });
});
