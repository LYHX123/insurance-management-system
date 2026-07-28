import { describe, it, expect } from "vitest";
import {
  insuranceTypeFolderCode,
  resolveInsuranceTypeCodeForNaming,
  buildBusinessFolderName,
  disambiguateBusinessFolderName,
  buildQuotationBaseFileName,
  sanitizeBusinessTitle,
  compactDate,
} from "../quotationDropboxNaming";

const DATE = new Date("2026-07-27T00:00:00Z");

describe("insuranceTypeFolderCode (Phase 4 Part 4.2)", () => {
  it("maps every known InsuranceType.code to its standardized folder code", () => {
    expect(insuranceTypeFolderCode("CAR")).toBe("CAR");
    expect(insuranceTypeFolderCode("WIBA")).toBe("WIBA");
    expect(insuranceTypeFolderCode("EL")).toBe("EL");
    expect(insuranceTypeFolderCode("CPM")).toBe("CPM");
    expect(insuranceTypeFolderCode("PL")).toBe("PL");
    expect(insuranceTypeFolderCode("FIRE")).toBe("FIRE");
    expect(insuranceTypeFolderCode("BURGLARY")).toBe("BURGLARY");
    expect(insuranceTypeFolderCode("GIT_SINGLE")).toBe("GIT");
    expect(insuranceTypeFolderCode("GIT_ANNUAL")).toBe("GIT");
    expect(insuranceTypeFolderCode("MARINE")).toBe("MARINE");
    expect(insuranceTypeFolderCode("MOTOR_COMP_PRIVATE")).toBe("MOTOR");
    expect(insuranceTypeFolderCode("MOTOR_COMP_COMMERCIAL")).toBe("MOTOR");
    expect(insuranceTypeFolderCode("MOTOR_TPO_PRIVATE")).toBe("MOTOR");
    expect(insuranceTypeFolderCode("MOTOR_TPO_COMMERCIAL")).toBe("MOTOR");
    expect(insuranceTypeFolderCode("GPA")).toBe("GPA");
    expect(insuranceTypeFolderCode("MEDICAL")).toBe("MEDICAL");
    expect(insuranceTypeFolderCode("TENDER_SECURITY")).toBe("BID BOND");
    expect(insuranceTypeFolderCode("PERFORMANCE_BOND")).toBe("PERFORMANCE BOND");
    expect(insuranceTypeFolderCode("APG")).toBe("APG");
    expect(insuranceTypeFolderCode("CUSTOMS_BOND")).toBe("CUSTOMS BOND");
  });

  it("never invents a code for an unsupported type — falls back to the raw code", () => {
    expect(insuranceTypeFolderCode("SOME_NEW_TYPE")).toBe("SOME_NEW_TYPE");
  });
});

describe("resolveInsuranceTypeCodeForNaming (Correction 2)", () => {
  it("one section: uses its standardized code directly", () => {
    expect(resolveInsuranceTypeCodeForNaming(["CAR"])).toBe("CAR");
  });

  it("repeated sections of the same normalized type still count as one type", () => {
    expect(resolveInsuranceTypeCodeForNaming(["MOTOR_COMP_PRIVATE", "MOTOR_TPO_PRIVATE"])).toBe("MOTOR");
    expect(resolveInsuranceTypeCodeForNaming(["GIT_SINGLE", "GIT_ANNUAL", "GIT_SINGLE"])).toBe("GIT");
  });

  it("two distinct normalized types resolve to MULTI", () => {
    expect(resolveInsuranceTypeCodeForNaming(["CAR", "WIBA"])).toBe("MULTI");
  });

  it("three distinct normalized types resolve to MULTI", () => {
    expect(resolveInsuranceTypeCodeForNaming(["CAR", "WIBA", "EL"])).toBe("MULTI");
  });

  it("is order-independent — reordered sections produce the same result", () => {
    const forward = resolveInsuranceTypeCodeForNaming(["CAR", "WIBA", "EL"]);
    const reversed = resolveInsuranceTypeCodeForNaming(["EL", "WIBA", "CAR"]);
    const shuffled = resolveInsuranceTypeCodeForNaming(["WIBA", "CAR", "EL"]);
    expect(reversed).toBe(forward);
    expect(shuffled).toBe(forward);
  });

  it("a revision changing from single-type to multi-type reflects the new snapshot", () => {
    const beforeAddingSection = resolveInsuranceTypeCodeForNaming(["CAR"]);
    const afterAddingSection = resolveInsuranceTypeCodeForNaming(["CAR", "WIBA"]);
    expect(beforeAddingSection).toBe("CAR");
    expect(afterAddingSection).toBe("MULTI");
  });

  it("empty section list falls back to OTHER rather than throwing", () => {
    expect(resolveInsuranceTypeCodeForNaming([])).toBe("OTHER");
  });
});

