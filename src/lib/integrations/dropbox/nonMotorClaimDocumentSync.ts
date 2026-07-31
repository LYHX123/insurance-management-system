// Server-only. Dropbox Integration Phase 7 — synchronizes a Non-Motor Claim
// document into the Dropbox business-file structure under
// "<Business Folder>/Claim/<Claim Reference>/<standardized name>". Mirrors
// motorClaimDocumentSync.ts exactly (see its doc comment); only the Claim-
// reference folder naming differs (Part 4: "<CLAIM_REFERENCE>-<COVER_CODE>").
import type { Dropbox } from "dropbox";
import { prisma } from "@/lib/prisma";
import { nonMotorClaimDocumentStorage } from "@/lib/claimDocuments/storage";
import { getAuthenticatedDropboxClient } from "./service";
import { syncCustomerFolder } from "./customer-folders";
import { ensureBusinessFolder } from "./quotationDropboxSync";
import { ensureNonMotorClaimDropboxBusinessFile, resolveNonMotorClaimBusinessFileRefReadOnly } from "./nonMotorClaimBusinessFile";
import type { ClaimBusinessFileRef } from "./motorClaimBusinessFile";
import { NON_MOTOR_FOLDER_CODE } from "./policyBusinessFile";
import { joinDropboxPath, assertInsideRoot } from "./paths";
import { DropboxIntegrationError, mapDropboxError, type DropboxErrorCode } from "./errors";
import { buildStandardizedNonMotorClaimDocumentFilename } from "./claimDocumentFilenames";
import { sanitizeBusinessTitle, toFilenameSegment } from "./quotationDropboxNaming";
import type { NonMotorClaimDocumentType } from "@/generated/prisma/enums";
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
  nonMotorClaimId: string;
  documentType: NonMotorClaimDocumentType;
  originalFileName: string;
  storagePath: string;
  nonMotorClaim: {
    id: string;
    claimNumber: string;
    insuranceType: keyof typeof NON_MOTOR_FOLDER_CODE;
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

async function failResult(nonMotorClaimDocumentId: string, status: ClaimDocumentSyncOutcomeStatus, code: DropboxErrorCode, message: string): Promise<ClaimDocumentSyncResult> {
  await prisma.nonMotorClaimDocumentDropboxSync
    .update({ where: { nonMotorClaimDocumentId }, data: { syncStatus: status, lastErrorCode: code, lastErrorMessage: message, lastSyncAttemptAt: new Date() } })
    .catch(() => {});
  return { success: false, status, code, message };
}

async function updateBusinessFileRow(ref: ClaimBusinessFileRef, data: Record<string, unknown>): Promise<void> {
  if (ref.source === "QUOTATION_CASE") {
    await prisma.quotationDropboxBusinessFile.update({ where: { id: ref.businessFileId }, data }).catch(() => {});
  } else if (ref.source === "POLICY_FALLBACK") {
    await prisma.policyDropboxBusinessFile.update({ where: { id: ref.businessFileId }, data }).catch(() => {});
  } else {
    await prisma.nonMotorClaimDropboxBusinessFile.update({ where: { id: ref.businessFileId }, data }).catch(() => {});
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

// Part 4: "<CLAIM_REFERENCE>-<COVER_CODE>" e.g. "NMC-0001-FIRE".
function buildNonMotorClaimReferenceFolderName(claim: { claimNumber: string; insuranceType: keyof typeof NON_MOTOR_FOLDER_CODE }): string {
  const reference = toFilenameSegment(claim.claimNumber, "CLAIM");
  const coverCode = NON_MOTOR_FOLDER_CODE[claim.insuranceType] ?? String(claim.insuranceType);
  return sanitizeBusinessTitle(`${reference}-${coverCode}`, reference);
}

async function loadSiblingStandardizedNamesLower(nonMotorClaimId: string, excludeDocumentId?: string): Promise<Set<string>> {
  const rows = await prisma.nonMotorClaimDocumentDropboxSync.findMany({
    where: {
      syncStatus: { in: ["SYNCED", "SYNCING"] },
      ...(excludeDocumentId ? { nonMotorClaimDocumentId: { not: excludeDocumentId } } : {}),
      nonMotorClaimDocument: { nonMotorClaimId },
    },
    select: { standardizedFileName: true },
  });
  return new Set(rows.map((r) => r.standardizedFileName.toLowerCase()));
}

async function resolveClaimFolderName(claim: { id: string; claimNumber: string; insuranceType: keyof typeof NON_MOTOR_FOLDER_CODE }): Promise<string> {
  const existing = await prisma.nonMotorClaimDocumentDropboxSync.findFirst({
    where: { claimFolderName: { not: null }, nonMotorClaimDocument: { nonMotorClaimId: claim.id } },
    select: { claimFolderName: true },
  });
  if (existing?.claimFolderName) return existing.claimFolderName;
  return buildNonMotorClaimReferenceFolderName(claim);
}

export async function syncNonMotorClaimDocumentToDropbox(nonMotorClaimDocumentId: string): Promise<ClaimDocumentSyncResult> {
  const document = (await prisma.nonMotorClaimDocument.findUnique({
    where: { id: nonMotorClaimDocumentId },
    include: {
      nonMotorClaim: { select: { id: true, claimNumber: true, insuranceType: true, customerId: true, customer: { select: { dropboxFolder: true } } } },
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
    await prisma.nonMotorClaimDocumentDropboxSync.update({
      where: { nonMotorClaimDocumentId },
      data: { syncStatus: "SYNCING", lastSyncAttemptAt: new Date() },
    });
  } else {
    const existingNamesLower = await loadSiblingStandardizedNamesLower(document.nonMotorClaimId, document.id);
    standardizedFileName = buildStandardizedNonMotorClaimDocumentFilename({
      documentType: document.documentType,
      originalFileName: document.originalFileName,
      existingStandardizedNamesLower: existingNamesLower,
    });
    try {
      await prisma.nonMotorClaimDocumentDropboxSync.create({
        data: { nonMotorClaimDocumentId, standardizedFileName, originalFileName: document.originalFileName, syncStatus: "SYNCING", lastSyncAttemptAt: new Date() },
      });
    } catch {
      const existing = await prisma.nonMotorClaimDocumentDropboxSync.update({
        where: { nonMotorClaimDocumentId },
        data: { syncStatus: "SYNCING", lastSyncAttemptAt: new Date() },
      });
      standardizedFileName = existing.standardizedFileName;
    }
  }

  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) {
    return failResult(nonMotorClaimDocumentId, "ERROR", "DROPBOX_NOT_CONNECTED", auth.message);
  }

  let customerFolderPath = document.nonMotorClaim.customer.dropboxFolder?.displayPath ?? null;
  if (document.nonMotorClaim.customer.dropboxFolder?.syncStatus !== "SYNCED" || !customerFolderPath) {
    const folderSync = await syncCustomerFolder(document.nonMotorClaim.customerId);
    if (!folderSync.success || !folderSync.path) {
      return failResult(nonMotorClaimDocumentId, "ERROR", "CUSTOMER_FOLDER_NOT_SYNCED", "The customer's Dropbox folder is not synchronized yet.");
    }
    customerFolderPath = folderSync.path;
  }

  const businessFileResult = await ensureNonMotorClaimDropboxBusinessFile(document.nonMotorClaimId);
  if (!businessFileResult.ok) {
    return failResult(nonMotorClaimDocumentId, "ERROR", "CLAIM_NOT_FOUND", "Claim not found.");
  }
  const businessFolder = await ensureClaimBusinessFolderOnDropbox(auth.client, customerFolderPath, businessFileResult.ref, document.nonMotorClaim.claimNumber);
  if (!businessFolder.ok) {
    return failResult(nonMotorClaimDocumentId, businessFolder.status, businessFolder.code, businessFolder.message);
  }

  const claimFolder = await ensureNestedFolder(auth.client, businessFolder.path, CLAIM_SUBFOLDER_NAME, auth.row.rootFolder, "BUSINESS_FOLDER_CONFLICT");
  if (!claimFolder.ok) {
    return failResult(nonMotorClaimDocumentId, "ERROR", claimFolder.code, claimFolder.message);
  }

  const claimFolderName = document.dropboxSync?.claimFolderName ?? (await resolveClaimFolderName(document.nonMotorClaim));
  const claimReferenceFolder = await ensureNestedFolder(auth.client, claimFolder.path, claimFolderName, auth.row.rootFolder, "CLAIM_FOLDER_CONFLICT");
  if (!claimReferenceFolder.ok) {
    return failResult(nonMotorClaimDocumentId, "ERROR", claimReferenceFolder.code, claimReferenceFolder.message);
  }

  const fileExists = await nonMotorClaimDocumentStorage.fileExists(document.storagePath);
  if (!fileExists) {
    return failResult(nonMotorClaimDocumentId, "ERROR", "LOCAL_FILE_NOT_FOUND", "The locally stored Claim document could not be found.");
  }
  const metadata = await nonMotorClaimDocumentStorage.getMetadata(document.storagePath);
  if (!metadata || metadata.size <= 0) {
    return failResult(nonMotorClaimDocumentId, "ERROR", "LOCAL_FILE_NOT_FOUND", "The locally stored Claim document is empty.");
  }
  if (metadata.size > DROPBOX_SIMPLE_UPLOAD_MAX_BYTES) {
    return failResult(nonMotorClaimDocumentId, "ERROR", "FILE_TOO_LARGE", "File exceeds the Dropbox upload size limit.");
  }

  let targetPath: string;
  try {
    targetPath = joinDropboxPath(claimReferenceFolder.path, standardizedFileName);
    assertInsideRoot(targetPath, auth.row.rootFolder);
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return failResult(nonMotorClaimDocumentId, "ERROR", "DROPBOX_FILE_OUTSIDE_ROOT", mapped.message);
  }

  try {
    const stream = await nonMotorClaimDocumentStorage.openFile(document.storagePath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const buffer = Buffer.concat(chunks);

    const existing = await tryGetMetadata(auth.client, targetPath);
    let uploadMode: { ".tag": "add" } | { ".tag": "update"; update: string } = { ".tag": "add" };
    if (existing) {
      if (existing.tag !== "file") {
        return failResult(nonMotorClaimDocumentId, "CONFLICT", "DROPBOX_FILE_IS_FOLDER", "A folder already exists at the required Claim document path.");
      }
      const linkedToUs = document.dropboxSync?.dropboxFileId && existing.id === document.dropboxSync.dropboxFileId;
      if (!linkedToUs) {
        return failResult(nonMotorClaimDocumentId, "CONFLICT", "CLAIM_DOCUMENT_CONFLICT", "A different, unrelated file already exists at this document's Dropbox path.");
      }
      uploadMode = existing.rev ? { ".tag": "update", update: existing.rev } : { ".tag": "add" };
    }

    const uploaded = await withRateLimitBackoff(() => auth.client.filesUpload({ path: targetPath, mode: uploadMode, autorename: false, contents: buffer }));
    const result = uploaded.result;

    await prisma.nonMotorClaimDocumentDropboxSync.update({
      where: { nonMotorClaimDocumentId },
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
      return failResult(nonMotorClaimDocumentId, classifyStatus(err.code), err.code, err.message);
    }
    const mapped = mapDropboxError(err);
    return failResult(nonMotorClaimDocumentId, classifyStatus(mapped.code), mapped.code, mapped.message);
  }
}

export async function syncNonMotorClaimDocumentWithTimeout(nonMotorClaimDocumentId: string): Promise<string> {
  try {
    const result = await Promise.race([
      syncNonMotorClaimDocumentToDropbox(nonMotorClaimDocumentId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), DROPBOX_SYNC_TIMEOUT_MS)),
    ]);
    return result?.status ?? "PENDING";
  } catch {
    return "ERROR";
  }
}

// --- Read-only verification -----------------------------------------------

export async function verifyNonMotorClaimBusinessFolder(nonMotorClaimId: string): Promise<ClaimDocumentSyncResult> {
  const ref = await resolveNonMotorClaimBusinessFileRefReadOnly(nonMotorClaimId);
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

export async function verifyNonMotorClaimDocumentSync(nonMotorClaimDocumentId: string): Promise<ClaimDocumentSyncResult> {
  const document = await prisma.nonMotorClaimDocument.findUnique({
    where: { id: nonMotorClaimDocumentId },
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
      return failResult(nonMotorClaimDocumentId, "ERROR", "DROPBOX_FILE_IS_FOLDER", "The linked Dropbox object is a folder, not a file.");
    }
    const fileMeta = metadata.result;
    const resolvedPath = fileMeta.path_display ?? syncRow.dropboxDisplayPath ?? "";
    assertInsideRoot(resolvedPath, auth.row.rootFolder);

    if (syncRow.dropboxSize !== null && BigInt(fileMeta.size) !== syncRow.dropboxSize) {
      return failResult(nonMotorClaimDocumentId, "CONFLICT", "CLAIM_DOCUMENT_CONFLICT", "The Dropbox file size no longer matches the last synchronized upload.");
    }
    if (syncRow.dropboxContentHash && fileMeta.content_hash && fileMeta.content_hash !== syncRow.dropboxContentHash) {
      return failResult(nonMotorClaimDocumentId, "CONFLICT", "CLAIM_DOCUMENT_CONFLICT", "The Dropbox file content no longer matches the last synchronized upload.");
    }

    await prisma.nonMotorClaimDocumentDropboxSync.update({
      where: { nonMotorClaimDocumentId },
      data: { dropboxRevision: fileMeta.rev, dropboxDisplayPath: resolvedPath, dropboxPathLower: fileMeta.path_lower ?? resolvedPath.toLowerCase(), syncStatus: "SYNCED", lastSyncedAt: new Date(), lastSyncAttemptAt: new Date(), lastErrorCode: null, lastErrorMessage: null },
    });
    return { success: true, status: "SYNCED" };
  } catch (err) {
    if (isNotFoundError(err)) {
      return failResult(nonMotorClaimDocumentId, "ERROR", "DROPBOX_FILE_NOT_FOUND", "The linked Dropbox file could not be found. Re-upload to restore it.");
    }
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return failResult(nonMotorClaimDocumentId, classifyStatus(mapped.code), mapped.code, mapped.message);
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

export async function previewNonMotorClaimDocumentBackfill(): Promise<ClaimDocumentBackfillPreview> {
  const [totalDocuments, statusCounts, linkedToPolicy, usingClaimFallbackBusinessFile] = await Promise.all([
    prisma.nonMotorClaimDocument.count(),
    prisma.nonMotorClaimDocumentDropboxSync.groupBy({ by: ["syncStatus"], _count: { _all: true } }),
    prisma.nonMotorClaimDocumentDropboxSync.count({ where: { businessFileSource: { in: ["QUOTATION_CASE", "POLICY_FALLBACK"] } } }),
    prisma.nonMotorClaimDocumentDropboxSync.count({ where: { businessFileSource: "CLAIM_FALLBACK" } }),
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

export async function runNonMotorClaimDocumentBackfillBatch(mode: ClaimDocumentBackfillMode, limit: number = DEFAULT_BATCH_SIZE): Promise<ClaimDocumentBackfillBatchResult> {
  const boundedLimit = Math.max(MIN_BATCH_SIZE, Math.min(limit, MAX_BATCH_SIZE));
  const candidates = await selectBackfillCandidates(mode, boundedLimit);

  const results: ClaimDocumentBackfillBatchResult["results"] = [];
  for (const documentId of candidates) {
    const outcome = mode === "verify-synced" ? await verifyNonMotorClaimDocumentSync(documentId) : await syncNonMotorClaimDocumentToDropbox(documentId);
    results.push({ documentId, success: outcome.success, status: outcome.status, code: outcome.code });
  }

  return { processed: results.length, succeeded: results.filter((r) => r.success).length, failed: results.filter((r) => !r.success).length, results };
}

async function selectBackfillCandidates(mode: ClaimDocumentBackfillMode, limit: number): Promise<string[]> {
  let rows: { id: string }[];
  if (mode === "init-missing" || mode === "sync-missing") {
    rows = await prisma.nonMotorClaimDocument.findMany({
      where: { OR: [{ dropboxSync: null }, { dropboxSync: { syncStatus: { in: ["PENDING", "SYNCING"] } } }] },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  } else if (mode === "retry-failed") {
    rows = await prisma.nonMotorClaimDocument.findMany({
      where: { dropboxSync: { syncStatus: { in: ["ERROR", "CONFLICT"] } } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  } else {
    rows = await prisma.nonMotorClaimDocument.findMany({
      where: { dropboxSync: { syncStatus: "SYNCED" } },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }
  return rows.map((r) => r.id);
}
