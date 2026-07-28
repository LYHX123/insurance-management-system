import { describe, it, expect } from "vitest";
import { validateCustomerShortName, MAX_CUSTOMER_SHORT_NAME_LENGTH } from "../customer-utils";

describe("validateCustomerShortName (Phase 4 Part 2/17.A)", () => {
  it("accepts a normal short name", () => {
    const result = validateCustomerShortName("CRSG");
    expect(result).toEqual({ ok: true, value: "CRSG" });
  });

  it("trims leading/trailing spaces and collapses repeated spaces", () => {
    const result = validateCustomerShortName("  China   Railway  ");
    expect(result).toEqual({ ok: true, value: "China Railway" });
  });

  it("allows numbers and safe hyphens", () => {
    const result = validateCustomerShortName("CRSG-2026");
    expect(result.ok).toBe(true);
  });

  it("allows Chinese characters in the stored value", () => {
    const result = validateCustomerShortName("中铁七局");
    expect(result).toEqual({ ok: true, value: "中铁七局" });
  });

  it("8. rejects path separators", () => {
    expect(validateCustomerShortName("CRSG/2026").ok).toBe(false);
    expect(validateCustomerShortName("CRSG\\2026").ok).toBe(false);
  });

  it("9. rejects control characters", () => {
    const result = validateCustomerShortName("CRSG\r\nX");
    expect(result.ok).toBe(false);
  });

  it("rejects '.' and '..' as the complete value", () => {
    expect(validateCustomerShortName(".").ok).toBe(false);
    expect(validateCustomerShortName("..").ok).toBe(false);
    expect(validateCustomerShortName("  ..  ").ok).toBe(false);
  });

  it("7. a blank value is valid (the field is optional)", () => {
    const result = validateCustomerShortName("   ");
    expect(result).toEqual({ ok: true, value: "" });
  });

  it("enforces a maximum length", () => {
    const tooLong = "A".repeat(MAX_CUSTOMER_SHORT_NAME_LENGTH + 1);
    const result = validateCustomerShortName(tooLong);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SHORT_NAME_TOO_LONG");
  });

  it("a value at exactly the maximum length is accepted", () => {
    const exact = "A".repeat(MAX_CUSTOMER_SHORT_NAME_LENGTH);
    const result = validateCustomerShortName(exact);
    expect(result.ok).toBe(true);
  });
});