describe("buildBusinessFolderName (Phase 4 Part 4 / 17.B)", () => {
  it("1. CAR with project name matches the spec's exact example", () => {
    const name = buildBusinessFolderName({ businessDate: DATE, insuranceTypeCode: "CAR", businessTitle: "Nakuru Water Project" });
    expect(name).toBe("20260727-CAR-NAKURU WATER PROJECT");
  });

  it("2. Motor with a number plate as the title", () => {
    const name = buildBusinessFolderName({
      businessDate: DATE,
      insuranceTypeCode: insuranceTypeFolderCode("MOTOR_COMP_PRIVATE"),
      businessTitle: "KDA 123X",
    });
    expect(name).toBe("20260727-MOTOR-KDA 123X");
  });

  it("3. Bond with a project/tender name as the title", () => {
    const name = buildBusinessFolderName({
      businessDate: DATE,
      insuranceTypeCode: insuranceTypeFolderCode("TENDER_SECURITY"),
      businessTitle: "Mombasa Road Upgrade",
    });
    expect(name).toBe("20260727-BID BOND-MOMBASA ROAD UPGRADE");
  });

  it("4. a missing/blank title falls back to a deterministic default", () => {
    const name = buildBusinessFolderName({ businessDate: DATE, insuranceTypeCode: "CAR", businessTitle: "" });
    expect(name).toBe("20260727-CAR-QUOTATION");
  });

  it("5. preserves readable Unicode project names", () => {
    const name = buildBusinessFolderName({ businessDate: DATE, insuranceTypeCode: "CAR", businessTitle: "内罗毕水务项目" });
    expect(name).toBe("20260727-CAR-内罗毕水务项目");
  });

  it("6. removes invalid/Windows-reserved path characters", () => {
    const name = buildBusinessFolderName({ businessDate: DATE, insuranceTypeCode: "CAR", businessTitle: 'Water/Sewer: "Phase 2" <Final>' });
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
  });

  it("removes control characters and CR/LF", () => {
    const name = buildBusinessFolderName({ businessDate: DATE, insuranceTypeCode: "CAR", businessTitle: "Evil\r\nTitle\x00" });
    expect(name).not.toMatch(/[\r\n\x00]/);
  });

  it("never produces a title of just '.' or '..'", () => {
    const name = buildBusinessFolderName({ businessDate: DATE, insuranceTypeCode: "CAR", businessTitle: ".." });
    expect(name).toBe("20260727-CAR-QUOTATION");
  });

  it("7. enforces a maximum title length", () => {
    const longTitle = "A".repeat(500);
    const name = buildBusinessFolderName({ businessDate: DATE, insuranceTypeCode: "CAR", businessTitle: longTitle });
    expect(name.length).toBeLessThan(120);
  });

  it("is deterministic — snapshotting the same inputs always reproduces the same folder name", () => {
    const a = buildBusinessFolderName({ businessDate: DATE, insuranceTypeCode: "CAR", businessTitle: "Nakuru Water Project" });
    const b = buildBusinessFolderName({ businessDate: DATE, insuranceTypeCode: "CAR", businessTitle: "Nakuru Water Project" });
    expect(a).toBe(b);
  });
});

