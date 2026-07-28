"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import {
  previewCustomerDocumentBackfill,
  runCustomerDocumentBackfillBatch,
  type DocumentBackfillPreview,
  type DocumentBackfillBatchResult,
  type DocumentBackfillMode,
} from "@/lib/integrations/dropbox/customerDocumentSync";

// ADMIN-only, per Phase 3 spec Part 11. Preview never touches Dropbox;
// batch actions process a bounded, resumable batch per call (never an
// unbounded Promise.all) so a single request can't run indefinitely.

export type DocumentPreviewResult = { success: true; preview: DocumentBackfillPreview } | { success: false; error: "FORBIDDEN" };
export type DocumentBatchResult = { success: true; batch: DocumentBackfillBatchResult } | { success: false; error: "FORBIDDEN" };

export async function previewCustomerDocumentBackfillAction(): Promise<DocumentPreviewResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const preview = await previewCustomerDocumentBackfill();
  return { success: true, preview };
}

async function runBatchAction(mode: DocumentBackfillMode): Promise<DocumentBatchResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const batch = await runCustomerDocumentBackfillBatch(mode);
  revalidatePath("/settings");
  return { success: true, batch };
}

export async function syncMissingCustomerDocumentsAction(): Promise<DocumentBatchResult> {
  return runBatchAction("missing");
}

export async function retryFailedCustomerDocumentsAction(): Promise<DocumentBatchResult> {
  return runBatchAction("retry-failed");
}

export async function verifySyncedCustomerDocumentsAction(): Promise<DocumentBatchResult> {
  return runBatchAction("verify-all");
}
