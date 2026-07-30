"use server";

// Dropbox Integration Phase 7, Part 12/13 — ADMIN-only Settings backfill
// actions for Non-Motor Claim document synchronization. Mirrors
// motorClaimDocumentDropboxBackfillActions.ts's exact shape.
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import {
  previewNonMotorClaimDocumentBackfill,
  runNonMotorClaimDocumentBackfillBatch,
  type ClaimDocumentBackfillPreview,
  type ClaimDocumentBackfillBatchResult,
  type ClaimDocumentBackfillMode,
} from "@/lib/integrations/dropbox/nonMotorClaimDocumentSync";

export type NonMotorClaimDocumentPreviewResult = { success: true; preview: ClaimDocumentBackfillPreview } | { success: false; error: "FORBIDDEN" };
export type NonMotorClaimDocumentBatchResult = { success: true; batch: ClaimDocumentBackfillBatchResult } | { success: false; error: "FORBIDDEN" };

export async function previewNonMotorClaimDocumentBackfillAction(): Promise<NonMotorClaimDocumentPreviewResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const preview = await previewNonMotorClaimDocumentBackfill();
  return { success: true, preview };
}

async function runBatchAction(mode: ClaimDocumentBackfillMode): Promise<NonMotorClaimDocumentBatchResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const batch = await runNonMotorClaimDocumentBackfillBatch(mode);
  revalidatePath("/settings");
  return { success: true, batch };
}

export async function initMissingNonMotorClaimDocumentsAction(): Promise<NonMotorClaimDocumentBatchResult> {
  return runBatchAction("init-missing");
}

export async function syncMissingNonMotorClaimDocumentsBackfillAction(): Promise<NonMotorClaimDocumentBatchResult> {
  return runBatchAction("sync-missing");
}

export async function retryFailedNonMotorClaimDocumentsAction(): Promise<NonMotorClaimDocumentBatchResult> {
  return runBatchAction("retry-failed");
}

export async function verifySyncedNonMotorClaimDocumentsAction(): Promise<NonMotorClaimDocumentBatchResult> {
  return runBatchAction("verify-synced");
}
