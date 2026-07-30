// Server-only. Dropbox Integration Phase 6 — synchronizes an Invoice's
// already-locally-generated document into the Dropbox business-file
// structure under "<Business Folder>/Invoice/<standardized name>". Mirrors
// policyDocumentSync.ts's exact shape (local storage stays authoritative
// and immediate; nothing here ever blocks or reverses local generation).
// Simpler than Policy's version in one respect: an Invoice has exactly ONE
// generated file for its whole lifetime (no siblings, no revision concept —
// see Invoice.generatedFileName/generatedStoragePath's schema comment), so
// there is no sibling-disambiguation set to compute.
import type { Dropbox } from "dropbox";
import { prisma } from "@/lib/prisma";
import { invoiceDocumentStorage } from "@/lib/invoiceDocuments/storage";
import { getAuthenticatedDropboxClient } from "./service";
import { syncCustomerFolder } from "./customer-folders";
import { ensureBusinessFolder } from "./quotationDropboxSync";
import { ensureInvoiceDropboxBusinessFile, resolveInvoiceBusinessFileRefReadOnly, type InvoiceBusinessFileRef } from "./invoiceBusinessFile";
import { joinDropboxPath, assertInsideRoot } from "./paths";
import { DropboxIntegrationError, mapDropboxError, type DropboxErrorCode } from "./errors";
import { buildStandardizedInvoiceFilename, isPlausibleStandardizedInvoiceFilename } from "./invoiceDocumentFilenames";

const STALE_SYNCING_THRESHOLD_MS = 2 * 60 * 1000;
export const INVOICE_SUBFOLDER_NAME = "Invoice";
const DROPBOX_SIMPLE_UPLOAD_MAX_BYTES = 150 * 1024 * 1024;
const DROPBOX_SYNC_TIMEOUT_MS = 15_000;

export type InvoiceDocumentSyncOutcomeStatus = "PENDING" | "SYNCING" | "SYNCED" | "ERROR" | "CONFLICT";
export type InvoiceDocumentSyncResult = {
  success: boolean;
  status: InvoiceDocumentSyncOutcomeStatus;
  code?: DropboxErrorCode;
  message?: string;
};

type DocumentForSync = {
  id: string;
  invoiceNumber: string;
  customerId: string;
  generatedFileName: string | null;
  generatedStoragePath: string | null;
  customer: { dropboxFolder: { syncStatus: string; dropboxFolderId: string | null; displayPath: string | null } | null };
  dropboxSync: {
    standardizedFileName: string;
    syncStatus: string;
    lastSyncAttemptAt: Date | null;
    dropboxFileId: string | null;
    dropboxDisplayPath: string | null;
    dropboxSize: bigint | null;
    dropboxContentHash: string | null;
  } | null;
};

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("status" in err)) return false;
  const status = (err as { status: unknown }).status;
  const error = (err as { error?: unknown }).error;
  const summary =
    error && typeof error === "object" && "error_summary" in error && typeof (error as { error_summary: unknown }).error_summary === "string"
      ? (error as { error_summary: string }).error_summary
      : "";
  return status === 409 && summary.includes("not_found");
}

async function tryGetMetadata(client: Dropbox, path: string): Promise<{ tag: string; id: string | null; displayPath: string; rev?: string } | null> {
  try {
    const metadata = await client.filesGetMetadata({ path });
    const result = metadata.result;
    return {
      tag: result[".tag"],
      id: "id" in result ? (result.id ?? null) : null,
      displayPath: "path_display" in result ? (result.path_display ?? path) : path,
      rev: "rev" in result ? result.rev : undefined,
    };
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw mapDropboxError(err);
  }
}

function classifyStatus(code: DropboxErrorCode): "ERROR" | "CONFLICT" {
  return code === "INVOICE_DOCUMENT_CONFLICT" || code === "DROPBOX_FILE_IS_FOLDER" || code === "BUSINESS_FOLDER_CONFLICT" ? "CONFLICT" : "ERROR";
}

async function failResult(invoiceId: string, status: InvoiceDocumentSyncOutcomeStatus, code: DropboxErrorCode, message: string): Promise<InvoiceDocumentSyncResult> {
  await prisma.invoiceDocumentDropboxSync
    .update({ where: { invoiceId }, data: { syncStatus: status, lastErrorCode: code, lastErrorMessage: message, lastSyncAttemptAt: new Date() } })
    .catch(() => {});
  return { success: false, status, code, message };
}

