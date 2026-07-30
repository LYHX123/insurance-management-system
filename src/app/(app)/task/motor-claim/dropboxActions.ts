"use server";

// Dropbox Integration Phase 7 — ADMIN-only Motor Claim Dropbox actions.
// Mirrors policy/dropboxActions.ts's shape exactly. Every action
// independently calls requireAdmin(), resolves records from database ids
// only (never an arbitrary client-supplied path/filename/business-file
// id), and is idempotent/non-destructive.
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import {
  syncMotorClaimDocumentToDropbox,
  verifyMotorClaimDocumentSync,
  verifyMotorClaimBusinessFolder,
} from "@/lib/integrations/dropbox/motorClaimDocumentSync";
import type { ClaimDocumentSyncResult } from "@/lib/integrations/dropbox/motorClaimDocumentSync";

export type MotorClaimDropboxActionResult =
  | ({ forbidden?: false } & ClaimDocumentSyncResult)
  | { success: false; forbidden: true };

function forbidden(): MotorClaimDropboxActionResult {
  return { success: false, forbidden: true };
}

export async function retryMotorClaimDocumentSyncAction(motorClaimDocumentId: string): Promise<MotorClaimDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return forbidden();
  const result = await syncMotorClaimDocumentToDropbox(motorClaimDocumentId);
  const document = await prisma.motorClaimDocument.findUnique({ where: { id: motorClaimDocumentId }, select: { motorClaimId: true } });
  if (document) revalidatePath(`/task/motor-claim/${document.motorClaimId}`);
  return result;
}

// Read-only — never creates/uploads/moves/deletes anything.
export async function verifyMotorClaimDocumentAction(motorClaimDocumentId: string): Promise<MotorClaimDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return forbidden();
  return verifyMotorClaimDocumentSync(motorClaimDocumentId);
}

export async function verifyMotorClaimBusinessFolderAction(motorClaimId: string): Promise<MotorClaimDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return forbidden();
  const result = await verifyMotorClaimBusinessFolder(motorClaimId);
  revalidatePath(`/task/motor-claim/${motorClaimId}`);
  return result;
}

export type SyncMissingMotorClaimDocumentsResult =
  | { success: true; processed: number; succeeded: number; failed: number }
  | { success: false; error: "FORBIDDEN" };

// Bounded, sequential, per-Claim convenience action — synchronizes/retries
// every not-yet-SYNCED document belonging to THIS ONE Claim (never an
// unbounded system-wide backfill; that lives in Settings).
export async function syncMissingMotorClaimDocumentsAction(motorClaimId: string): Promise<SyncMissingMotorClaimDocumentsResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const documents = await prisma.motorClaimDocument.findMany({
    where: { motorClaimId, OR: [{ dropboxSync: null }, { dropboxSync: { syncStatus: { in: ["PENDING", "SYNCING", "ERROR", "CONFLICT"] } } }] },
    select: { id: true },
  });

  let succeeded = 0;
  for (const doc of documents) {
    const result = await syncMotorClaimDocumentToDropbox(doc.id);
    if (result.success) succeeded++;
  }

  revalidatePath(`/task/motor-claim/${motorClaimId}`);
  return { success: true, processed: documents.length, succeeded, failed: documents.length - succeeded };
}
