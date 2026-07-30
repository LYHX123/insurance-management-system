"use server";

// Dropbox Integration Phase 6 — ADMIN-only Settings backfill actions for
// Invoice document synchronization. Mirrors
// policyDocumentDropboxBackfillActions.ts's exact shape: preview never
// touches Dropbox; batch actions process one bounded, resumable batch per
// call.
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import {
  previewInvoiceDocumentBackfill,
  runInvoiceDocumentBackfillBatch,
  type InvoiceDocumentBackfillPreview,
  type InvoiceDocumentBackfillBatchResult,
  type InvoiceDocumentBackfillMode,
} from "@/lib/integrations/dropbox/invoiceDocumentSync";

export type InvoiceDocumentPreviewResult = { success: true; preview: InvoiceDocumentBackfillPreview } | { success: false; error: "FORBIDDEN" };
export type InvoiceDocumentBatchResult = { success: true; batch: InvoiceDocumentBackfillBatchResult } | { success: false; error: "FORBIDDEN" };

export async function previewInvoiceDocumentBackfillAction(): Promise<InvoiceDocumentPreviewResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const preview = await previewInvoiceDocumentBackfill();
  return { success: true, preview };
}

async function runBatchAction(mode: InvoiceDocumentBackfillMode): Promise<InvoiceDocumentBatchResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const batch = await runInvoiceDocumentBackfillBatch(mode);
  revalidatePath("/settings");
  return { success: true, batch };
}

export async function initMissingInvoiceDocumentsAction(): Promise<InvoiceDocumentBatchResult> {
  return runBatchAction("init-missing");
}

export async function syncMissingInvoiceDocumentsAction(): Promise<InvoiceDocumentBatchResult> {
  return runBatchAction("sync-missing");
}

export async function retryFailedInvoiceDocumentsAction(): Promise<InvoiceDocumentBatchResult> {
  return runBatchAction("retry-failed");
}

export async function verifySyncedInvoiceDocumentsAction(): Promise<InvoiceDocumentBatchResult> {
  return runBatchAction("verify-synced");
}
