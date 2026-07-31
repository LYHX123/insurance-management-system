// Server-only. Dropbox Integration Phase 7 — synchronizes a Motor Claim
// document into the Dropbox business-file structure under
// "<Business Folder>/Claim/<Claim Reference>/<standardized name>". Mirrors
// policyDocumentSync.ts's exact shape (local storage stays authoritative
// and immediate; nothing here ever blocks or reverses a local upload) —
// Claim documents are many-per-parent like Policy documents, not
// one-per-parent like Invoice, so sibling-name disambiguation applies. One
// extra nesting level versus Policy ("Claim" then "<Claim Reference>", not
// just "Policy") since multiple Claims can share the same business folder
// (Part 4) — the claim-reference folder name is computed once (from
// whichever sibling document synced first) and reused by every later
// document of the same Claim, so it stays immutable even if the Claim's
// own numberPlate/claimNumber fields are edited afterward.
import type { Dropbox } from "dropbox";
import { prisma } from "@/lib/prisma";
import { motorClaimDocumentStorage } from "@/lib/claimDocuments/storage";
import { getAuthenticatedDropboxClient } from "./service";
import { syncCustomerFolder } from "./customer-folders";
import { ensureBusinessFolder } from "./quotationDropboxSync";
import { ensureMotorClaimDropboxBusinessFile, resolveMotorClaimBusinessFileRefReadOnly, type ClaimBusinessFileRef } from "./motorClaimBusinessFile";
import { joinDropboxPath, assertInsideRoot } from "./paths";
import { DropboxIntegrationError, mapDropboxError, type DropboxErrorCode } from "./errors";
import { buildStandardizedMotorClaimDocumentFilename } from "./claimDocumentFilenames";
import { sanitizeBusinessTitle, toFilenameSegment } from "./quotationDropboxNaming";
import type { MotorClaimDocumentType } from "@/generated/prisma/enums";
import { withRateLimitBackoff, INTERACTIVE_BACKOFF } from "./rateLimitRetry";

const STALE_SYNCING_THRESHOLD_MS = 2 * 60 * 1000;
export const CLAIM_SUBFOLDER_NAME = "Claim";
const DROPBOX_SIMPLE_UPLOAD_MAX_BYTES = 150 * 1024 * 1024;
const DROPBOX_SYNC_TIMEOUT_MS = 15_000;

export type ClaimDocumentSyncOutcomeStatus = "PENDING" | "SYNCING" | "SYNCED" | "ERROR" | "CONFLICT";
export type ClaimDocumentSyncResult = {
  success: boolean;
  status: ClaimDocumentSyncOutcomeStatus;
  code?: DropboxErrorCode;
  message?: string;
};

