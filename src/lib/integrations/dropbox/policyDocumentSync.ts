// Server-only. Dropbox Integration Phase 5 — synchronizes one Policy
// document's already-locally-stored file into the Dropbox business-file
// structure under "<Business Folder>/Policy/<standardized name>". Mirrors
// customerDocumentSync.ts's exact shape (local storage stays authoritative
// and immediate; nothing here ever blocks or reverses a local upload).
import type { Dropbox } from "dropbox";
import { prisma } from "@/lib/prisma";
import { policyDocumentStorage } from "@/lib/policyDocuments/storage";
import { getAuthenticatedDropboxClient } from "./service";
import { syncCustomerFolder } from "./customer-folders";
import { ensureBusinessFolder } from "./quotationDropboxSync";
import { ensurePolicyDropboxBusinessFile, resolvePolicyBusinessFileRefReadOnly, type PolicyBusinessFileRef } from "./policyBusinessFile";
import { joinDropboxPath, assertInsideRoot } from "./paths";
import { DropboxIntegrationError, mapDropboxError, type DropboxErrorCode } from "./errors";
import { buildStandardizedPolicyDocumentFilename, isPlausibleStandardizedPolicyFilename } from "./policyDocumentFilenames";
import type { PolicyDocumentType } from "@/generated/prisma/enums";
import { withRateLimitBackoff, INTERACTIVE_BACKOFF } from "./rateLimitRetry";

const STALE_SYNCING_THRESHOLD_MS = 2 * 60 * 1000;
export const POLICY_SUBFOLDER_NAME = "Policy";
const DROPBOX_SIMPLE_UPLOAD_MAX_BYTES = 150 * 1024 * 1024;
const DROPBOX_SYNC_TIMEOUT_MS = 15_000;

export type PolicyDocumentSyncOutcomeStatus = "PENDING" | "SYNCING" | "SYNCED" | "ERROR" | "CONFLICT";
export type PolicyDocumentSyncResult = {
  success: boolean;
  status: PolicyDocumentSyncOutcomeStatus;
  code?: DropboxErrorCode;
  message?: string;
};

type DocumentForSync = {
  id: string;
  policyRecordId: string;
  documentType: PolicyDocumentType;
  originalFileName: string;
  storagePath: string;
  policyRecord: {
    id: string;
    recordNumber: string;
    customerId: string;
    customer: { dropboxFolder: { syncStatus: string; dropboxFolderId: string | null; displayPath: string | null } | null };
  };
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
    // Phase 8 Part 8: bounded backoff on Dropbox rate-limit (429) responses.
    const metadata = await withRateLimitBackoff(() => client.filesGetMetadata({ path }));
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
  return code === "POLICY_DOCUMENT_CONFLICT" || code === "DROPBOX_FILE_IS_FOLDER" || code === "BUSINESS_FOLDER_CONFLICT" ? "CONFLICT" : "ERROR";
}

async function failResult(
  policyDocumentId: string,
  status: PolicyDocumentSyncOutcomeStatus,
  code: DropboxErrorCode,
  message: string
): Promise<PolicyDocumentSyncResult> {
  await prisma.policyDocumentDropboxSync
    .update({ where: { policyDocumentId }, data: { syncStatus: status, lastErrorCode: code, lastErrorMessage: message, lastSyncAttemptAt: new Date() } })
    .catch(() => {});
  return { success: false, status, code, message };
}

// Names already claimed by this SAME Policy's other documents in its one
// "Policy" folder — excludes the document's own row (when it already has
// one) so a retry reproduces its own existing name rather than a new
// versioned one (mirrors customerDocumentSync.ts's
// loadSiblingStandardizedNamesLower). Exported so the upload action
// (documentActions.ts) can compute the real standardized name up front,
// before the new PolicyDocument/PolicyDocumentDropboxSync rows exist, to
// create both in one transaction (Part 7, requirement 3) without ever
// persisting a placeholder name.
export async function loadSiblingStandardizedNamesLower(policyRecordId: string, excludeDocumentId?: string): Promise<Set<string>> {
  const rows = await prisma.policyDocumentDropboxSync.findMany({
    where: {
      syncStatus: { in: ["SYNCED", "SYNCING"] },
      ...(excludeDocumentId ? { policyDocumentId: { not: excludeDocumentId } } : {}),
      policyDocument: { policyRecordId },
    },
    select: { standardizedFileName: true },
  });
  return new Set(rows.map((r) => r.standardizedFileName.toLowerCase()));
}

