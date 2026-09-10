import { describe, it, expect } from "vitest";
import { formatPolicyDeleteBlockers, policyDeleteBlockerLabels } from "../deleteBlockerMessage";
import en from "@/i18n/dictionaries/en";
import zh from "@/i18n/dictionaries/zh";

describe("formatPolicyDeleteBlockers", () => {
  const labels = policyDeleteBlockerLabels(en.policy);

  it("returns just the intro when there are no blockers", () => {
    expect(formatPolicyDeleteBlockers("blocked:", labels, [])).toBe("blocked:");
  });

  it("joins one reason after the intro", () => {
    const msg = formatPolicyDeleteBlockers(en.policy.deletePolicyBlocked, labels, [{ type: "INVOICE", count: 1 }]);
    expect(msg).toContain(en.policy.deletePolicyBlocked);
    expect(msg).toContain(en.policy.deletePolicyBlockerInvoice);
  });

  it("de-duplicates Motor + Non-Motor claim into a single phrase", () => {
    const msg = formatPolicyDeleteBlockers("x", labels, [
      { type: "MOTOR_CLAIM", count: 1 },
      { type: "NON_MOTOR_CLAIM", count: 1 },
    ]);
    const occurrences = msg.split(en.policy.deletePolicyBlockerClaim).length - 1;
    expect(occurrences).toBe(1);
  });

  it("works with the Chinese dictionary too", () => {
    const zhLabels = policyDeleteBlockerLabels(zh.policy);
    const msg = formatPolicyDeleteBlockers(zh.policy.deletePolicyBlocked, zhLabels, [
      { type: "RENEWAL", count: 1 },
      { type: "INVOICE", count: 1 },
    ]);
    expect(msg).toContain(zh.policy.deletePolicyBlockerRenewal);
    expect(msg).toContain(zh.policy.deletePolicyBlockerInvoice);
  });
});
