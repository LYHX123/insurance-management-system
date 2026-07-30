"use server";

// Dropbox Integration Phase 7, Part 12/13 — ADMIN-only Settings backfill
// actions for Motor Claim document synchronization. Mirrors
// invoiceDocumentDropboxBackfillActions.ts's exact shape: preview never
// touches Dropbox; batch actions process one bounded, resumable batch per
// call.
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import {
  previewMotorClaimDocumentBackfill,
  runMotorClaimDocumentBackfillBatch,
  type ClaimDocumentBackfillPreview,
  type ClaimDocumentBackfillBatchResult,
  type ClaimDocumentBackfillMode,
} from "@/lib/integrations/dropbox/motorClaimDocumentSync";

export type MotorClaimDocumentPreviewResult = { success: true; preview: ClaimDocumentBackfillPreview } | { success: false; error: "FORBIDDEN" };
export type MotorClaimDocumentBatchResult = { success: true; batch: ClaimDocumentBackfillBatchResult } | { success: false; error: "FORBIDDEN" };

export async function previewMotorClaimDocumentBackfillAction(): Promise<MotorClaimDocumentPreviewResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const preview = await previewMotorClaimDocumentBackfill();
  return { success: true, preview };
}

async function runBatchAction(mode: ClaimDocumentBackfillMode): Promise<MotorClaimDocumentBatchResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const batch = await runMotorClaimDocumentBackfillBatch(mode);
  revalidatePath("/settings");
  return { success: true, batch };
}

export async function initMissingMotorClaimDocumentsAction(): Promise<MotorClaimDocumentBatchResult> {
  return runBatchAction("init-missing");
}

export async function syncMissingMotorClaimDocumentsBackfillAction(): Promise<MotorClaimDocumentBatchResult> {
  return runBatchAction("sync-missing");
}

export async function retryFailedMotorClaimDocumentsAction(): Promise<MotorClaimDocumentBatchResult> {
  return runBatchAction("retry-failed");
}

export async function verifySyncedMotorClaimDocumentsAction(): Promise<MotorClaimDocumentBatchResult> {
  return runBatchAction("verify-synced");
}
