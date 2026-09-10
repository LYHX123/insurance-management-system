import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { canDelete, POLICY_CATEGORY_PERMISSION } from "@/lib/permissions";
import { policyDocumentStorage } from "@/lib/policyDocuments/storage";
import {
  getPolicyDeleteBlockers,
  type PolicyDeleteBlocker,
} from "@/lib/policy/getPolicyDeleteBlockers";
import type { PolicyCategory } from "@/generated/prisma/enums";

export type DeletePolicyResult =
  | { success: true; recordNumber: string }
  | {
      success: false;
      error:
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "CONFIRMATION_MISMATCH"
        | "HAS_DEPENDENCIES"
        | "DELETE_FAILED";
      blockers?: PolicyDeleteBlocker[];
    };

// Phase 13D — Permanent, PERMISSION-CONTROLLED Policy delete (all 4
// categories share this one implementation — see src/app/(app)/policy/
// {motor,non-motor,bond,work-permit}/actions.ts's thin delete*Action
// wrappers). A true hard delete, unlike every other "removal" in the Policy
// domain (Cancel Policy is just businessStatus="CANCELLED" and is UNCHANGED
// by this phase; PolicyCustomerReceipt/PolicyProviderPayment use a bare
// deletedAt) — once this returns success the row and its cascaded children
// are gone.
//
// Authorization (Phase 13D §B): NO LONGER admin-only. Requires the DELETE
// capability for the policy's REAL category — policy.<category>.delete — an
// independently-assignable permission that is never implied by .edit or a
// legacy bare key. Admins still pass via canDelete()'s isAdmin() bypass. The
// category is re-resolved from the loaded DB record; the `category` argument
// from the caller is only used to reject a mismatched route (NOT_FOUND).
//
// Eligibility (Phase 13D §C/§L/§M/§N): getPolicyDeleteBlockers is the single
// source of truth. Deletion is BLOCKED — never made possible by
// cascade-deleting the dependency — when the policy has any invoice item,
// customer receipt, provider payment, commission ledger posting, linked
// Motor/Non-Motor claim, or renewal-chain relation.
//
// What is deleted (Phase 13D §D): only policy-OWNED children, all via
// onDelete: Cascade on policyRecord.delete() inside the transaction below:
//   MotorPolicyDetail / NonMotorPolicyDetail / BondPolicyDetail /
//   WorkPermitPolicyDetail, PolicyCustomerReceipt, PolicyProviderPayment,
//   PolicyDocument (+ its PolicyDocumentDropboxSync), PolicyActivity,
//   PolicyDropboxBusinessFile. Customer, other policies, Quotation/
//   QuotationCase (PolicyRecord is the child of sourceQuotation), Invoices,
//   claims and ledger entries are NEVER touched.
//
// Dropbox (Phase 13D §E): NO Dropbox file/folder is ever deleted, moved or
// renamed. This module does not import the Dropbox SDK/service at all. The
// PolicyDocument DB rows (policy-owned metadata) cascade away; the LOCAL
// on-disk document files are removed after the transaction commits
// (best-effort, log-don't-fail) — that local storage is not Dropbox.
//
// confirmedRecordNumber is whatever the user typed into the
// PolicyDeleteButton confirmation dialog (trimmed client-side) — re-verified
// here independently against the DB record, so a bypassed/modified client
// cannot delete a record without supplying its real recordNumber.
export async function deletePolicyRecord(
  id: string,
  category: PolicyCategory,
  confirmedRecordNumber: string
): Promise<DeletePolicyResult> {
  const session = await auth();
  if (!session?.user) return { success: false, error: "FORBIDDEN" };

  const record = await prisma.policyRecord.findUnique({
    where: { id },
    select: {
      id: true,
      recordNumber: true,
      category: true,
      documents: { select: { storagePath: true } },
    },
  });
  // A wrong id, OR a real id reached through the wrong category route, is
  // reported the same way — never a category-mismatched delete.
  if (!record || record.category !== category) {
    return { success: false, error: "NOT_FOUND" };
  }

  // Permission is resolved from the record's ACTUAL category, never the
  // caller-supplied argument alone. Fails closed if the category has no
  // mapped permission key.
  const permissionKey = POLICY_CATEGORY_PERMISSION[record.category];
  if (!permissionKey || !canDelete(session.user, permissionKey)) {
    return { success: false, error: "FORBIDDEN" };
  }

  if (confirmedRecordNumber.trim() !== record.recordNumber) {
    return { success: false, error: "CONFIRMATION_MISMATCH" };
  }

  const blockerResult = await getPolicyDeleteBlockers(prisma, id);
  if (!blockerResult) return { success: false, error: "NOT_FOUND" };
  if (!blockerResult.canDelete) {
    return { success: false, error: "HAS_DEPENDENCIES", blockers: blockerResult.blockers };
  }

  // Technical server-log record of the deletion (no application-wide
  // AuditLog model exists — see this phase's investigation — and
  // PolicyActivity itself cascades away with the row, so it can't hold a
  // durable "POLICY_DELETED" entry either). Written BEFORE the delete.
  console.info(
    `[policy-permanent-delete] actor=${session.user.id} recordNumber=${record.recordNumber} ` +
      `category=${record.category} policyId=${id} action=POLICY_PERMANENT_DELETE at=${new Date().toISOString()}`
  );

  try {
    await prisma.$transaction(async (tx) => {
      // Single statement — every policy-owned child is onDelete: Cascade
      // (see this function's doc comment and prisma/schema.prisma). The
      // blocker check above already guaranteed no onDelete: Restrict
      // relation (InvoiceItem, renewal self-relations) still points here.
      await tx.policyRecord.delete({ where: { id } });
    });
  } catch (err) {
    console.error(`Failed to permanently delete policy ${id}:`, err);
    return { success: false, error: "DELETE_FAILED" };
  }

  // Local on-disk document cleanup only — never Dropbox. DB-first, then
  // file, log-don't-fail (mirrors deletePolicyDocumentAction).
  for (const doc of record.documents) {
    try {
      await policyDocumentStorage.deleteFile(doc.storagePath);
    } catch (err) {
      console.error(
        `Policy ${id} was deleted but its local document file could not be removed (${doc.storagePath}):`,
        err
      );
    }
  }

  return { success: true, recordNumber: record.recordNumber };
}