type DocumentForSync = {
  id: string;
  motorClaimId: string;
  documentType: MotorClaimDocumentType;
  originalFileName: string;
  storagePath: string;
  motorClaim: {
    id: string;
    claimNumber: string;
    numberPlate: string;
    customerId: string;
    customer: { dropboxFolder: { syncStatus: string; dropboxFolderId: string | null; displayPath: string | null } | null };
  };
  dropboxSync: {
    standardizedFileName: string;
    claimFolderName: string | null;
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
  return code === "CLAIM_DOCUMENT_CONFLICT" || code === "DROPBOX_FILE_IS_FOLDER" || code === "BUSINESS_FOLDER_CONFLICT" ? "CONFLICT" : "ERROR";
}

async function failResult(motorClaimDocumentId: string, status: ClaimDocumentSyncOutcomeStatus, code: DropboxErrorCode, message: string): Promise<ClaimDocumentSyncResult> {
  await prisma.motorClaimDocumentDropboxSync
    .update({ where: { motorClaimDocumentId }, data: { syncStatus: status, lastErrorCode: code, lastErrorMessage: message, lastSyncAttemptAt: new Date() } })
    .catch(() => {});
  return { success: false, status, code, message };
}

async function updateBusinessFileRow(ref: ClaimBusinessFileRef, data: Record<string, unknown>): Promise<void> {
  if (ref.source === "QUOTATION_CASE") {
    await prisma.quotationDropboxBusinessFile.update({ where: { id: ref.businessFileId }, data }).catch(() => {});
  } else if (ref.source === "POLICY_FALLBACK") {
    await prisma.policyDropboxBusinessFile.update({ where: { id: ref.businessFileId }, data }).catch(() => {});
  } else {
    await prisma.motorClaimDropboxBusinessFile.update({ where: { id: ref.businessFileId }, data }).catch(() => {});
  }
}

async function ensureClaimBusinessFolderOnDropbox(
  client: Dropbox,
  customerFolderPath: string,
  ref: ClaimBusinessFileRef,
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

// Idempotent check-then-create for one nested folder level, tolerant of a
// lost create race via one recheck — same convention as the "Policy"/
// "Invoice" subfolder creation in the other Dropbox sync modules.
async function ensureNestedFolder(client: Dropbox, parentPath: string, folderName: string, rootFolder: string, conflictCode: DropboxErrorCode): Promise<{ ok: true; path: string } | { ok: false; code: DropboxErrorCode; message: string }> {
  let folderPath: string;
  try {
    folderPath = joinDropboxPath(parentPath, folderName);
    assertInsideRoot(folderPath, rootFolder);
    const existing = await tryGetMetadata(client, folderPath);
    if (!existing) {
      await withRateLimitBackoff(() => client.filesCreateFolderV2({ path: folderPath, autorename: false }));
    } else if (existing.tag !== "folder") {
      return { ok: false, code: conflictCode, message: `A file exists where the ${folderName} folder should be.` };
    }
    return { ok: true, path: folderPath };
  } catch (err) {
    if (err instanceof DropboxIntegrationError && err.code === "ROOT_PATH_INVALID") {
      return { ok: false, code: "DROPBOX_FILE_OUTSIDE_ROOT", message: err.message };
    }
    const recheckPath = `${parentPath}/${folderName}`;
    const recheck = await tryGetMetadata(client, recheckPath).catch(() => null);
    if (!recheck) {
      const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
      return { ok: false, code: mapped.code, message: mapped.message };
    }
    return { ok: true, path: recheckPath };
  }
}

// The Claim-reference subfolder name (Part 4): "<CLAIM_REFERENCE>-<NUMBER
// PLATE>". Computed once for the Claim's first-ever synced document, then
// reused verbatim (read from any sibling's stored snapshot) so it never
// changes even if numberPlate/claimNumber are edited afterward.
function buildMotorClaimReferenceFolderName(claim: { claimNumber: string; numberPlate: string }): string {
  const reference = toFilenameSegment(claim.claimNumber, "CLAIM");
  const plate = toFilenameSegment(claim.numberPlate, "PLATE");
  return sanitizeBusinessTitle(`${reference}-${plate}`, reference);
}

async function loadSiblingStandardizedNamesLower(motorClaimId: string, excludeDocumentId?: string): Promise<Set<string>> {
  const rows = await prisma.motorClaimDocumentDropboxSync.findMany({
    where: {
      syncStatus: { in: ["SYNCED", "SYNCING"] },
      ...(excludeDocumentId ? { motorClaimDocumentId: { not: excludeDocumentId } } : {}),
      motorClaimDocument: { motorClaimId },
    },
    select: { standardizedFileName: true },
  });
  return new Set(rows.map((r) => r.standardizedFileName.toLowerCase()));
}

// Reuses the claim-reference folder name already established by an earlier
// document of this same Claim (Part 4: "immutable, shared across document
// retries") — never recomputes it once any sibling has one.
async function resolveClaimFolderName(claim: { id: string; claimNumber: string; numberPlate: string }): Promise<string> {
  const existing = await prisma.motorClaimDocumentDropboxSync.findFirst({
    where: { claimFolderName: { not: null }, motorClaimDocument: { motorClaimId: claim.id } },
    select: { claimFolderName: true },
  });
  if (existing?.claimFolderName) return existing.claimFolderName;
  return buildMotorClaimReferenceFolderName(claim);
}

export async function syncMotorClaimDocumentToDropbox(motorClaimDocumentId: string): Promise<ClaimDocumentSyncResult> {
  const document = (await prisma.motorClaimDocument.findUnique({
    where: { id: motorClaimDocumentId },
    include: {
      motorClaim: { select: { id: true, claimNumber: true, numberPlate: true, customerId: true, customer: { select: { dropboxFolder: true } } } },
      dropboxSync: true,
    },
  })) as DocumentForSync | null;

  if (!document) {
    return { success: false, status: "ERROR", code: "CLAIM_DOCUMENT_NOT_FOUND", message: "Document not found." };
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
    await prisma.motorClaimDocumentDropboxSync.update({
      where: { motorClaimDocumentId },
      data: { syncStatus: "SYNCING", lastSyncAttemptAt: new Date() },
    });
  } else {
    const existingNamesLower = await loadSiblingStandardizedNamesLower(document.motorClaimId, document.id);
    standardizedFileName = buildStandardizedMotorClaimDocumentFilename({
      documentType: document.documentType,
      originalFileName: document.originalFileName,
      existingStandardizedNamesLower: existingNamesLower,
    });
    try {
      await prisma.motorClaimDocumentDropboxSync.create({
        data: { motorClaimDocumentId, standardizedFileName, originalFileName: document.originalFileName, syncStatus: "SYNCING", lastSyncAttemptAt: new Date() },
      });
    } catch {
      const existing = await prisma.motorClaimDocumentDropboxSync.update({
        where: { motorClaimDocumentId },
        data: { syncStatus: "SYNCING", lastSyncAttemptAt: new Date() },
      });
      standardizedFileName = existing.standardizedFileName;
    }
  }

  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) {
    return failResult(motorClaimDocumentId, "ERROR", "DROPBOX_NOT_CONNECTED", auth.message);
  }

  let customerFolderPath = document.motorClaim.customer.dropboxFolder?.displayPath ?? null;
  if (document.motorClaim.customer.dropboxFolder?.syncStatus !== "SYNCED" || !customerFolderPath) {
    const folderSync = await syncCustomerFolder(document.motorClaim.customerId);
    if (!folderSync.success || !folderSync.path) {
      return failResult(motorClaimDocumentId, "ERROR", "CUSTOMER_FOLDER_NOT_SYNCED", "The customer's Dropbox folder is not synchronized yet.");
    }
    customerFolderPath = folderSync.path;
  }

  const businessFileResult = await ensureMotorClaimDropboxBusinessFile(document.motorClaimId);
  if (!businessFileResult.ok) {
    return failResult(motorClaimDocumentId, "ERROR", "CLAIM_NOT_FOUND", "Claim not found.");
  }
  const businessFolder = await ensureClaimBusinessFolderOnDropbox(auth.client, customerFolderPath, businessFileResult.ref, document.motorClaim.claimNumber);
  if (!businessFolder.ok) {
    return failResult(motorClaimDocumentId, businessFolder.status, businessFolder.code, businessFolder.message);
  }

  const claimFolder = await ensureNestedFolder(auth.client, businessFolder.path, CLAIM_SUBFOLDER_NAME, auth.row.rootFolder, "BUSINESS_FOLDER_CONFLICT");
  if (!claimFolder.ok) {
    return failResult(motorClaimDocumentId, "ERROR", claimFolder.code, claimFolder.message);
  }

  const claimFolderName = document.dropboxSync?.claimFolderName ?? (await resolveClaimFolderName(document.motorClaim));
  const claimReferenceFolder = await ensureNestedFolder(auth.client, claimFolder.path, claimFolderName, auth.row.rootFolder, "CLAIM_FOLDER_CONFLICT");
  if (!claimReferenceFolder.ok) {
    return failResult(motorClaimDocumentId, "ERROR", claimReferenceFolder.code, claimReferenceFolder.message);
  }

  const fileExists = await motorClaimDocumentStorage.fileExists(document.storagePath);
  if (!fileExists) {
    return failResult(motorClaimDocumentId, "ERROR", "LOCAL_FILE_NOT_FOUND", "The locally stored Claim document could not be found.");
  }
  const metadata = await motorClaimDocumentStorage.getMetadata(document.storagePath);
  if (!metadata || metadata.size <= 0) {
    return failResult(motorClaimDocumentId, "ERROR", "LOCAL_FILE_NOT_FOUND", "The locally stored Claim document is empty.");
  }
  if (metadata.size > DROPBOX_SIMPLE_UPLOAD_MAX_BYTES) {
    return failResult(motorClaimDocumentId, "ERROR", "FILE_TOO_LARGE", "File exceeds the Dropbox upload size limit.");
  }

  let targetPath: string;
  try {
    targetPath = joinDropboxPath(claimReferenceFolder.path, standardizedFileName);
    assertInsideRoot(targetPath, auth.row.rootFolder);
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return failResult(motorClaimDocumentId, "ERROR", "DROPBOX_FILE_OUTSIDE_ROOT", mapped.message);
  }

  try {
    const stream = await motorClaimDocumentStorage.openFile(document.storagePath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const buffer = Buffer.concat(chunks);

    const existing = await tryGetMetadata(auth.client, targetPath);
    let uploadMode: { ".tag": "add" } | { ".tag": "update"; update: string } = { ".tag": "add" };
    if (existing) {
      if (existing.tag !== "file") {
        return failResult(motorClaimDocumentId, "CONFLICT", "DROPBOX_FILE_IS_FOLDER", "A folder already exists at the required Claim document path.");
      }
      const linkedToUs = document.dropboxSync?.dropboxFileId && existing.id === document.dropboxSync.dropboxFileId;
      if (!linkedToUs) {
        return failResult(motorClaimDocumentId, "CONFLICT", "CLAIM_DOCUMENT_CONFLICT", "A different, unrelated file already exists at this document's Dropbox path.");
      }
      uploadMode = existing.rev ? { ".tag": "update", update: existing.rev } : { ".tag": "add" };
    }

    const uploaded = await withRateLimitBackoff(() => auth.client.filesUpload({ path: targetPath, mode: uploadMode, autorename: false, contents: buffer }));
    const result = uploaded.result;

    await prisma.motorClaimDocumentDropboxSync.update({
      where: { motorClaimDocumentId },
      data: {
        businessFileId: businessFileResult.ref.businessFileId,
        businessFileSource: businessFileResult.ref.source,
        claimFolderName,
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
      return failResult(motorClaimDocumentId, classifyStatus(err.code), err.code, err.message);
    }
    const mapped = mapDropboxError(err);
    return failResult(motorClaimDocumentId, classifyStatus(mapped.code), mapped.code, mapped.message);
  }
}

export async function syncMotorClaimDocumentWithTimeout(motorClaimDocumentId: string): Promise<string> {
  try {
    const result = await Promise.race([
      syncMotorClaimDocumentToDropbox(motorClaimDocumentId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), DROPBOX_SYNC_TIMEOUT_MS)),
    ]);
    return result?.status ?? "PENDING";
  } catch {
    return "ERROR";
  }
}

// --- Read-only verification -----------------------------------------------

export async function verifyMotorClaimBusinessFolder(motorClaimId: string): Promise<ClaimDocumentSyncResult> {
  const ref = await resolveMotorClaimBusinessFileRefReadOnly(motorClaimId);
  if (!ref || !ref.dropboxFolderId) {
    return { success: false, status: "PENDING", message: "The business folder has not been synchronized yet." };
  }
  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) return { success: false, status: "ERROR", code: "DROPBOX_NOT_CONNECTED", message: auth.message };

  try {
    // Read-only single-record check — bounded tightly so an admin's Verify
    // click never hangs.
    const metadata = await withRateLimitBackoff(() => auth.client.filesGetMetadata({ path: ref.dropboxFolderId! }), INTERACTIVE_BACKOFF);
    if (metadata.result[".tag"] !== "folder") {
      return { success: false, status: "ERROR", code: "BUSINESS_FOLDER_CONFLICT", message: "The linked Dropbox object is not a folder." };
    }
    const resolvedPath = metadata.result.path_display ?? ref.dropboxDisplayPath ?? "";
    assertInsideRoot(resolvedPath, auth.row.rootFolder);
    await updateBusinessFileRow(ref, {
      dropboxDisplayPath: resolvedPath,
      dropboxPathLower: resolvedPath.toLowerCase(),
      syncStatus: "SYNCED" as const,
      lastSyncedAt: new Date(),
      lastSyncAttemptAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    return { success: true, status: "SYNCED" };
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return { success: false, status: mapped.code === "BUSINESS_FOLDER_CONFLICT" ? "CONFLICT" : "ERROR", code: mapped.code, message: mapped.message };
  }
}

export async function verifyMotorClaimDocumentSync(motorClaimDocumentId: string): Promise<ClaimDocumentSyncResult> {
  const document = await prisma.motorClaimDocument.findUnique({
    where: { id: motorClaimDocumentId },
    select: { id: true, dropboxSync: true },
  });
  if (!document) return { success: false, status: "ERROR", code: "CLAIM_DOCUMENT_NOT_FOUND", message: "Document not found." };

  const syncRow = document.dropboxSync;
  if (!syncRow || !syncRow.dropboxFileId) {
    return { success: false, status: "PENDING", message: "This document has not been synchronized yet." };
  }

  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) return { success: false, status: "ERROR", code: "DROPBOX_NOT_CONNECTED", message: auth.message };

  try {
    // Read-only single-record check — bounded tightly so an admin's Verify
    // click never hangs.
    const metadata = await withRateLimitBackoff(() => auth.client.filesGetMetadata({ path: syncRow.dropboxFileId! }), INTERACTIVE_BACKOFF);
    if (metadata.result[".tag"] !== "file") {
      return failResult(motorClaimDocumentId, "ERROR", "DROPBOX_FILE_IS_FOLDER", "The linked Dropbox object is a folder, not a file.");
    }
    const fileMeta = metadata.result;
    const resolvedPath = fileMeta.path_display ?? syncRow.dropboxDisplayPath ?? "";
    assertInsideRoot(resolvedPath, auth.row.rootFolder);

    if (syncRow.dropboxSize !== null && BigInt(fileMeta.size) !== syncRow.dropboxSize) {
      return failResult(motorClaimDocumentId, "CONFLICT", "CLAIM_DOCUMENT_CONFLICT", "The Dropbox file size no longer matches the last synchronized upload.");
    }
    if (syncRow.dropboxContentHash && fileMeta.content_hash && fileMeta.content_hash !== syncRow.dropboxContentHash) {
      return failResult(motorClaimDocumentId, "CONFLICT", "CLAIM_DOCUMENT_CONFLICT", "The Dropbox file content no longer matches the last synchronized upload.");
    }

    await prisma.motorClaimDocumentDropboxSync.update({
      where: { motorClaimDocumentId },
      data: { dropboxRevision: fileMeta.rev, dropboxDisplayPath: resolvedPath, dropboxPathLower: fileMeta.path_lower ?? resolvedPath.toLowerCase(), syncStatus: "SYNCED", lastSyncedAt: new Date(), lastSyncAttemptAt: new Date(), lastErrorCode: null, lastErrorMessage: null },
    });
    return { success: true, status: "SYNCED" };
  } catch (err) {
    if (isNotFoundError(err)) {
      return failResult(motorClaimDocumentId, "ERROR", "DROPBOX_FILE_NOT_FOUND", "The linked Dropbox file could not be found. Re-upload to restore it.");
    }
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return failResult(motorClaimDocumentId, classifyStatus(mapped.code), mapped.code, mapped.message);
  }
}

// --- Backfill --------------------------------------------------------------

export type ClaimDocumentBackfillPreview = {
  totalDocuments: number;
  synced: number;
  pending: number;
  failed: number;
  conflicts: number;
  missingLocalFiles: number;
  linkedToPolicy: number;
  usingClaimFallbackBusinessFile: number;
};

export async function previewMotorClaimDocumentBackfill(): Promise<ClaimDocumentBackfillPreview> {
  const [totalDocuments, statusCounts, linkedToPolicy, usingClaimFallbackBusinessFile] = await Promise.all([
    prisma.motorClaimDocument.count(),
    prisma.motorClaimDocumentDropboxSync.groupBy({ by: ["syncStatus"], _count: { _all: true } }),
    prisma.motorClaimDocumentDropboxSync.count({ where: { businessFileSource: { in: ["QUOTATION_CASE", "POLICY_FALLBACK"] } } }),
    prisma.motorClaimDocumentDropboxSync.count({ where: { businessFileSource: "CLAIM_FALLBACK" } }),
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
    linkedToPolicy,
    usingClaimFallbackBusinessFile,
  };
}

export type ClaimDocumentBackfillMode = "init-missing" | "sync-missing" | "retry-failed" | "verify-synced";
export type ClaimDocumentBackfillBatchResult = {
  processed: number;
  succeeded: number;
  failed: number;
  results: { documentId: string; success: boolean; status: string; code?: DropboxErrorCode }[];
};

const DEFAULT_BATCH_SIZE = 15;
const MAX_BATCH_SIZE = 20;
const MIN_BATCH_SIZE = 1;

export async function runMotorClaimDocumentBackfillBatch(mode: ClaimDocumentBackfillMode, limit: number = DEFAULT_BATCH_SIZE): Promise<ClaimDocumentBackfillBatchResult> {
  const boundedLimit = Math.max(MIN_BATCH_SIZE, Math.min(limit, MAX_BATCH_SIZE));
  const candidates = await selectBackfillCandidates(mode, boundedLimit);

  const results: ClaimDocumentBackfillBatchResult["results"] = [];
  for (const documentId of candidates) {
    const outcome = mode === "verify-synced" ? await verifyMotorClaimDocumentSync(documentId) : await syncMotorClaimDocumentToDropbox(documentId);
    results.push({ documentId, success: outcome.success, status: outcome.status, code: outcome.code });
  }

  return { processed: results.length, succeeded: results.filter((r) => r.success).length, failed: results.filter((r) => !r.success).length, results };
}

async function selectBackfillCandidates(mode: ClaimDocumentBackfillMode, limit: number): Promise<string[]> {
  let rows: { id: string }[];
  if (mode === "init-missing" || mode === "sync-missing") {
    rows = await prisma.motorClaimDocument.findMany({
      where: { OR: [{ dropboxSync: null }, { dropboxSync: { syncStatus: { in: ["PENDING", "SYNCING"] } } }] },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  } else if (mode === "retry-failed") {
    rows = await prisma.motorClaimDocument.findMany({
      where: { dropboxSync: { syncStatus: { in: ["ERROR", "CONFLICT"] } } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  } else {
    rows = await prisma.motorClaimDocument.findMany({
      where: { dropboxSync: { syncStatus: "SYNCED" } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }
  return rows.map((r) => r.id);
}
