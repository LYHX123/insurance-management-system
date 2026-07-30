"use server";

// Dropbox Integration Phase 7 — ADMIN-only Non-Motor Claim Dropbox actions.
// Mirrors motor-claim/dropboxActions.ts exactly.
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import {
  syncNonMotorClaimDocumentToDropbox,
  verifyNonMotorClaimDocumentSync,
  verifyNonMotorClaimBusinessFolder,
} from "@/lib/integrations/dropbox/nonMotorClaimDocumentSync";
import type { ClaimDocumentSyncResult } from "@/lib/integrations/dropbox/nonMotorClaimDocumentSync";

export type NonMotorClaimDropboxActionResult =
  | ({ forbidden?: false } & ClaimDocumentSyncResult)
  | { success: false; forbidden: true };

function forbidden(): NonMotorClaimDropboxActionResult {
  return { success: false, forbidden: true };
}

export async function retryNonMotorClaimDocumentSyncAction(nonMotorClaimDocumentId: string): Promise<NonMotorClaimDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return forbidden();
  const result = await syncNonMotorClaimDocumentToDropbox(nonMotorClaimDocumentId);
  const document = await prisma.nonMotorClaimDocument.findUnique({ where: { id: nonMotorClaimDocumentId }, select: { nonMotorClaimId: true } });
  if (document) revalidatePath(`/task/non-motor-claim/${document.nonMotorClaimId}`);
  return result;
}

export async function verifyNonMotorClaimDocumentAction(nonMotorClaimDocumentId: string): Promise<NonMotorClaimDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return forbidden();
  return verifyNonMotorClaimDocumentSync(nonMotorClaimDocumentId);
}

export async function verifyNonMotorClaimBusinessFolderAction(nonMotorClaimId: string): Promise<NonMotorClaimDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return forbidden();
  const result = await verifyNonMotorClaimBusinessFolder(nonMotorClaimId);
  revalidatePath(`/task/non-motor-claim/${nonMotorClaimId}`);
  return result;
}

export type SyncMissingNonMotorClaimDocumentsResult =
  | { success: true; processed: number; succeeded: number; failed: number }
  | { success: false; error: "FORBIDDEN" };

export async function syncMissingNonMotorClaimDocumentsAction(nonMotorClaimId: string): Promise<SyncMissingNonMotorClaimDocumentsResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const documents = await prisma.nonMotorClaimDocument.findMany({
    where: { nonMotorClaimId, OR: [{ dropboxSync: null }, { dropboxSync: { syncStatus: { in: ["PENDING", "SYNCING", "ERROR", "CONFLICT"] } } }] },
    select: { id: true },
  });

  let succeeded = 0;
  for (const doc of documents) {
    const result = await syncNonMotorClaimDocumentToDropbox(doc.id);
    if (result.success) succeeded++;
  }

  revalidatePath(`/task/non-motor-claim/${nonMotorClaimId}`);
  return { success: true, processed: documents.length, succeeded, failed: documents.length - succeeded };
}
