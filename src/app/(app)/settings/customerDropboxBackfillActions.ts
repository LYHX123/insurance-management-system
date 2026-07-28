"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import {
  previewCustomerFolderBackfill,
  runCustomerFolderBackfillBatch,
  type BackfillPreview,
  type BackfillBatchResult,
  type BackfillMode,
} from "@/lib/integrations/dropbox/customer-folders";

// ADMIN-only, per Phase 2 spec Part 12. Preview never touches Dropbox;
// batch actions process a bounded, resumable batch per call (never an
// unbounded Promise.all) so a single request can't run indefinitely.

export type PreviewResult = { success: true; preview: BackfillPreview } | { success: false; error: "FORBIDDEN" };
export type BatchResult = { success: true; batch: BackfillBatchResult } | { success: false; error: "FORBIDDEN" };

export async function previewCustomerBackfillAction(): Promise<PreviewResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const preview = await previewCustomerFolderBackfill();
  return { success: true, preview };
}

async function runBatchAction(mode: BackfillMode): Promise<BatchResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const batch = await runCustomerFolderBackfillBatch(mode);
  revalidatePath("/settings");
  return { success: true, batch };
}

export async function syncMissingCustomerFoldersAction(): Promise<BatchResult> {
  return runBatchAction("missing");
}

export async function retryFailedCustomerFoldersAction(): Promise<BatchResult> {
  return runBatchAction("retry-failed");
}

export async function verifyAllCustomerFoldersAction(): Promise<BatchResult> {
  return runBatchAction("verify-all");
}
