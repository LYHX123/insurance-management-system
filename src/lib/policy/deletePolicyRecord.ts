import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { policyDocumentStorage } from "@/lib/policyDocuments/storage";
import type { PolicyCategory } from "@/generated/prisma/enums";

export type DeletePolicyResult =
  | { success: true; recordNumber: string }
  | {
      success: false;
      error: "FORBIDDEN" | "NOT_FOUND" | "CONFIRMATION_MISMATCH" | "INVOICE_LINKED" | "DELETE_FAILED";
      invoiceNumbers?: string[];
    };

// Permanent, admin-only Policy delete (all 4 categories share this one
// implementation — see src/app/(app)/policy/{motor,non-motor,bond,
// work-permit}/actions.ts's thin delete*Action wrappers). This is a true
// hard delete, unlike every other "removal" in the Policy domain (Cancel
// Policy is just businessStatus="CANCELLED"; PolicyCustomerReceipt/
// PolicyProviderPayment use a bare deletedAt) — once this returns success
// the row and its cascaded children are gone.
//
// Relations (see prisma/schema.prisma):
// - MotorPolicyDetail/NonMotorPolicyDetail/BondPolicyDetail/
//   WorkPermitPolicyDetail, PolicyCustomerReceipt, PolicyProviderPayment,
//   PolicyDocument, PolicyActivity: all onDelete: Cascade — removed
//   automatically by policyRecord.delete() inside the transaction below.
//   PolicyDocument's DB row cascades but its file on disk does not, so
//   storagePaths are captured before the transaction and deleted after it
//   commits (mirrors deletePolicyDocumentAction's DB-first/file-second/
//   log-don't-fail pattern in policy/motor/documentActions.ts).
// - InvoiceItem.policyRecordId: onDelete: Restrict — the one real DB-level
//   blocker. Rather than let a raw FK-violation surface, checked explicitly
//   up front and reported with the blocking invoice number(s) (mirrors
//   deleteQuotationAction's QUOTATION_HAS_LINKED_POLICIES guard in
//   src/app/(app)/quotation/actions.ts). Never auto-deletes InvoiceItem
//   rows — an Invoice is a standalone financial record.
// - Quotation (via PolicyRecord.sourceQuotationId): PolicyRecord is the
//   child side here, so deleting it has no effect on the source Quotation —
//   nothing to do.
// - MotorClaim/NonMotorClaim: no relation field to PolicyRecord exists in
//   the current schema at all (see those models' own schema comments) — so
//   there is nothing to check. Reported as a known gap rather than
//   approximated with a heuristic (e.g. matching by registration number).
// - Manual Ledger entries / Ledger "System Records": no relation to Policy
//   (System Records are a live projection over PolicyCustomerReceipt/
//   PolicyProviderPayment/commission fields, not a stored table) — they
//   simply stop appearing once the source rows are gone; manual entries are
//   never touched.
// confirmedRecordNumber is whatever the user actually typed into the
// TypedConfirmDialog (trimmed client-side, see typed-confirm-dialog.tsx) —
// re-verified here independently rather than trusted, so a caller that
// changes/omits the client-side gate (a modified request, a bypassed UI)
// still cannot delete a record without supplying its real recordNumber.
export async function deletePolicyRecord(id: string, category: PolicyCategory, confirmedRecordNumber: string): Promise<DeletePolicyResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const record = await prisma.policyRecord.findUnique({
    where: { id, category },
    include: { documents: { select: { storagePath: true } } },
  });
  if (!record) return { success: false, error: "NOT_FOUND" };

  if (confirmedRecordNumber.trim() !== record.recordNumber) {
    return { success: false, error: "CONFIRMATION_MISMATCH" };
  }

  const linkedInvoiceItems = await prisma.invoiceItem.findMany({
    where: { policyRecordId: id },
    include: { invoice: { select: { invoiceNumber: true } } },
  });
  if (linkedInvoiceItems.length > 0) {
    const invoiceNumbers = [...new Set(linkedInvoiceItems.map((item) => item.invoice.invoiceNumber))];
    return { success: false, error: "INVOICE_LINKED", invoiceNumbers };
  }

  // Technical server-log record of the deletion (no application-wide
  // AuditLog/AdminLog model exists outside PolicyRecord to write into — see
  // this phase's investigation — and PolicyActivity itself cascades away
  // with the row, so it can't hold a durable "POLICY_DELETED" entry either).
  console.info(
    `[policy-delete] admin=${session.user.id} deleting policyRecord id=${id} recordNumber=${record.recordNumber} category=${category} at=${new Date().toISOString()}`
  );

  try {
    await prisma.$transaction(async (tx) => {
      await tx.policyRecord.delete({ where: { id } });
    });
  } catch (err) {
    console.error(`Failed to permanently delete policy ${id}:`, err);
    return { success: false, error: "DELETE_FAILED" };
  }

  for (const doc of record.documents) {
    try {
      await policyDocumentStorage.deleteFile(doc.storagePath);
    } catch (err) {
      console.error(`Policy ${id} was deleted but its document file could not be removed (${doc.storagePath}):`, err);
    }
  }

  return { success: true, recordNumber: record.recordNumber };
}