// Ensures (creates if missing, otherwise verifies still current) the actual
// Dropbox folder for a resolved business file ref, updating whichever table
// (QuotationDropboxBusinessFile, PolicyDropboxBusinessFile, or
// InvoiceDropboxBusinessFile) it came from. Never creates a duplicate:
// reuses the ref's own dropboxDisplayPath when already SYNCED. A local
// version of policyDocumentSync.ts's ensureBusinessFolderOnDropbox — that
// one only branches on two source tables, this one on three.
async function ensureInvoiceBusinessFolderOnDropbox(
  client: Dropbox,
  customerFolderPath: string,
  ref: InvoiceBusinessFileRef,
  disambiguationSuffix: string
): Promise<{ ok: true; path: string } | { ok: false; status: "ERROR" | "CONFLICT"; code: DropboxErrorCode; message: string }> {
  if (ref.syncStatus === "SYNCED" && ref.dropboxDisplayPath) {
    return { ok: true, path: ref.dropboxDisplayPath };
  }

  const ensured = await ensureBusinessFolder(client, customerFolderPath, ref.businessFolderName, disambiguationSuffix);
  const now = new Date();
  if (!ensured.ok) {
    await updateBusinessFileRow(ref, { syncStatus: ensured.status, lastErrorCode: ensured.code, lastErrorMessage: ensured.message, lastSyncAttemptAt: now });
    return { ok: false, status: ensured.status, code: ensured.code, message: ensured.message };
  }

  const updateData = {
    businessFolderName: ensured.finalFolderName,
    dropboxFolderId: ensured.folderId,
    dropboxDisplayPath: ensured.displayPath,
    dropboxPathLower: ensured.displayPath.toLowerCase(),
    syncStatus: "SYNCED" as const,
    lastSyncedAt: now,
    lastSyncAttemptAt: now,
    lastErrorCode: null,
    lastErrorMessage: null,
  };
  await updateBusinessFileRow(ref, updateData);
  return { ok: true, path: ensured.displayPath };
}

async function updateBusinessFileRow(ref: InvoiceBusinessFileRef, data: Record<string, unknown>): Promise<void> {
  if (ref.source === "QUOTATION_CASE") {
    await prisma.quotationDropboxBusinessFile.update({ where: { id: ref.businessFileId }, data }).catch(() => {});
  } else if (ref.source === "POLICY_FALLBACK") {
    await prisma.policyDropboxBusinessFile.update({ where: { id: ref.businessFileId }, data }).catch(() => {});
  } else {
    await prisma.invoiceDropboxBusinessFile.update({ where: { id: ref.businessFileId }, data }).catch(() => {});
  }
}

