import { describe, it, expect } from "vitest";
import en from "@/i18n/dictionaries/en";
import zh from "@/i18n/dictionaries/zh";
import {
  policyBusinessStatusLabel,
  motorValuationBadgeLabel,
  nonMotorCoverTypeLabel,
  bondTypeLabel,
  workPermitTypeLabel,
  policyRenewalPeriodLabel,
} from "@/lib/policy/policyDisplayLabels";

// Phase 13A — the export routes translate enum column values through these
// helpers, so both EN and 中文 must render real strings.

describe("policyDisplayLabels — EN / 中文", () => {
  it("business status", () => {
    expect(policyBusinessStatusLabel(en, "ACTIVE")).toBe("Active");
    expect(policyBusinessStatusLabel(zh, "ACTIVE")).toBe(zh.policy.statusActive);
    expect(policyBusinessStatusLabel(zh, "EXPIRED")).toBe(zh.policy.statusExpired);
  });

  it("valuation badge", () => {
    expect(motorValuationBadgeLabel(en, "IN_PROGRESS")).toBe("In Progress");
    expect(motorValuationBadgeLabel(zh, "COMPLETED")).toBe(zh.policy.valuationBadgeCompleted);
  });

  it("non-motor cover type", () => {
    expect(nonMotorCoverTypeLabel(en, "WIBA")).toBe(en.policy.coverWiba);
    expect(nonMotorCoverTypeLabel(zh, "MARINE")).toBe(zh.policy.coverMarine);
  });

  it("bond type — custom name wins", () => {
    expect(bondTypeLabel(en, "TENDER_BOND")).toBe(en.policy.bondTenderBond);
    expect(bondTypeLabel(en, "CUSTOM_BOND", "Retention Bond")).toBe("Retention Bond");
    expect(bondTypeLabel(zh, "PERFORMANCE_BOND")).toBe(zh.policy.bondPerformanceBond);
  });

  it("work permit type — other name wins", () => {
    expect(workPermitTypeLabel(en, "CLASS_D")).toBe(en.policy.permitClassD);
    expect(workPermitTypeLabel(en, "OTHER", "Investor Permit")).toBe("Investor Permit");
    expect(workPermitTypeLabel(zh, "SPECIAL_PASS")).toBe(zh.policy.permitSpecialPass);
  });

  it("renewal period", () => {
    expect(policyRenewalPeriodLabel(en, 0, null)).toBe("Original");
    expect(policyRenewalPeriodLabel(en, 2, null)).toBe("Renewal 2");
    expect(policyRenewalPeriodLabel(en, 0, "RENEWED")).toBe("Renewed");
    expect(policyRenewalPeriodLabel(en, 0, "NOT_RENEWED")).toBe("Not Renewed");
    expect(policyRenewalPeriodLabel(zh, 3, null)).toBe(zh.policy.renewalNumbered.replace("{n}", "3"));
  });
});