// Ensures (creates if missing, otherwise verifies still current) the actual
// Dropbox folder for a resolved business file ref, updating whichever table
// (QuotationDropboxBusinessFile or PolicyDropboxBusinessFile) it came from.
// Never creates a duplicate: reuses the ref's own dropboxDisplayPath when
// already SYNCED.
async function ensureBusinessFolderOnDropbox(
  client: Dropbox,
  customerFolderPath: string,
  ref: PolicyBusinessFileRef,
  disambiguationSuffix: string
): Promise<{ ok: true; path: string } | { ok: false; status: "ERROR" | "CONFLICT"; code: DropboxErrorCode; message: string }> {
  if (ref.syncStatus === "SYNCED" && ref.dropboxDisplayPath) {
    return { ok: true, path: ref.dropboxDisplayPath };
  }

  const ensured = await ensureBusinessFolder(client, customerFolderPath, ref.businessFolderName, disambiguationSuffix);
  const now = new Date();
  if (!ensured.ok) {
    if (ref.source === "QUOTATION_CASE") {
      await prisma.quotationDropboxBusinessFile
        .update({ where: { id: ref.businessFileId }, data: { syncStatus: ensured.status, lastErrorCode: ensured.code, lastErrorMessage: ensured.message, lastSyncAttemptAt: now } })
        .catch(() => {});
    } else {
      await prisma.policyDropboxBusinessFile
        .update({ where: { id: ref.businessFileId }, data: { syncStatus: ensured.status, lastErrorCode: ensured.code, lastErrorMessage: ensured.message, lastSyncAttemptAt: now } })
        .catch(() => {});
    }
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
  if (ref.source === "QUOTATION_CASE") {
    await prisma.quotationDropboxBusinessFile.update({ where: { id: ref.businessFileId }, data: updateData });
  } else {
    await prisma.policyDropboxBusinessFile.update({ where: { id: ref.businessFileId }, data: updateData });
  }
  return { ok: true, path: ensured.displayPath };
}

// Main entry point — post-upload attempt, ADMIN retry, ADMIN re-upload, and
// backfill all call this. Never throws; always returns a normalized result
// and leaves the sync row updated to match (Part 7/11).
export async function syncPolicyDocumentToDropbox(policyDocumentId: string): Promise<PolicyDocumentSyncResult> {
  const document = (await prisma.policyDocument.findUnique({
    where: { id: policyDocumentId },
    include: {
      policyRecord: { select: { id: true, recordNumber: true, customerId: true, customer: { include: { dropboxFolder: true } } } },
      dropboxSync: true,
    },
  })) as DocumentForSync | null;

  if (!document) {
    return { success: false, status: "ERROR", code: "POLICY_DOCUMENT_NOT_FOUND", message: "Document not found." };
  }

  if (document.dropboxSync?.syncStatus === "SYNCING" && document.dropboxSync.lastSyncAttemptAt) {
    const age = Date.now() - document.dropboxSync.lastSyncAttemptAt.getTime();
    if (age < STALE_SYNCING_THRESHOLD_MS) {
      return { success: false, status: "SYNCING", message: "A synchronization is already in progress." };
    }
  }

  let standardizedFileName: string;
  if (document.dropboxSync) {
    standardizedFileName = document.dropboxSync.standardizedFileName;
    await prisma.policyDocumentDropboxSync.update({
      where: { policyDocumentId },
      data: { syncStatus: "SYNCING", lastSyncAttemptAt: new Date() },
    });
  } else {
    const existingNamesLower = await loadSiblingStandardizedNamesLower(document.policyRecordId, document.id);
    standardizedFileName = buildStandardizedPolicyDocumentFilename({
      documentType: document.documentType,
      originalFileName: document.originalFileName,
      existingStandardizedNamesLower: existingNamesLower,
    });
    try {
      await prisma.policyDocumentDropboxSync.create({
        data: { policyDocumentId, standardizedFileName, originalFileName: document.originalFileName, syncStatus: "SYNCING", lastSyncAttemptAt: new Date() },
      });
    } catch {
      const existing = await prisma.policyDocumentDropboxSync.update({
        where: { policyDocumentId },
        data: { syncStatus: "SYNCING", lastSyncAttemptAt: new Date() },
      });
      standardizedFileName = existing.standardizedFileName;
    }
  }

  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) {
    return failResult(policyDocumentId, "ERROR", "DROPBOX_NOT_CONNECTED", auth.message);
  }

  let customerFolderPath = document.policyRecord.customer.dropboxFolder?.displayPath ?? null;
  if (document.policyRecord.customer.dropboxFolder?.syncStatus !== "SYNCED" || !customerFolderPath) {
    const folderSync = await syncCustomerFolder(document.policyRecord.customerId);
    if (!folderSync.success || !folderSync.path) {
      return failResult(policyDocumentId, "ERROR", "CUSTOMER_FOLDER_NOT_SYNCED", "The customer's Dropbox folder is not synchronized yet.");
    }
    customerFolderPath = folderSync.path;
  }

  const businessFileResult = await ensurePolicyDropboxBusinessFile(document.policyRecordId);
  if (!businessFileResult.ok) {
    return failResult(policyDocumentId, "ERROR", "POLICY_NOT_FOUND", "Policy record not found.");
  }
  const businessFolder = await ensureBusinessFolderOnDropbox(auth.client, customerFolderPath, businessFileResult.ref, document.policyRecord.recordNumber);
  if (!businessFolder.ok) {
    return failResult(policyDocumentId, businessFolder.status, businessFolder.code, businessFolder.message);
  }

  // Ensure the "Policy" subfolder inside the business folder (Part 6) —
  // never Invoice/Claim, never an insurance-type folder elsewhere. Simple
  // idempotent check-then-create, same convention as the Quotation
  // subfolder in quotationDropboxSync.ts.
  let policyFolderPath: string;
  try {
    policyFolderPath = joinDropboxPath(businessFolder.path, POLICY_SUBFOLDER_NAME);
    assertInsideRoot(policyFolderPath, auth.row.rootFolder);
    const existingSubfolder = await tryGetMetadata(auth.client, policyFolderPath);
    if (!existingSubfolder) {
      await withRateLimitBackoff(() => auth.client.filesCreateFolderV2({ path: policyFolderPath, autorename: false }));
    } else if (existingSubfolder.tag !== "folder") {
      return failResult(policyDocumentId, "CONFLICT", "BUSINESS_FOLDER_CONFLICT", "A file exists where the Policy subfolder should be.");
    }
  } catch (err) {
    if (err instanceof DropboxIntegrationError && err.code === "ROOT_PATH_INVALID") {
      return failResult(policyDocumentId, "ERROR", "DROPBOX_FILE_OUTSIDE_ROOT", err.message);
    }
    const recheckPath = `${businessFolder.path}/${POLICY_SUBFOLDER_NAME}`;
    const recheck = await tryGetMetadata(auth.client, recheckPath).catch(() => null);
    if (!recheck) {
      const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
      return failResult(policyDocumentId, "ERROR", mapped.code, mapped.message);
    }
    policyFolderPath = recheckPath;
  }

  const fileExists = await policyDocumentStorage.fileExists(document.storagePath);
  if (!fileExists) {
    return failResult(policyDocumentId, "ERROR", "LOCAL_FILE_NOT_FOUND", "The locally stored Policy document could not be found.");
  }
  const metadata = await policyDocumentStorage.getMetadata(document.storagePath);
  if (!metadata || metadata.size <= 0) {
    return failResult(policyDocumentId, "ERROR", "LOCAL_FILE_NOT_FOUND", "The locally stored Policy document is empty.");
  }
  if (metadata.size > DROPBOX_SIMPLE_UPLOAD_MAX_BYTES) {
    return failResult(policyDocumentId, "ERROR", "FILE_TOO_LARGE", "File exceeds the Dropbox upload size limit.");
  }

  let targetPath: string;
  try {
    targetPath = joinDropboxPath(policyFolderPath, standardizedFileName);
    assertInsideRoot(targetPath, auth.row.rootFolder);
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return failResult(policyDocumentId, "ERROR", "DROPBOX_FILE_OUTSIDE_ROOT", mapped.message);
  }

  try {
    const stream = await policyDocumentStorage.openFile(document.storagePath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const buffer = Buffer.concat(chunks);

    const existing = await tryGetMetadata(auth.client, targetPath);
    let uploadMode: { ".tag": "add" } | { ".tag": "update"; update: string } = { ".tag": "add" };
    if (existing) {
      if (existing.tag !== "file") {
        return failResult(policyDocumentId, "CONFLICT", "DROPBOX_FILE_IS_FOLDER", "A folder already exists at the required Policy document path.");
      }
      const linkedToUs = document.dropboxSync?.dropboxFileId && existing.id === document.dropboxSync.dropboxFileId;
      if (!linkedToUs) {
        return failResult(policyDocumentId, "CONFLICT", "POLICY_DOCUMENT_CONFLICT", "A different, unrelated file already exists at this document's Dropbox path.");
      }
      // Safe conditional overwrite: only succeeds if the rev we just read
      // is still current, so a concurrent external edit is never clobbered.
      uploadMode = existing.rev ? { ".tag": "update", update: existing.rev } : { ".tag": "add" };
    }

    const uploaded = await withRateLimitBackoff(() => auth.client.filesUpload({ path: targetPath, mode: uploadMode, autorename: false, contents: buffer }));
    const result = uploaded.result;

    await prisma.policyDocumentDropboxSync.update({
      where: { policyDocumentId },
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
      return failResult(policyDocumentId, classifyStatus(err.code), err.code, err.message);
    }
    const mapped = mapDropboxError(err);
    return failResult(policyDocumentId, classifyStatus(mapped.code), mapped.code, mapped.message);
  }
}

// Bounded, non-blocking wrapper — the upload flow (Part 7) calls this
// AFTER the local DB transaction has already committed, and never lets a
// slow/hanging Dropbox call delay the response to the user.
export async function syncPolicyDocumentWithTimeout(policyDocumentId: string): Promise<string> {
  try {
    const result = await Promise.race([
      syncPolicyDocumentToDropbox(policyDocumentId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), DROPBOX_SYNC_TIMEOUT_MS)),
    ]);
    return result?.status ?? "PENDING";
  } catch {
    return "ERROR";
  }
}

