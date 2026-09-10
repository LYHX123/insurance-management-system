import type { Prisma } from "@/generated/prisma/client";

// Phase 13D — the single, reusable "is this policy safe to permanently
// delete?" check. Deliberately a standalone, independently testable helper
// (not scattered guards) so both the server action and any future caller
// agree on exactly one definition of "protected downstream dependency".
//
// A policy may be permanently deleted ONLY when every count below is zero.
// Everything here is a downstream business record that must NEVER be
// cascade-deleted to make a policy removable (Phase 13D spec §C/§M/§N):
//
//   INVOICE          — any InvoiceItem references this policy (issued OR
//                      cancelled). InvoiceItem.policyRecordId is onDelete:
//                      Restrict at the DB level too; this surfaces it as a
//                      friendly blocker instead of a raw FK violation.
//   CUSTOMER_RECEIPT  — a non-deleted PolicyCustomerReceipt exists (client
//                      money received against this policy).
//   PROVIDER_PAYMENT — a non-deleted PolicyProviderPayment exists (money
//                      paid to the insurer/agent for this policy).
//   LEDGER_RECORD     — a commission financial posting exists: the System
//                      Ledger projects one row per policy with
//                      commissionReceived=true AND a real amount AND a real
//                      date (see src/lib/ledger/systemRecords.ts). Receipts
//                      and payments also feed the System Ledger but are
//                      reported under their own types above.
//   MOTOR_CLAIM /     — a non-deleted Motor/Non-Motor claim is linked to
//   NON_MOTOR_CLAIM     this policy (claim.policyRecordId). Claims are never
//                      cascade-deleted; the policy delete is blocked instead.
//   RENEWAL           — this policy is part of a Phase 12D renewal chain:
//                      it is itself a renewal (renewedFromId set), it has a
//                      direct successor (renewedBy), or it is the root of a
//                      chain that still has renewal members. Blocking, never
//                      auto-repairing the chain (spec §L).
export type PolicyDeleteBlockerType =
  | "INVOICE"
  | "CUSTOMER_RECEIPT"
  | "PROVIDER_PAYMENT"
  | "LEDGER_RECORD"
  | "MOTOR_CLAIM"
  | "NON_MOTOR_CLAIM"
  | "RENEWAL";

export type PolicyDeleteBlocker = {
  type: PolicyDeleteBlockerType;
  count: number;
};

export type PolicyDeleteBlockersResult = {
  canDelete: boolean;
  blockers: PolicyDeleteBlocker[];
};

// `client` is a Prisma client or an interactive-transaction client — the
// checks are all reads, so either works. Returns null only when the policy
// id does not resolve (the caller maps that to NOT_FOUND).
export async function getPolicyDeleteBlockers(
  client: Prisma.TransactionClient,
  policyId: string
): Promise<PolicyDeleteBlockersResult | null> {
  const [
    record,
    invoiceItemCount,
    customerReceiptCount,
    providerPaymentCount,
    motorClaimCount,
    nonMotorClaimCount,
    renewalChildCount,
  ] = await Promise.all([
    client.policyRecord.findUnique({
      where: { id: policyId },
      select: {
        id: true,
        commissionReceived: true,
        commissionAmount: true,
        commissionReceivedDate: true,
        renewedFromId: true,
        renewedBy: { select: { id: true } },
      },
    }),
    client.invoiceItem.count({ where: { policyRecordId: policyId } }),
    client.policyCustomerReceipt.count({ where: { policyRecordId: policyId, deletedAt: null } }),
    client.policyProviderPayment.count({ where: { policyRecordId: policyId, deletedAt: null } }),
    client.motorClaim.count({ where: { policyRecordId: policyId, deletedAt: null } }),
    client.nonMotorClaim.count({ where: { policyRecordId: policyId, deletedAt: null } }),
    // Renewals of a chain all point rootPolicyId at the ORIGINAL policy's id
    // (null on the original itself) — so this is non-zero only when `policyId`
    // is the root of a chain that still has renewal periods.
    client.policyRecord.count({ where: { rootPolicyId: policyId, deletedAt: null } }),
  ]);

  if (!record) return null;

  const hasCommissionPosting =
    record.commissionReceived &&
    record.commissionAmount !== null &&
    record.commissionReceivedDate !== null;

  const successorCount = Math.max(renewalChildCount, record.renewedBy ? 1 : 0);
  const renewalRelatedCount = successorCount + (record.renewedFromId ? 1 : 0);

  const blockers: PolicyDeleteBlocker[] = [];
  if (invoiceItemCount > 0) blockers.push({ type: "INVOICE", count: invoiceItemCount });
  if (customerReceiptCount > 0) blockers.push({ type: "CUSTOMER_RECEIPT", count: customerReceiptCount });
  if (providerPaymentCount > 0) blockers.push({ type: "PROVIDER_PAYMENT", count: providerPaymentCount });
  if (hasCommissionPosting) blockers.push({ type: "LEDGER_RECORD", count: 1 });
  if (motorClaimCount > 0) blockers.push({ type: "MOTOR_CLAIM", count: motorClaimCount });
  if (nonMotorClaimCount > 0) blockers.push({ type: "NON_MOTOR_CLAIM", count: nonMotorClaimCount });
  if (renewalRelatedCount > 0) blockers.push({ type: "RENEWAL", count: renewalRelatedCount });

  return { canDelete: blockers.length === 0, blockers };
}
