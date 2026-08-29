import { describe, it, expect } from "vitest";
import { MOTOR_TAX_CLASSES, isMotorTaxClass } from "../motorTaxClasses";

// Phase 10 — the Motor vehicle tax class "SPV" was a mislabel and is now
// "PSV" (Public Service Vehicle). Renamed at the DB level via
// `ALTER TYPE ... RENAME VALUE`, so no historical value mapping exists.

describe("MOTOR_TAX_CLASSES", () => {
  it("contains PSV and no longer contains SPV", () => {
    expect(MOTOR_TAX_CLASSES).toContain("PSV");
    expect(MOTOR_TAX_CLASSES).not.toContain("SPV");
  });

  it("is exactly the closed set PRIVATE / COMMERCIAL / PSV / SPECIAL_USE", () => {
    expect([...MOTOR_TAX_CLASSES]).toEqual(["PRIVATE", "COMMERCIAL", "PSV", "SPECIAL_USE"]);
  });

  it("isMotorTaxClass accepts PSV and rejects the old SPV", () => {
    expect(isMotorTaxClass("PSV")).toBe(true);
    expect(isMotorTaxClass("SPV")).toBe(false);
  });
});