// Main entry point — post-generation attempt, ADMIN retry, and backfill all
// call this. Never throws; always returns a normalized result and leaves
// the sync row updated to match.
export async function syncInvoiceDocumentToDropbox(invoiceId: string): Promise<InvoiceDocumentSyncResult> {
  const document = (await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      invoiceNumber: true,
      customerId: true,
      generatedFileName: true,
      generatedStoragePath: true,
      customer: { select: { dropboxFolder: true } },
      dropboxSync: true,
    },
  })) as DocumentForSync | null;

  if (!document) {
    return { success: false, status: "ERROR", code: "INVOICE_NOT_FOUND", message: "Invoice not found." };
  }

  if (document.dropboxSync?.syncStatus === "SYNCING" && document.dropboxSync.lastSyncAttemptAt) {
    const age = Date.now() - document.dropboxSync.lastSyncAttemptAt.getTime();
    if (age < STALE_SYNCING_THRESHOLD_MS) {
      return { success: false, status: "SYNCING", message: "A synchronization is already in progress." };
    }
  }

  if (!document.generatedStoragePath || !document.generatedFileName) {
    return { success: false, status: "ERROR", code: "LOCAL_FILE_NOT_FOUND", message: "This Invoice has no generated file yet." };
  }

  let standardizedFileName: string;
  if (document.dropboxSync) {
    standardizedFileName = document.dropboxSync.standardizedFileName;
    await prisma.invoiceDocumentDropboxSync.update({
      where: { invoiceId },
      data: { syncStatus: "SYNCING", lastSyncAttemptAt: new Date() },
    });
  } else {
    standardizedFileName = buildStandardizedInvoiceFilename(document.invoiceNumber, document.generatedFileName);
    try {
      await prisma.invoiceDocumentDropboxSync.create({
        data: { invoiceId, standardizedFileName, originalFileName: document.generatedFileName, syncStatus: "SYNCING", lastSyncAttemptAt: new Date() },
      });
    } catch {
      const existing = await prisma.invoiceDocumentDropboxSync.update({
        where: { invoiceId },
        data: { syncStatus: "SYNCING", lastSyncAttemptAt: new Date() },
      });
      standardizedFileName = existing.standardizedFileName;
    }
  }

  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) {
    return failResult(invoiceId, "ERROR", "DROPBOX_NOT_CONNECTED", auth.message);
  }

  let customerFolderPath = document.customer.dropboxFolder?.displayPath ?? null;
  if (document.customer.dropboxFolder?.syncStatus !== "SYNCED" || !customerFolderPath) {
    const folderSync = await syncCustomerFolder(document.customerId);
    if (!folderSync.success || !folderSync.path) {
      return failResult(invoiceId, "ERROR", "CUSTOMER_FOLDER_NOT_SYNCED", "The customer's Dropbox folder is not synchronized yet.");
    }
    customerFolderPath = folderSync.path;
  }

  const businessFileResult = await ensureInvoiceDropboxBusinessFile(invoiceId);
  if (!businessFileResult.ok) {
    return failResult(invoiceId, "ERROR", "INVOICE_NOT_FOUND", "Invoice not found.");
  }
  const businessFolder = await ensureInvoiceBusinessFolderOnDropbox(auth.client, customerFolderPath, businessFileResult.ref, document.invoiceNumber);
  if (!businessFolder.ok) {
    return failResult(invoiceId, businessFolder.status, businessFolder.code, businessFolder.message);
  }

  // Ensure the "Invoice" subfolder inside the business folder (Phase 6
  // target structure) — never Claim, never renaming the business folder
  // itself. Simple idempotent check-then-create, same convention as the
  // "Policy"/"Quotation" subfolders.
  let invoiceFolderPath: string;
  try {
    invoiceFolderPath = joinDropboxPath(businessFolder.path, INVOICE_SUBFOLDER_NAME);
    assertInsideRoot(invoiceFolderPath, auth.row.rootFolder);
    const existingSubfolder = await tryGetMetadata(auth.client, invoiceFolderPath);
    if (!existingSubfolder) {
      await auth.client.filesCreateFolderV2({ path: invoiceFolderPath, autorename: false });
    } else if (existingSubfolder.tag !== "folder") {
      return failResult(invoiceId, "CONFLICT", "BUSINESS_FOLDER_CONFLICT", "A file exists where the Invoice subfolder should be.");
    }
  } catch (err) {
    if (err instanceof DropboxIntegrationError && err.code === "ROOT_PATH_INVALID") {
      return failResult(invoiceId, "ERROR", "DROPBOX_FILE_OUTSIDE_ROOT", err.message);
    }
    const recheckPath = `${businessFolder.path}/${INVOICE_SUBFOLDER_NAME}`;
    const recheck = await tryGetMetadata(auth.client, recheckPath).catch(() => null);
    if (!recheck) {
      const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
      return failResult(invoiceId, "ERROR", mapped.code, mapped.message);
    }
    invoiceFolderPath = recheckPath;
  }

  const fileExists = await invoiceDocumentStorage.fileExists(document.generatedStoragePath);
  if (!fileExists) {
    return failResult(invoiceId, "ERROR", "LOCAL_FILE_NOT_FOUND", "The locally stored Invoice file could not be found.");
  }
  const metadata = await invoiceDocumentStorage.getMetadata(document.generatedStoragePath);
  if (!metadata || metadata.size <= 0) {
    return failResult(invoiceId, "ERROR", "LOCAL_FILE_NOT_FOUND", "The locally stored Invoice file is empty.");
  }
  if (metadata.size > DROPBOX_SIMPLE_UPLOAD_MAX_BYTES) {
    return failResult(invoiceId, "ERROR", "FILE_TOO_LARGE", "File exceeds the Dropbox upload size limit.");
  }

  let targetPath: string;
  try {
    targetPath = joinDropboxPath(invoiceFolderPath, standardizedFileName);
    assertInsideRoot(targetPath, auth.row.rootFolder);
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return failResult(invoiceId, "ERROR", "DROPBOX_FILE_OUTSIDE_ROOT", mapped.message);
  }

  try {
    const stream = await invoiceDocumentStorage.openFile(document.generatedStoragePath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const buffer = Buffer.concat(chunks);

    const existing = await tryGetMetadata(auth.client, targetPath);
    let uploadMode: { ".tag": "add" } | { ".tag": "update"; update: string } = { ".tag": "add" };
    if (existing) {
      if (existing.tag !== "file") {
        return failResult(invoiceId, "CONFLICT", "DROPBOX_FILE_IS_FOLDER", "A folder already exists at the required Invoice file path.");
      }
      const linkedToUs = document.dropboxSync?.dropboxFileId && existing.id === document.dropboxSync.dropboxFileId;
      if (!linkedToUs) {
        return failResult(invoiceId, "CONFLICT", "INVOICE_DOCUMENT_CONFLICT", "A different, unrelated file already exists at this Invoice's Dropbox path.");
      }
      // Safe conditional overwrite: only succeeds if the rev we just read
      // is still current, so a concurrent external edit is never clobbered,
      // and re-syncing identical content is never destructive.
      uploadMode = existing.rev ? { ".tag": "update", update: existing.rev } : { ".tag": "add" };
    }

    const uploaded = await auth.client.filesUpload({ path: targetPath, mode: uploadMode, autorename: false, contents: buffer });
    const result = uploaded.result;

    await prisma.invoiceDocumentDropboxSync.update({
      where: { invoiceId },
      data: {
        businessFileId: businessFileResult.ref.businessFileId,
        businessFileSource: businessFileResult.ref.source,
        standardizedFileName,
        dropboxFileId: result.id,
        dropboxRevision: result.rev,
        dropboxDisplayPath: result.path_display ?? targetPath,
        dropboxPathLower: result.path_lower ?? targetPath.toLowerCase(),
        dropboxContentHash: result.content_hash ?? null,
        dropboxSize: BigInt(result.size),
        syncStatus: "SYNCED",
        lastSyncedAt: new Date(),
        lastSyncAttemptAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    return { success: true, status: "SYNCED" };
  } catch (err) {
    if (err instanceof DropboxIntegrationError) {
      return failResult(invoiceId, classifyStatus(err.code), err.code, err.message);
    }
    const mapped = mapDropboxError(err);
    return failResult(invoiceId, classifyStatus(mapped.code), mapped.code, mapped.message);
  }
}

// Bounded, non-blocking wrapper — the generation flow calls this AFTER the
// local file has already been durably saved and the DB transaction has
// already committed, and never lets a slow/hanging Dropbox call delay the
// response to the user (Part 5, requirement 1).
export async function syncInvoiceDocumentWithTimeout(invoiceId: string): Promise<string> {
  try {
    const result = await Promise.race([
      syncInvoiceDocumentToDropbox(invoiceId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), DROPBOX_SYNC_TIMEOUT_MS)),
    ]);
    return result?.status ?? "PENDING";
  } catch {
    return "ERROR";
  }
}

// --- Read-only verification -----------------------------------------------

export async function verifyInvoiceBusinessFolder(invoiceId: string): Promise<InvoiceDocumentSyncResult> {
  const ref = await resolveInvoiceBusinessFileRefReadOnly(invoiceId);
  if (!ref || !ref.dropboxFolderId) {
    return { success: false, status: "PENDING", message: "The business folder has not been synchronized yet." };
  }
  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) return { success: false, status: "ERROR", code: "DROPBOX_NOT_CONNECTED", message: auth.message };

  try {
    const metadata = await auth.client.filesGetMetadata({ path: ref.dropboxFolderId });
    if (metadata.result[".tag"] !== "folder") {
      return { success: false, status: "ERROR", code: "BUSINESS_FOLDER_CONFLICT", message: "The linked Dropbox object is not a folder." };
    }
    const resolvedPath = metadata.result.path_display ?? ref.dropboxDisplayPath ?? "";
    assertInsideRoot(resolvedPath, auth.row.rootFolder);

    const data = {
      dropboxDisplayPath: resolvedPath,
      dropboxPathLower: resolvedPath.toLowerCase(),
      syncStatus: "SYNCED" as const,
      lastSyncedAt: new Date(),
      lastSyncAttemptAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    };
    await updateBusinessFileRow(ref, data);
    return { success: true, status: "SYNCED" };
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return { success: false, status: mapped.code === "BUSINESS_FOLDER_CONFLICT" ? "CONFLICT" : "ERROR", code: mapped.code, message: mapped.message };
  }
}

