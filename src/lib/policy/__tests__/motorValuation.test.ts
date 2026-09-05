import { describe, it, expect } from "vitest";
import {
  isComprehensiveMotorCover,
  isMotorValuationStatus,
  isValuationPending,
  DEFAULT_MOTOR_VALUATION_STATUS,
  MOTOR_VALUATION_STATUSES,
} from "@/lib/policy/motorValuation";

describe("isComprehensiveMotorCover", () => {
  it("matches only COMPREHENSIVE, case-insensitively and trimmed", () => {
    expect(isComprehensiveMotorCover("COMPREHENSIVE")).toBe(true);
    expect(isComprehensiveMotorCover("  comprehensive ")).toBe(true);
    expect(isComprehensiveMotorCover("Comprehensive")).toBe(true);
  });
  it("does NOT match Third Party, COMESA, EXCESS PROTECTOR, empty or null", () => {
    for (const v of ["THIRD PARTY", "TPO", "COMESA", "EXCESS", "EXCESS PROTECTOR", "VALUATION", "", null, undefined]) {
      expect(isComprehensiveMotorCover(v)).toBe(false);
    }
  });
});

describe("isMotorValuationStatus / defaults", () => {
  it("accepts the three enum values, rejects anything else", () => {
    for (const s of MOTOR_VALUATION_STATUSES) expect(isMotorValuationStatus(s)).toBe(true);
    for (const s of ["", "ALL", "PENDING", "done", null, undefined]) expect(isMotorValuationStatus(s)).toBe(false);
  });
  it("a new Comprehensive policy defaults to NOT_ARRANGED", () => {
    expect(DEFAULT_MOTOR_VALUATION_STATUS).toBe("NOT_ARRANGED");
  });
});

describe("isValuationPending (reminder gate)", () => {
  it("Comprehensive + NOT_ARRANGED / IN_PROGRESS -> pending", () => {
    expect(isValuationPending("COMPREHENSIVE", "NOT_ARRANGED")).toBe(true);
    expect(isValuationPending("COMPREHENSIVE", "IN_PROGRESS")).toBe(true);
  });
  it("Comprehensive + COMPLETED -> not pending", () => {
    expect(isValuationPending("COMPREHENSIVE", "COMPLETED")).toBe(false);
  });
  it("Comprehensive + null (historical / untracked) -> not pending", () => {
    expect(isValuationPending("COMPREHENSIVE", null)).toBe(false);
  });
  it("non-Comprehensive -> never pending, whatever the status", () => {
    expect(isValuationPending("THIRD PARTY", "NOT_ARRANGED")).toBe(false);
    expect(isValuationPending("THIRD PARTY", "IN_PROGRESS")).toBe(false);
  });
});