// --- Read-only verification (Part 11) -----------------------------------

export async function verifyPolicyBusinessFolder(policyRecordId: string): Promise<PolicyDocumentSyncResult> {
  const ref = await resolvePolicyBusinessFileRefReadOnly(policyRecordId);
  if (!ref || !ref.dropboxFolderId) {
    return { success: false, status: "PENDING", message: "The business folder has not been synchronized yet." };
  }
  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) return { success: false, status: "ERROR", code: "DROPBOX_NOT_CONNECTED", message: auth.message };

  try {
    // Read-only single-record check (Part 11 convention) — bounded tightly
    // so an admin's Verify click never hangs.
    const metadata = await withRateLimitBackoff(() => auth.client.filesGetMetadata({ path: ref.dropboxFolderId! }), INTERACTIVE_BACKOFF);
    if (metadata.result[".tag"] !== "folder") {
      return { success: false, status: "ERROR", code: "BUSINESS_FOLDER_CONFLICT", message: "The linked Dropbox object is not a folder." };
    }
    const resolvedPath = metadata.result.path_display ?? ref.dropboxDisplayPath ?? "";
    assertInsideRoot(resolvedPath, auth.row.rootFolder);

    const data = { dropboxDisplayPath: resolvedPath, dropboxPathLower: resolvedPath.toLowerCase(), syncStatus: "SYNCED" as const, lastSyncedAt: new Date(), lastSyncAttemptAt: new Date(), lastErrorCode: null, lastErrorMessage: null };
    if (ref.source === "QUOTATION_CASE") {
      await prisma.quotationDropboxBusinessFile.update({ where: { id: ref.businessFileId }, data });
    } else {
      await prisma.policyDropboxBusinessFile.update({ where: { id: ref.businessFileId }, data });
    }
    return { success: true, status: "SYNCED" };
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return { success: false, status: mapped.code === "BUSINESS_FOLDER_CONFLICT" ? "CONFLICT" : "ERROR", code: mapped.code, message: mapped.message };
  }
}

