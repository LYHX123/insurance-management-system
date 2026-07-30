"use server";

// Dropbox Integration Phase 6 — ADMIN-only Invoice Dropbox actions. Mirrors
// policy/dropboxActions.ts's shape exactly. Every action independently
// calls requireAdmin(), resolves records from database ids only (never an
// arbitrary client-supplied path/filename/business-file id), and is
// idempotent/non-destructive. Unlike Policy (which has retry AND a
// separate reupload action for its many-documents-per-record shape),
// Invoice has exactly one generated document per record, so one retry
// action covers both "retry after failure" and "re-upload while synced" —
// syncInvoiceDocumentToDropbox already handles both via its safe
// conditional-update logic.
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import {
  syncInvoiceDocumentToDropbox,
  verifyInvoiceDocumentSync,
  verifyInvoiceBusinessFolder,
} from "@/lib/integrations/dropbox/invoiceDocumentSync";
import type { InvoiceDocumentSyncResult } from "@/lib/integrations/dropbox/invoiceDocumentSync";

export type InvoiceDropboxActionResult =
  | ({ forbidden?: false } & InvoiceDocumentSyncResult)
  | { success: false; forbidden: true };

function forbidden(): InvoiceDropboxActionResult {
  return { success: false, forbidden: true };
}

export async function retryInvoiceDocumentSyncAction(invoiceId: string): Promise<InvoiceDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return forbidden();
  const result = await syncInvoiceDocumentToDropbox(invoiceId);
  revalidatePath(`/invoice/${invoiceId}`);
  return result;
}

// Read-only — never creates/uploads/moves/deletes anything.
export async function verifyInvoiceDocumentAction(invoiceId: string): Promise<InvoiceDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return forbidden();
  return verifyInvoiceDocumentSync(invoiceId);
}

// Read-only verification of the Invoice's business folder.
export async function verifyInvoiceBusinessFolderAction(invoiceId: string): Promise<InvoiceDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return forbidden();
  const result = await verifyInvoiceBusinessFolder(invoiceId);
  revalidatePath(`/invoice/${invoiceId}`);
  return result;
}
