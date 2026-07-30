"use server";

// Dropbox Integration Phase 5, Part 11 — ADMIN-only Policy document Dropbox
// actions, shared across all four Policy categories (mirrors quotation/
// dropboxActions.ts's shape). Every action independently calls
// requireAdmin(), resolves records from database ids only (never an
// arbitrary client-supplied path), and is idempotent/non-destructive.
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { POLICY_CATEGORY_PERMISSION, POLICY_CATEGORY_ROUTES } from "@/lib/permissions";
import {
  syncPolicyDocumentToDropbox,
  verifyPolicyDocumentSync,
  verifyPolicyBusinessFolder,
  type PolicyDocumentSyncResult,
} from "@/lib/integrations/dropbox/policyDocumentSync";

export type PolicyDropboxActionResult =
  | ({ forbidden?: false } & PolicyDocumentSyncResult)
  | { success: false; forbidden: true };

function forbidden(): PolicyDropboxActionResult {
  return { success: false, forbidden: true };
}

async function revalidatePolicyDetail(policyRecordId: string) {
  const record = await prisma.policyRecord.findUnique({ where: { id: policyRecordId }, select: { category: true } });
  if (!record) return;
  const key = POLICY_CATEGORY_PERMISSION[record.category];
  const slug = POLICY_CATEGORY_ROUTES.find((r) => r.key === key)?.slug ?? "motor";
  revalidatePath(`/policy/${slug}/${policyRecordId}`);
}

// Retry a PENDING/ERROR/CONFLICT Policy document sync — reuses the exact
// same local file and standardized filename (Part 7, requirement 10; Part
// 11, requirement 1).
export async function retryPolicyDocumentSyncAction(policyDocumentId: string): Promise<PolicyDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return forbidden();
  const result = await syncPolicyDocumentToDropbox(policyDocumentId);
  const document = await prisma.policyDocument.findUnique({ where: { id: policyDocumentId }, select: { policyRecordId: true } });
  if (document) await revalidatePolicyDetail(document.policyRecordId);
  return result;
}

// Re-upload the current local file even when already SYNCED (e.g. after a
// manual external edit was detected) — same underlying sync call, which
// always re-reads the current local file (Part 11, requirement 5).
export async function reuploadPolicyDocumentAction(policyDocumentId: string): Promise<PolicyDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return forbidden();
  const result = await syncPolicyDocumentToDropbox(policyDocumentId);
  const document = await prisma.policyDocument.findUnique({ where: { id: policyDocumentId }, select: { policyRecordId: true } });
  if (document) await revalidatePolicyDetail(document.policyRecordId);
  return result;
}

// Read-only — never creates/uploads/moves/deletes anything (Part 11,
// requirement 4/8).
export async function verifyPolicyDocumentAction(policyDocumentId: string): Promise<PolicyDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return forbidden();
  return verifyPolicyDocumentSync(policyDocumentId);
}

// Read-only verification of the Policy's business folder (Part 11,
// requirement 2).
export async function verifyPolicyBusinessFolderAction(policyRecordId: string): Promise<PolicyDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return forbidden();
  const result = await verifyPolicyBusinessFolder(policyRecordId);
  await revalidatePolicyDetail(policyRecordId);
  return result;
}

export type SyncMissingResult =
  | { success: true; processed: number; succeeded: number; failed: number }
  | { success: false; error: "FORBIDDEN" };

// Part 11, requirement 6/7: bounded, sequential, per-Policy convenience
// action — synchronizes/retries every not-yet-SYNCED document belonging to
// THIS ONE Policy (never an unbounded system-wide backfill; that lives in
// Settings, see policyDocumentDropboxBackfillActions.ts).
export async function syncMissingPolicyDocumentsAction(policyRecordId: string): Promise<SyncMissingResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const documents = await prisma.policyDocument.findMany({
    where: { policyRecordId, OR: [{ dropboxSync: null }, { dropboxSync: { syncStatus: { in: ["PENDING", "SYNCING", "ERROR", "CONFLICT"] } } }] },
    select: { id: true },
  });

  let succeeded = 0;
  for (const doc of documents) {
    const result = await syncPolicyDocumentToDropbox(doc.id);
    if (result.success) succeeded++;
  }

  await revalidatePolicyDetail(policyRecordId);
  return { success: true, processed: documents.length, succeeded, failed: documents.length - succeeded };
}