export async function verifyPolicyDocumentSync(policyDocumentId: string): Promise<PolicyDocumentSyncResult> {
  const document = (await prisma.policyDocument.findUnique({
    where: { id: policyDocumentId },
    include: { dropboxSync: true },
  })) as { id: string; documentType: PolicyDocumentType; originalFileName: string; dropboxSync: DocumentForSync["dropboxSync"] } | null;
  if (!document) return { success: false, status: "ERROR", code: "POLICY_DOCUMENT_NOT_FOUND", message: "Document not found." };

  const syncRow = document.dropboxSync;
  if (!syncRow || !syncRow.dropboxFileId) {
    return { success: false, status: "PENDING", message: "This document has not been synchronized yet." };
  }

  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) return { success: false, status: "ERROR", code: "DROPBOX_NOT_CONNECTED", message: auth.message };

  try {
    // Read-only single-record check (Part 11 convention) — bounded tightly
    // so an admin's Verify click never hangs.
    const metadata = await withRateLimitBackoff(() => auth.client.filesGetMetadata({ path: syncRow.dropboxFileId! }), INTERACTIVE_BACKOFF);
    if (metadata.result[".tag"] !== "file") {
      return failResult(policyDocumentId, "ERROR", "DROPBOX_FILE_IS_FOLDER", "The linked Dropbox object is a folder, not a file.");
    }
    const fileMeta = metadata.result;
    const resolvedPath = fileMeta.path_display ?? syncRow.dropboxDisplayPath ?? "";
    assertInsideRoot(resolvedPath, auth.row.rootFolder);

    if (!isPlausibleStandardizedPolicyFilename(fileMeta.name, document.documentType, document.originalFileName)) {
      return failResult(policyDocumentId, "CONFLICT", "POLICY_DOCUMENT_CONFLICT", "The linked Dropbox filename no longer matches the expected standardized name.");
    }
    if (syncRow.dropboxSize !== null && BigInt(fileMeta.size) !== syncRow.dropboxSize) {
      return failResult(policyDocumentId, "CONFLICT", "POLICY_DOCUMENT_CONFLICT", "The Dropbox file size no longer matches the last synchronized upload.");
    }
    if (syncRow.dropboxContentHash && fileMeta.content_hash && fileMeta.content_hash !== syncRow.dropboxContentHash) {
      return failResult(policyDocumentId, "CONFLICT", "POLICY_DOCUMENT_CONFLICT", "The Dropbox file content no longer matches the last synchronized upload.");
    }

    await prisma.policyDocumentDropboxSync.update({
      where: { policyDocumentId },
      data: { dropboxRevision: fileMeta.rev, dropboxDisplayPath: resolvedPath, dropboxPathLower: fileMeta.path_lower ?? resolvedPath.toLowerCase(), syncStatus: "SYNCED", lastSyncedAt: new Date(), lastSyncAttemptAt: new Date(), lastErrorCode: null, lastErrorMessage: null },
    });
    return { success: true, status: "SYNCED" };
  } catch (err) {
    if (isNotFoundError(err)) {
      return failResult(policyDocumentId, "ERROR", "DROPBOX_FILE_NOT_FOUND", "The linked Dropbox file could not be found. Re-upload to restore it.");
    }
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return failResult(policyDocumentId, classifyStatus(mapped.code), mapped.code, mapped.message);
  }
}

