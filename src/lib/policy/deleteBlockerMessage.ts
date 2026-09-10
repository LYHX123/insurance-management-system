import type {
  PolicyDeleteBlocker,
  PolicyDeleteBlockerType,
} from "@/lib/policy/getPolicyDeleteBlockers";

// Phase 13D — turns the structured blocker list from getPolicyDeleteBlockers
// into one user-facing, already-translated sentence for the confirmation
// dialog. Pure + dictionary-driven (the caller passes the localized strings
// from useLocale) so it stays testable and never hard-codes bilingual text.
export type PolicyDeleteBlockerLabels = Record<PolicyDeleteBlockerType, string>;

export function formatPolicyDeleteBlockers(
  intro: string,
  labels: PolicyDeleteBlockerLabels,
  blockers: readonly PolicyDeleteBlocker[]
): string {
  // De-duplicate (Motor + Non-Motor claim map to the same phrase) while
  // preserving order.
  const seen = new Set<string>();
  const reasons: string[] = [];
  for (const blocker of blockers) {
    const label = labels[blocker.type];
    if (label && !seen.has(label)) {
      seen.add(label);
      reasons.push(label);
    }
  }
  if (reasons.length === 0) return intro;
  return `${intro} ${reasons.join("；")}`;
}

// The subset of the `policy` dictionary this module needs — keeps the four
// Policy overview tabs from each re-typing the same blocker-type → phrase map.
export type PolicyDeleteBlockerDict = {
  deletePolicyBlockerInvoice: string;
  deletePolicyBlockerReceipt: string;
  deletePolicyBlockerPayment: string;
  deletePolicyBlockerLedger: string;
  deletePolicyBlockerClaim: string;
  deletePolicyBlockerRenewal: string;
};

export function policyDeleteBlockerLabels(p: PolicyDeleteBlockerDict): PolicyDeleteBlockerLabels {
  return {
    INVOICE: p.deletePolicyBlockerInvoice,
    CUSTOMER_RECEIPT: p.deletePolicyBlockerReceipt,
    PROVIDER_PAYMENT: p.deletePolicyBlockerPayment,
    LEDGER_RECORD: p.deletePolicyBlockerLedger,
    MOTOR_CLAIM: p.deletePolicyBlockerClaim,
    NON_MOTOR_CLAIM: p.deletePolicyBlockerClaim,
    RENEWAL: p.deletePolicyBlockerRenewal,
  };
}
