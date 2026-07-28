"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import {
  syncQuotationVersionToDropbox,
  verifyBusinessFolder,
  verifyQuotationVersion,
  type QuotationSyncResult,
} from "@/lib/integrations/dropbox/quotationDropboxSync";

// ADMIN-only, per Phase 4 spec Part 10/14: retry/verify/re-upload are all
// ADMIN-only regardless of UI visibility — each action independently
// re-checks requireAdmin(). None accept a Dropbox path from the browser;
// the target is always re-derived server-side from the version/quotation
// id (Part 16, requirement 11).

export type QuotationDropboxActionResult = QuotationSyncResult & { forbidden?: boolean };

async function revalidateForVersion(versionId: string) {
  const version = await prisma.quotationDropboxVersion.findUnique({ where: { id: versionId }, select: { sourceQuotationId: true } });
  if (version) revalidatePath(`/quotation/${version.sourceQuotationId}`);
}

// "Re-upload Current Version" is the same underlying operation as retry —
// syncQuotationVersionToDropbox always re-reads the current local artifact
// and targets the version's existing standardized name (Part 10,
// requirement: "use existing local artifacts", "no duplicate version
// creation on retry").
export async function retryQuotationDropboxSyncAction(versionId: string): Promise<QuotationDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, status: "ERROR", forbidden: true };

  const result = await syncQuotationVersionToDropbox(versionId);
  await revalidateForVersion(versionId);
  return result;
}

export async function reuploadQuotationVersionAction(versionId: string): Promise<QuotationDropboxActionResult> {
  return retryQuotationDropboxSyncAction(versionId);
}

export async function verifyBusinessFolderAction(quotationId: string): Promise<QuotationDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, status: "ERROR", forbidden: true };

  const result = await verifyBusinessFolder(quotationId);
  revalidatePath(`/quotation/${quotationId}`);
  return result;
}

export async function verifyQuotationVersionAction(versionId: string): Promise<QuotationDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, status: "ERROR", forbidden: true };

  const result = await verifyQuotationVersion(versionId);
  await revalidateForVersion(versionId);
  return result;
}