describe("disambiguateBusinessFolderName (Phase 4 Part 4.5 / 17.B.8)", () => {
  it("8. appends the quotation number as a deterministic suffix on collision", () => {
    const suffixed = disambiguateBusinessFolderName("20260727-CAR-NAKURU WATER PROJECT", "QT202607-006");
    expect(suffixed).toBe("20260727-CAR-NAKURU WATER PROJECT-QT202607-006");
  });
});

describe("buildQuotationBaseFileName (Phase 4 Part 5 / 17.C)", () => {
  it("1/2. produces the exact example base name (Excel/PDF share it)", () => {
    const base = buildQuotationBaseFileName({ insuranceTypeCode: "CAR", customerShortName: "CRSG", businessDate: DATE, versionNumber: 1 });
    expect(base).toBe("CAR-CRSG-20260727-V1");
  });

  it("3. version increments produce V2, V3...", () => {
    expect(buildQuotationBaseFileName({ insuranceTypeCode: "CAR", customerShortName: "CRSG", businessDate: DATE, versionNumber: 2 })).toBe(
      "CAR-CRSG-20260727-V2"
    );
    expect(buildQuotationBaseFileName({ insuranceTypeCode: "CAR", customerShortName: "CRSG", businessDate: DATE, versionNumber: 3 })).toBe(
      "CAR-CRSG-20260727-V3"
    );
  });

  it("5. uses the standardized insurance-type mapping, including multi-word codes", () => {
    const base = buildQuotationBaseFileName({
      insuranceTypeCode: insuranceTypeFolderCode("TENDER_SECURITY"),
      customerShortName: "CRSG",
      businessDate: DATE,
      versionNumber: 1,
    });
    expect(base).toBe("BID-BOND-CRSG-20260727-V1");
  });

  it("6. Unicode customer short name is preserved in the filename segment", () => {
    const base = buildQuotationBaseFileName({ insuranceTypeCode: "CAR", customerShortName: "中铁七局", businessDate: DATE, versionNumber: 1 });
    expect(base).toBe("CAR-中铁七局-20260727-V1");
  });

  it("7. sanitizes path-breaking characters out of the short name segment", () => {
    const base = buildQuotationBaseFileName({ insuranceTypeCode: "CAR", customerShortName: "CR/SG\\X", businessDate: DATE, versionNumber: 1 });
    expect(base).not.toMatch(/[/\\]/);
  });

  it("does not use spaces — collapses them to hyphens per the recommended convention", () => {
    const base = buildQuotationBaseFileName({
      insuranceTypeCode: insuranceTypeFolderCode("PERFORMANCE_BOND"),
      customerShortName: "China Railway",
      businessDate: DATE,
      versionNumber: 1,
    });
    expect(base).not.toContain(" ");
    expect(base).toBe("PERFORMANCE-BOND-CHINA-RAILWAY-20260727-V1");
  });

  it("8. the date segment matches the immutable business-date snapshot exactly", () => {
    const base = buildQuotationBaseFileName({ insuranceTypeCode: "CAR", customerShortName: "CRSG", businessDate: new Date("2026-01-05T00:00:00Z"), versionNumber: 1 });
    expect(base).toContain("20260105");
  });

  it("9. this module never reads or returns the system Quotation number — it stays entirely separate", () => {
    const base = buildQuotationBaseFileName({ insuranceTypeCode: "CAR", customerShortName: "CRSG", businessDate: DATE, versionNumber: 1 });
    expect(base).not.toContain("QT");
  });

  it("rejects CR/LF and control characters in the short name segment", () => {
    const base = buildQuotationBaseFileName({ insuranceTypeCode: "CAR", customerShortName: "CR\r\nSG\x00", businessDate: DATE, versionNumber: 1 });
    expect(base).not.toMatch(/[\r\n\x00]/);
  });
});

describe("sanitizeBusinessTitle / compactDate", () => {
  it("compactDate produces YYYYMMDD with no separators", () => {
    expect(compactDate(DATE)).toBe("20260727");
  });

  it("sanitizeBusinessTitle falls back when the sanitized result is empty", () => {
    expect(sanitizeBusinessTitle("   ", "FALLBACK")).toBe("FALLBACK");
    expect(sanitizeBusinessTitle("///", "FALLBACK")).toBe("FALLBACK");
  });
});
