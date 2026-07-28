"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import {
  previewQuotationBackfill,
  runQuotationBackfillBatch,
  type QuotationBackfillPreview,
  type QuotationBackfillBatchResult,
  type QuotationBackfillMode,
} from "@/lib/integrations/dropbox/quotationDropboxSync";

// ADMIN-only, per Phase 4 spec Part 11. Preview never touches Dropbox;
// batch actions process a bounded, resumable batch per call (never an
// unbounded Promise.all) so a single request can't run indefinitely.

export type QuotationPreviewResult = { success: true; preview: QuotationBackfillPreview } | { success: false; error: "FORBIDDEN" };
export type QuotationBatchResult = { success: true; batch: QuotationBackfillBatchResult } | { success: false; error: "FORBIDDEN" };

export async function previewQuotationBackfillAction(): Promise<QuotationPreviewResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const preview = await previewQuotationBackfill();
  return { success: true, preview };
}

async function runBatchAction(mode: QuotationBackfillMode): Promise<QuotationBatchResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const batch = await runQuotationBackfillBatch(mode);
  revalidatePath("/settings");
  return { success: true, batch };
}

export async function initMissingBusinessFilesAction(): Promise<QuotationBatchResult> {
  return runBatchAction("init-missing");
}

export async function syncMissingQuotationVersionsAction(): Promise<QuotationBatchResult> {
  return runBatchAction("sync-missing");
}

export async function retryFailedQuotationVersionsAction(): Promise<QuotationBatchResult> {
  return runBatchAction("retry-failed");
}

export async function verifySyncedQuotationVersionsAction(): Promise<QuotationBatchResult> {
  return runBatchAction("verify-synced");
}
