"use server";

// Dropbox Integration Phase 5, Part 12 — ADMIN-only Settings backfill
// actions for Policy document synchronization. Mirrors
// quotationDropboxBackfillActions.ts's exact shape: preview never touches
// Dropbox; batch actions process one bounded, resumable batch per call.
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import {
  previewPolicyDocumentBackfill,
  runPolicyDocumentBackfillBatch,
  type PolicyDocumentBackfillPreview,
  type PolicyDocumentBackfillBatchResult,
  type PolicyDocumentBackfillMode,
} from "@/lib/integrations/dropbox/policyDocumentSync";

export type PolicyDocumentPreviewResult = { success: true; preview: PolicyDocumentBackfillPreview } | { success: false; error: "FORBIDDEN" };
export type PolicyDocumentBatchResult = { success: true; batch: PolicyDocumentBackfillBatchResult } | { success: false; error: "FORBIDDEN" };

export async function previewPolicyDocumentBackfillAction(): Promise<PolicyDocumentPreviewResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const preview = await previewPolicyDocumentBackfill();
  return { success: true, preview };
}

async function runBatchAction(mode: PolicyDocumentBackfillMode): Promise<PolicyDocumentBatchResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const batch = await runPolicyDocumentBackfillBatch(mode);
  revalidatePath("/settings");
  return { success: true, batch };
}

export async function initMissingPolicyDocumentMetadataAction(): Promise<PolicyDocumentBatchResult> {
  return runBatchAction("init-missing");
}

export async function syncMissingPolicyDocumentsBackfillAction(): Promise<PolicyDocumentBatchResult> {
  return runBatchAction("sync-missing");
}

export async function retryFailedPolicyDocumentsAction(): Promise<PolicyDocumentBatchResult> {
  return runBatchAction("retry-failed");
}

export async function verifySyncedPolicyDocumentsAction(): Promise<PolicyDocumentBatchResult> {
  return runBatchAction("verify-synced");
}
