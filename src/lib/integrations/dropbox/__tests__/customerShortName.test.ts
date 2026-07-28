import { describe, it, expect } from "vitest";
import { deriveCustomerShortName, deriveInitialsFromCompanyName } from "../customerShortName";

describe("deriveInitialsFromCompanyName (Phase 4 Part 2/17.A)", () => {
  it("4. derives initials, stripping legal-suffix boilerplate", () => {
    expect(deriveInitialsFromCompanyName("China Railway Seventh Group Co., Limited")).toBe("CRSG");
    expect(deriveInitialsFromCompanyName("China Jiangxi International Kenya Limited")).toBe("CJIK");
  });

  it("keeps descriptive words that aren't pure legal boilerplate", () => {
    expect(deriveInitialsFromCompanyName("Nakuru Water and Sanitation Services Company")).toBe("NWASSC");
  });

  it("5. handles punctuation (parentheses, ampersands) safely", () => {
    expect(deriveInitialsFromCompanyName("Smith & Sons (Kenya) Ltd.")).toBe("SSK");
  });

  it("6. a Chinese company name with no spaces yields too few letters, returns null (caller falls back further)", () => {
    expect(deriveInitialsFromCompanyName("中铁七局集团有限公司")).toBeNull();
  });
});

describe("deriveCustomerShortName (Phase 4 Part 2/12/17.A)", () => {
  it("1. uses the stored shortName when present", () => {
    const name = deriveCustomerShortName({ shortName: "CRSG", companyName: "China Railway Seventh Group Co., Limited", customerNumber: "CUST-0002" });
    expect(name).toBe("CRSG");
  });

  it("3. an existing Customer without shortName derives initials", () => {
    const name = deriveCustomerShortName({ shortName: null, companyName: "China Jiangxi International Kenya Limited", customerNumber: "CUST-0003" });
    expect(name).toBe("CJIK");
  });

  it("C. falls back to the customer number when initials cannot be derived safely", () => {
    const name = deriveCustomerShortName({ shortName: null, companyName: "中铁七局集团有限公司", customerNumber: "CUST-0002" });
    expect(name).toBe("CUST-0002");
  });

  it("a blank stored shortName is treated as absent, not used literally", () => {
    const name = deriveCustomerShortName({ shortName: "   ", companyName: "China Railway Seventh Group Co., Limited", customerNumber: "CUST-0002" });
    expect(name).toBe("CRSG");
  });

  it("13. never mutates or depends on any write to the Customer record — pure function", () => {
    const input = { shortName: null, companyName: "Acme Ltd", customerNumber: "CUST-0099" };
    const frozen = Object.freeze({ ...input });
    expect(() => deriveCustomerShortName(frozen)).not.toThrow();
  });
});
