import type { PolicyCategory, PolicyRenewalDecision } from "@/generated/prisma/enums";

// Phase 12D — Policy Renewal Chain. Pure helpers (no prisma/auth import) so
// they are unit-testable and safe to import from client components.

export type { PolicyRenewalDecision };

// Category route prefix — same map as several other modules keep their own
// copy of (see src/lib/invoice/eligibility.ts). Used to link between periods
// in a renewal chain.
export const RENEWAL_CATEGORY_ROUTE: Record<PolicyCategory, string> = {
  MOTOR: "/policy/motor",
  NON_MOTOR: "/policy/non-motor",
  BOND: "/policy/bond",
  WORK_PERMIT: "/policy/work-permit",
};

// A minimal chain member — only what the Renewal History card renders. The
// caller (a server component) maps its Prisma rows into this shape.
export type RenewalChainMember = {
  id: string;
  recordNumber: string;
  category: PolicyCategory;
  renewalIndex: number;
  renewalDecision: PolicyRenewalDecision | null;
  effectiveDate: string;
  expiryDate: string;
  businessStatus: string;
  isCurrent: boolean; // the record whose detail page is being viewed
};

// "Original" / "Renewal 1" / "Renewal 2" … — the caller localises the two
// stems; this only decides which one and the number.
export function renewalPeriodKey(renewalIndex: number): { key: "original" | "renewal"; index: number } {
  return renewalIndex <= 0 ? { key: "original", index: 0 } : { key: "renewal", index: renewalIndex };
}

// The chain root id for any record: an original is its own root; a renewal
// points at rootPolicyId. Never returns null.
export function resolveRootPolicyId(record: { id: string; rootPolicyId: string | null }): string {
  return record.rootPolicyId ?? record.id;
}

// Renewal-year folder segment (Phase 12D spec §16) — the calendar year of
// the renewal period's effective date, used only for renewalIndex >= 1.
export function renewalYearSegment(effectiveDate: Date): string {
  return String(effectiveDate.getUTCFullYear());
}

// Can this record be renewed right now? (UI gate; the server action
// re-checks everything.)
//   - not deleted
//   - has no successor already
//   - not explicitly marked NOT_RENEWED (must be reopened first)
export function canRenewPolicy(record: {
  deletedAt: Date | null;
  hasSuccessor: boolean;
  renewalDecision: PolicyRenewalDecision | null;
}): boolean {
  return !record.deletedAt && !record.hasSuccessor && record.renewalDecision !== "NOT_RENEWED";
}

// Can this record be marked "Do Not Renew"? Never once a successor exists.
export function canMarkNotRenewed(record: {
  deletedAt: Date | null;
  hasSuccessor: boolean;
  renewalDecision: PolicyRenewalDecision | null;
}): boolean {
  return !record.deletedAt && !record.hasSuccessor && record.renewalDecision !== "NOT_RENEWED";
}

// Can this record's NOT_RENEWED decision be reopened back to PENDING?
export function canReopenRenewal(record: {
  deletedAt: Date | null;
  hasSuccessor: boolean;
  renewalDecision: PolicyRenewalDecision | null;
}): boolean {
  return !record.deletedAt && !record.hasSuccessor && record.renewalDecision === "NOT_RENEWED";
}
