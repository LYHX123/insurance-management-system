"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import type { QuotationSyncResult } from "@/lib/integrations/dropbox/quotationDropboxSync";

// The value exports of quotationDropboxSync (and, through them, the whole
// quotationTemplateEngine graph — ExcelJS, JSZip, fs template loading) are
// imported dynamically inside each action, never at module scope: these
// admin-only actions back the <QuotationDropboxStatus> widget on the
// read-only /quotation/[id] detail page, and a static import would drag the
// entire Excel-generation runtime into that page's server module graph just
// to render a status badge. Only loaded when an admin actually clicks
// retry / re-upload / verify.
const dropboxSync = () => import("@/lib/integrations/dropbox/quotationDropboxSync");

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

  const { syncQuotationVersionToDropbox } = await dropboxSync();
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

  const { verifyBusinessFolder } = await dropboxSync();
  const result = await verifyBusinessFolder(quotationId);
  revalidatePath(`/quotation/${quotationId}`);
  return result;
}

export async function verifyQuotationVersionAction(versionId: string): Promise<QuotationDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, status: "ERROR", forbidden: true };

  const { verifyQuotationVersion } = await dropboxSync();
  const result = await verifyQuotationVersion(versionId);
  await revalidateForVersion(versionId);
  return result;
}