// --- Backfill (Part 12) --------------------------------------------------

export type PolicyDocumentBackfillPreview = {
  totalDocuments: number;
  synced: number;
  pending: number;
  failed: number;
  conflicts: number;
  missingLocalFiles: number;
  linkedToQuotationBusinessFile: number;
  usingPolicyFallbackBusinessFile: number;
};

// Pure DB reads only — never touches Dropbox or the filesystem.
export async function previewPolicyDocumentBackfill(): Promise<PolicyDocumentBackfillPreview> {
  const [totalDocuments, statusCounts, linkedToQuotationBusinessFile, usingPolicyFallbackBusinessFile] = await Promise.all([
    prisma.policyDocument.count(),
    prisma.policyDocumentDropboxSync.groupBy({ by: ["syncStatus"], _count: { _all: true } }),
    prisma.policyDocumentDropboxSync.count({ where: { businessFileSource: "QUOTATION_CASE" } }),
    prisma.policyDocumentDropboxSync.count({ where: { businessFileSource: "POLICY_FALLBACK" } }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of statusCounts) byStatus[row.syncStatus] = row._count._all;
  const rowCount = Object.values(byStatus).reduce((sum, n) => sum + n, 0);

  return {
    totalDocuments,
    synced: byStatus.SYNCED ?? 0,
    pending: (byStatus.PENDING ?? 0) + (byStatus.SYNCING ?? 0) + Math.max(0, totalDocuments - rowCount),
    failed: byStatus.ERROR ?? 0,
    conflicts: byStatus.CONFLICT ?? 0,
    missingLocalFiles: 0,
    linkedToQuotationBusinessFile,
    usingPolicyFallbackBusinessFile,
  };
}

export type PolicyDocumentBackfillMode = "init-missing" | "sync-missing" | "retry-failed" | "verify-synced";
export type PolicyDocumentBackfillBatchResult = {
  processed: number;
  succeeded: number;
  failed: number;
  results: { policyDocumentId: string; success: boolean; status: string; code?: DropboxErrorCode }[];
};

const DEFAULT_BATCH_SIZE = 15;
const MAX_BATCH_SIZE = 20;
const MIN_BATCH_SIZE = 1;

// Processes up to `limit` documents SEQUENTIALLY (never Promise.all) — safe
// to call again for the next batch since it always re-queries whichever
// documents still match the mode's criteria (naturally resumable).
export async function runPolicyDocumentBackfillBatch(
  mode: PolicyDocumentBackfillMode,
  limit: number = DEFAULT_BATCH_SIZE
): Promise<PolicyDocumentBackfillBatchResult> {
  const boundedLimit = Math.max(MIN_BATCH_SIZE, Math.min(limit, MAX_BATCH_SIZE));
  const candidates = await selectBackfillCandidates(mode, boundedLimit);

  const results: PolicyDocumentBackfillBatchResult["results"] = [];
  for (const documentId of candidates) {
    const outcome = mode === "verify-synced" ? await verifyPolicyDocumentSync(documentId) : await syncPolicyDocumentToDropbox(documentId);
    results.push({ policyDocumentId: documentId, success: outcome.success, status: outcome.status, code: outcome.code });
  }

  return {
    processed: results.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

async function selectBackfillCandidates(mode: PolicyDocumentBackfillMode, limit: number): Promise<string[]> {
  let rows: { id: string }[];
  if (mode === "init-missing" || mode === "sync-missing") {
    rows = await prisma.policyDocument.findMany({
      where: { OR: [{ dropboxSync: null }, { dropboxSync: { syncStatus: { in: ["PENDING", "SYNCING"] } } }] },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  } else if (mode === "retry-failed") {
    rows = await prisma.policyDocument.findMany({
      where: { dropboxSync: { syncStatus: { in: ["ERROR", "CONFLICT"] } } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  } else {
    rows = await prisma.policyDocument.findMany({
      where: { dropboxSync: { syncStatus: "SYNCED" } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }
  return rows.map((r) => r.id);
}