export async function verifyInvoiceDocumentSync(invoiceId: string): Promise<InvoiceDocumentSyncResult> {
  const document = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, invoiceNumber: true, dropboxSync: true },
  });
  if (!document) return { success: false, status: "ERROR", code: "INVOICE_NOT_FOUND", message: "Invoice not found." };

  const syncRow = document.dropboxSync;
  if (!syncRow || !syncRow.dropboxFileId) {
    return { success: false, status: "PENDING", message: "This Invoice has not been synchronized yet." };
  }

  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) return { success: false, status: "ERROR", code: "DROPBOX_NOT_CONNECTED", message: auth.message };

  try {
    const metadata = await auth.client.filesGetMetadata({ path: syncRow.dropboxFileId });
    if (metadata.result[".tag"] !== "file") {
      return failResult(invoiceId, "ERROR", "DROPBOX_FILE_IS_FOLDER", "The linked Dropbox object is a folder, not a file.");
    }
    const fileMeta = metadata.result;
    const resolvedPath = fileMeta.path_display ?? syncRow.dropboxDisplayPath ?? "";
    assertInsideRoot(resolvedPath, auth.row.rootFolder);

    if (!isPlausibleStandardizedInvoiceFilename(fileMeta.name, document.invoiceNumber)) {
      return failResult(invoiceId, "CONFLICT", "INVOICE_DOCUMENT_CONFLICT", "The linked Dropbox filename no longer matches the expected standardized name.");
    }
    if (syncRow.dropboxSize !== null && BigInt(fileMeta.size) !== syncRow.dropboxSize) {
      return failResult(invoiceId, "CONFLICT", "INVOICE_DOCUMENT_CONFLICT", "The Dropbox file size no longer matches the last synchronized upload.");
    }
    if (syncRow.dropboxContentHash && fileMeta.content_hash && fileMeta.content_hash !== syncRow.dropboxContentHash) {
      return failResult(invoiceId, "CONFLICT", "INVOICE_DOCUMENT_CONFLICT", "The Dropbox file content no longer matches the last synchronized upload.");
    }

    await prisma.invoiceDocumentDropboxSync.update({
      where: { invoiceId },
      data: {
        dropboxRevision: fileMeta.rev,
        dropboxDisplayPath: resolvedPath,
        dropboxPathLower: fileMeta.path_lower ?? resolvedPath.toLowerCase(),
        syncStatus: "SYNCED",
        lastSyncedAt: new Date(),
        lastSyncAttemptAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    return { success: true, status: "SYNCED" };
  } catch (err) {
    if (isNotFoundError(err)) {
      return failResult(invoiceId, "ERROR", "DROPBOX_FILE_NOT_FOUND", "The linked Dropbox file could not be found. Re-upload to restore it.");
    }
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return failResult(invoiceId, classifyStatus(mapped.code), mapped.code, mapped.message);
  }
}

// --- Backfill --------------------------------------------------------------

export type InvoiceDocumentBackfillPreview = {
  totalInvoices: number;
  synced: number;
  pending: number;
  failed: number;
  conflicts: number;
  missingLocalFiles: number;
  linkedToQuotationBusinessFile: number;
  usingPolicyFallbackBusinessFile: number;
  usingInvoiceFallbackBusinessFile: number;
};

// Pure DB reads only — never touches Dropbox or the filesystem.
export async function previewInvoiceDocumentBackfill(): Promise<InvoiceDocumentBackfillPreview> {
  const [totalInvoices, statusCounts, missingLocalFiles, linkedToQuotationBusinessFile, usingPolicyFallbackBusinessFile, usingInvoiceFallbackBusinessFile] =
    await Promise.all([
      prisma.invoice.count(),
      prisma.invoiceDocumentDropboxSync.groupBy({ by: ["syncStatus"], _count: { _all: true } }),
      prisma.invoice.count({ where: { OR: [{ generatedStoragePath: null }, { generatedFileName: null }] } }),
      prisma.invoiceDocumentDropboxSync.count({ where: { businessFileSource: "QUOTATION_CASE" } }),
      prisma.invoiceDocumentDropboxSync.count({ where: { businessFileSource: "POLICY_FALLBACK" } }),
      prisma.invoiceDocumentDropboxSync.count({ where: { businessFileSource: "INVOICE_FALLBACK" } }),
    ]);

  const byStatus: Record<string, number> = {};
  for (const row of statusCounts) byStatus[row.syncStatus] = row._count._all;
  const rowCount = Object.values(byStatus).reduce((sum, n) => sum + n, 0);

  return {
    totalInvoices,
    synced: byStatus.SYNCED ?? 0,
    pending: (byStatus.PENDING ?? 0) + (byStatus.SYNCING ?? 0) + Math.max(0, totalInvoices - rowCount),
    failed: byStatus.ERROR ?? 0,
    conflicts: byStatus.CONFLICT ?? 0,
    missingLocalFiles,
    linkedToQuotationBusinessFile,
    usingPolicyFallbackBusinessFile,
    usingInvoiceFallbackBusinessFile,
  };
}

export type InvoiceDocumentBackfillMode = "init-missing" | "sync-missing" | "retry-failed" | "verify-synced";
export type InvoiceDocumentBackfillBatchResult = {
  processed: number;
  succeeded: number;
  failed: number;
  results: { invoiceId: string; success: boolean; status: string; code?: DropboxErrorCode }[];
};

const DEFAULT_BATCH_SIZE = 15;
const MAX_BATCH_SIZE = 20;
const MIN_BATCH_SIZE = 1;

// Processes up to `limit` invoices SEQUENTIALLY (never Promise.all) — safe
// to call again for the next batch since it always re-queries whichever
// invoices still match the mode's criteria (naturally resumable).
export async function runInvoiceDocumentBackfillBatch(
  mode: InvoiceDocumentBackfillMode,
  limit: number = DEFAULT_BATCH_SIZE
): Promise<InvoiceDocumentBackfillBatchResult> {
  const boundedLimit = Math.max(MIN_BATCH_SIZE, Math.min(limit, MAX_BATCH_SIZE));
  const candidates = await selectBackfillCandidates(mode, boundedLimit);

  const results: InvoiceDocumentBackfillBatchResult["results"] = [];
  for (const invoiceId of candidates) {
    const outcome = mode === "verify-synced" ? await verifyInvoiceDocumentSync(invoiceId) : await syncInvoiceDocumentToDropbox(invoiceId);
    results.push({ invoiceId, success: outcome.success, status: outcome.status, code: outcome.code });
  }

  return {
    processed: results.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

async function selectBackfillCandidates(mode: InvoiceDocumentBackfillMode, limit: number): Promise<string[]> {
  // Never a candidate for init/sync unless a local file actually exists yet
  // — an Invoice mid-creation (the narrow transactional window before the
  // file save completes) must never be picked up by a concurrent backfill.
  const hasLocalFile = { generatedStoragePath: { not: null }, generatedFileName: { not: null } };
  let rows: { id: string }[];
  if (mode === "init-missing" || mode === "sync-missing") {
    rows = await prisma.invoice.findMany({
      where: { ...hasLocalFile, OR: [{ dropboxSync: null }, { dropboxSync: { syncStatus: { in: ["PENDING", "SYNCING"] } } }] },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  } else if (mode === "retry-failed") {
    rows = await prisma.invoice.findMany({
      where: { ...hasLocalFile, dropboxSync: { syncStatus: { in: ["ERROR", "CONFLICT"] } } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  } else {
    rows = await prisma.invoice.findMany({
      where: { dropboxSync: { syncStatus: "SYNCED" } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }
  return rows.map((r) => r.id);
}
