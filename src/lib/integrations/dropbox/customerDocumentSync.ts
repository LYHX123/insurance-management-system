// Server-only. Dropbox Integration Phase 3 — synchronizes one Customer
// document's already-locally-stored file into Dropbox. Local storage stays
// authoritative and immediate (Part 17 spec): every function here reads an
// already-committed CustomerDocument row and an already-written local file;
// nothing here ever blocks or reverses the local upload.
import type { Dropbox } from "dropbox";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { storageService } from "@/lib/storage";
import { getAuthenticatedDropboxClient } from "./service";
import { syncCustomerFolder } from "./customer-folders";
import { joinDropboxPath, assertInsideRoot } from "./paths";
import { DropboxIntegrationError, mapDropboxError, type DropboxErrorCode } from "./errors";
import { buildStandardizedDropboxFilename, isPlausibleStandardizedFilename } from "./customerDocumentFilenames";
import type { CustomerDocumentType } from "@/generated/prisma/enums";

// A row stuck in SYNCING past this age is treated as abandoned (crashed
// process) rather than genuinely in progress — same convention and value as
// Phase 2's customer-folders.ts.
const STALE_SYNCING_THRESHOLD_MS = 2 * 60 * 1000;

// Dropbox's simple-upload (filesUpload) limit is 150MB; the app's own
// configured cap (MAX_UPLOAD_FILE_SIZE_MB, currently 20MB) is always well
// under that, so upload sessions/chunking are unnecessary (Part 12) — this
// is only a defensive backstop, not expected to ever trigger.
const DROPBOX_SIMPLE_UPLOAD_MAX_BYTES = 150 * 1024 * 1024;

export type DocumentSyncOutcomeStatus = "PENDING" | "SYNCING" | "SYNCED" | "ERROR" | "CONFLICT";
export type DocumentSyncResult = {
  success: boolean;
  status: DocumentSyncOutcomeStatus;
  code?: DropboxErrorCode;
  message?: string;
};

type DocumentForSync = {
  id: string;
  customerId: string;
  projectId: string | null;
  documentType: CustomerDocumentType;
  originalFileName: string;
  mimeType: string;
  storageKey: string;
  customer: {
    dropboxFolder: {
      syncStatus: string;
      dropboxFolderId: string | null;
      displayPath: string | null;
    } | null;
  };
  dropboxSync: {
    standardizedFileName: string;
    syncStatus: string;
    lastSyncAttemptAt: Date | null;
    dropboxFileId: string | null;
    dropboxDisplayPath: string | null;
    uploadedSize: bigint | null;
    contentHash: string | null;
  } | null;
};

function destinationSubfolderName(projectId: string | null): "Customer Documents" | "General Documents" {
  return projectId ? "General Documents" : "Customer Documents";
}

// Names already claimed by this customer's sibling documents in the SAME
// destination subfolder (company docs all share "Customer Documents";
// every project's docs share the one "General Documents" folder — Part 6:
// no per-project subfolders). Excludes the document's own row so a retry
// recomputing this reproduces its own existing name, never a new version.
export async function loadSiblingStandardizedNamesLower(
  customerId: string,
  projectId: string | null,
  excludeDocumentId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<Set<string>> {
  const rows = await db.customerDocumentDropboxSync.findMany({
    where: {
      syncStatus: { in: ["SYNCED", "SYNCING"] },
      customerDocumentId: { not: excludeDocumentId },
      customerDocument: {
        customerId,
        projectId: projectId ? { not: null } : null,
      },
    },
    select: { standardizedFileName: true },
  });
  return new Set(rows.map((r) => r.standardizedFileName.toLowerCase()));
}

async function failResult(
  customerDocumentId: string,
  status: DocumentSyncOutcomeStatus,
  code: DropboxErrorCode,
  message: string
): Promise<DocumentSyncResult> {
  await prisma.customerDocumentDropboxSync
    .update({
      where: { customerDocumentId },
      data: { syncStatus: status, lastErrorCode: code, lastErrorMessage: message, lastSyncAttemptAt: new Date() },
    })
    .catch(() => {
      // The row may not exist yet if failure happened before it could be
      // created (e.g. CUSTOMER_DOCUMENT_NOT_FOUND) — nothing to update.
    });
  return { success: false, status, code, message };
}

function classifyStatus(code: DropboxErrorCode): "ERROR" | "CONFLICT" {
  return code === "CUSTOMER_DOCUMENT_CONFLICT" || code === "DROPBOX_FILE_IS_FOLDER" ? "CONFLICT" : "ERROR";
}

async function tryGetMetadata(client: Dropbox, path: string): Promise<{ tag: string; id: string | null; displayPath: string } | null> {
  try {
    const metadata = await client.filesGetMetadata({ path });
    return {
      tag: metadata.result[".tag"],
      id: "id" in metadata.result ? (metadata.result.id ?? null) : null,
      displayPath: "path_display" in metadata.result ? (metadata.result.path_display ?? path) : path,
    };
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw mapDropboxError(err);
  }
}

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

// Main entry point — used for the post-upload attempt, ADMIN retry, and
// ADMIN "re-upload current local file". Never throws; always returns a
// normalized result and leaves the sync row updated to match (Part 5/8/13).
export async function syncCustomerDocument(customerDocumentId: string): Promise<DocumentSyncResult> {
  const document = (await prisma.customerDocument.findUnique({
    where: { id: customerDocumentId },
    include: {
      customer: { include: { dropboxFolder: true } },
      dropboxSync: true,
    },
  })) as DocumentForSync | null;

  if (!document) {
    return { success: false, status: "ERROR", code: "CUSTOMER_DOCUMENT_NOT_FOUND", message: "Document not found." };
  }

  // Stale-SYNCING guard (mirrors Phase 2 exactly) — a genuinely concurrent
  // attempt is refused rather than double-processed (Part 13, requirement 2).
  if (document.dropboxSync?.syncStatus === "SYNCING" && document.dropboxSync.lastSyncAttemptAt) {
    const age = Date.now() - document.dropboxSync.lastSyncAttemptAt.getTime();
    if (age < STALE_SYNCING_THRESHOLD_MS) {
      return { success: false, status: "SYNCING", message: "A synchronization is already in progress." };
    }
  }

  // Create-if-missing (legacy/backfill documents) or claim the row for this
  // attempt. The unique constraint on customerDocumentId is the DB-level
  // guarantee behind "one sync row per document" (Part 13, requirement 5).
  let standardizedFileName: string;
  if (document.dropboxSync) {
    standardizedFileName = document.dropboxSync.standardizedFileName;
    await prisma.customerDocumentDropboxSync.update({
      where: { customerDocumentId },
      data: { syncStatus: "SYNCING", lastSyncAttemptAt: new Date() },
    });
  } else {
    const existingNamesLower = await loadSiblingStandardizedNamesLower(document.customerId, document.projectId, document.id);
    standardizedFileName = buildStandardizedDropboxFilename({
      documentType: document.documentType,
      originalFileName: document.originalFileName,
      mimeType: document.mimeType,
      existingStandardizedNamesLower: existingNamesLower,
    });
    try {
      await prisma.customerDocumentDropboxSync.create({
        data: {
          customerDocumentId,
          standardizedFileName,
          originalFileName: document.originalFileName,
          syncStatus: "SYNCING",
          lastSyncAttemptAt: new Date(),
        },
      });
    } catch {
      // Lost a create race to a concurrent attempt — reuse its row/name
      // rather than creating a second one.
      const existing = await prisma.customerDocumentDropboxSync.update({
        where: { customerDocumentId },
        data: { syncStatus: "SYNCING", lastSyncAttemptAt: new Date() },
      });
      standardizedFileName = existing.standardizedFileName;
    }
  }

  if (!standardizedFileName.trim()) {
    return failResult(customerDocumentId, "ERROR", "INVALID_STANDARD_FILENAME", "Could not compute a valid Dropbox filename.");
  }

  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) {
    return failResult(customerDocumentId, "ERROR", "DROPBOX_NOT_CONNECTED", auth.message);
  }

  // Ensure the customer folder exists/is current before attempting the
  // document upload (Part 6) — never creates a duplicate customer folder,
  // syncCustomerFolder is itself idempotent (Phase 2 guarantee).
  let customerFolderPath = document.customer.dropboxFolder?.displayPath ?? null;
  if (document.customer.dropboxFolder?.syncStatus !== "SYNCED" || !customerFolderPath) {
    const folderSync = await syncCustomerFolder(document.customerId);
    if (!folderSync.success || !folderSync.path) {
      return failResult(customerDocumentId, "ERROR", "CUSTOMER_FOLDER_NOT_SYNCED", "The customer's Dropbox folder is not synchronized yet.");
    }
    customerFolderPath = folderSync.path;
  }

  const file = await storageService.getFile(document.storageKey);
  if (!file) {
    return failResult(customerDocumentId, "ERROR", "LOCAL_FILE_NOT_FOUND", "The locally stored file could not be read.");
  }
  if (file.buffer.length > DROPBOX_SIMPLE_UPLOAD_MAX_BYTES) {
    return failResult(customerDocumentId, "ERROR", "FILE_TOO_LARGE", "File exceeds the Dropbox upload size limit.");
  }

  let targetPath: string;
  try {
    const subfolderPath = joinDropboxPath(customerFolderPath, destinationSubfolderName(document.projectId));
    targetPath = joinDropboxPath(subfolderPath, standardizedFileName);
    assertInsideRoot(targetPath, auth.row.rootFolder);
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return failResult(customerDocumentId, "ERROR", "DROPBOX_FILE_OUTSIDE_ROOT", mapped.message);
  }

  try {
    const existing = await tryGetMetadata(auth.client, targetPath);

    let uploadMode: { ".tag": "add" } | { ".tag": "update"; update: string } = { ".tag": "add" };
    if (existing) {
      if (existing.tag !== "file") {
        return failResult(customerDocumentId, "CONFLICT", "DROPBOX_FILE_IS_FOLDER", "A folder already exists at the required Dropbox document path.");
      }
      const linkedToUs = document.dropboxSync?.dropboxFileId && existing.id === document.dropboxSync.dropboxFileId;
      if (!linkedToUs) {
        return failResult(
          customerDocumentId,
          "CONFLICT",
          "CUSTOMER_DOCUMENT_CONFLICT",
          "A different, unrelated file already exists at this document's Dropbox path."
        );
      }
      // Safe conditional overwrite: mode 'update' only succeeds if the rev
      // we just read is still current, so a concurrent external edit is
      // never silently clobbered.
      const currentMetadata = await auth.client.filesGetMetadata({ path: targetPath });
      const rev = "rev" in currentMetadata.result ? currentMetadata.result.rev : undefined;
      uploadMode = rev ? { ".tag": "update", update: rev } : { ".tag": "add" };
    }

    const uploaded = await auth.client.filesUpload({
      path: targetPath,
      mode: uploadMode,
      autorename: false,
      contents: file.buffer,
    });
    const result = uploaded.result;

    await prisma.customerDocumentDropboxSync.update({
      where: { customerDocumentId },
      data: {
        dropboxFileId: result.id,
        dropboxRevision: result.rev,
        dropboxDisplayPath: result.path_display ?? targetPath,
        dropboxPathLower: result.path_lower ?? targetPath.toLowerCase(),
        standardizedFileName,
        contentHash: result.content_hash ?? null,
        uploadedSize: BigInt(result.size),
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
      return failResult(customerDocumentId, classifyStatus(err.code), err.code, err.message);
    }
    const mapped = mapDropboxError(err);
    return failResult(customerDocumentId, classifyStatus(mapped.code), mapped.code, mapped.message);
  }
}

export type VerifyDocumentResult = DocumentSyncResult;

// Read-only against Dropbox (only filesGetMetadata calls) — never
// creates/moves/uploads anything. May still refresh our own DB metadata to
// reflect what was observed, same convention as Phase 2's
// verifyCustomerFolder (Part 9: "do not mutate" means never mutate Dropbox).
export async function verifyCustomerDocumentSync(customerDocumentId: string): Promise<VerifyDocumentResult> {
  const document = (await prisma.customerDocument.findUnique({
    where: { id: customerDocumentId },
    include: {
      customer: { include: { dropboxFolder: true } },
      dropboxSync: true,
    },
  })) as DocumentForSync | null;

  if (!document) {
    return { success: false, status: "ERROR", code: "CUSTOMER_DOCUMENT_NOT_FOUND", message: "Document not found." };
  }
  const syncRow = document.dropboxSync;
  if (!syncRow || !syncRow.dropboxFileId) {
    return { success: false, status: "PENDING", message: "This document has not been synchronized yet." };
  }

  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) {
    return { success: false, status: "ERROR", code: "DROPBOX_NOT_CONNECTED", message: auth.message };
  }

  const customerFolderPath = document.customer.dropboxFolder?.displayPath;
  if (!customerFolderPath) {
    return failResult(customerDocumentId, "ERROR", "CUSTOMER_FOLDER_NOT_SYNCED", "The customer's Dropbox folder is not synchronized.");
  }

  try {
    const metadata = await auth.client.filesGetMetadata({ path: syncRow.dropboxFileId });
    if (metadata.result[".tag"] !== "file") {
      return failResult(customerDocumentId, "ERROR", "DROPBOX_FILE_IS_FOLDER", "The linked Dropbox object is a folder, not a file.");
    }
    const fileMeta = metadata.result;
    const resolvedPath = fileMeta.path_display ?? syncRow.dropboxDisplayPath ?? "";

    try {
      assertInsideRoot(resolvedPath, auth.row.rootFolder);
    } catch {
      return failResult(customerDocumentId, "ERROR", "DROPBOX_FILE_OUTSIDE_ROOT", "The linked Dropbox file is outside the configured root.");
    }

    const expectedSubfolder = destinationSubfolderName(document.projectId);
    const expectedParentPrefix = `${customerFolderPath}/${expectedSubfolder}/`;
    if (!resolvedPath.startsWith(expectedParentPrefix) || resolvedPath.slice(expectedParentPrefix.length).includes("/")) {
      return failResult(
        customerDocumentId,
        "CONFLICT",
        "CUSTOMER_DOCUMENT_CONFLICT",
        `The linked Dropbox file is not directly inside the expected "${expectedSubfolder}" folder.`
      );
    }

    if (!isPlausibleStandardizedFilename(fileMeta.name, document.documentType, document.originalFileName, document.mimeType)) {
      return failResult(customerDocumentId, "CONFLICT", "CUSTOMER_DOCUMENT_CONFLICT", "The linked Dropbox filename no longer matches the expected standardized name.");
    }

    if (syncRow.uploadedSize !== null && BigInt(fileMeta.size) !== syncRow.uploadedSize) {
      return failResult(customerDocumentId, "CONFLICT", "CUSTOMER_DOCUMENT_CONFLICT", "The Dropbox file size no longer matches the last synchronized upload.");
    }
    if (syncRow.contentHash && fileMeta.content_hash && fileMeta.content_hash !== syncRow.contentHash) {
      return failResult(customerDocumentId, "CONFLICT", "CUSTOMER_DOCUMENT_CONFLICT", "The Dropbox file content no longer matches the last synchronized upload.");
    }

    await prisma.customerDocumentDropboxSync.update({
      where: { customerDocumentId },
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
      return failResult(customerDocumentId, "ERROR", "DROPBOX_FILE_NOT_FOUND", "The linked Dropbox file could not be found. Re-upload to restore it.");
    }
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return failResult(customerDocumentId, classifyStatus(mapped.code), mapped.code, mapped.message);
  }
}

// --- Backfill (Part 11) -----------------------------------------------

export type DocumentBackfillPreview = {
  totalDocuments: number;
  synced: number;
  pending: number;
  error: number;
  notInitialized: number;
};

// Pure DB read — never touches Dropbox (Part 11, requirement 1).
export async function previewCustomerDocumentBackfill(): Promise<DocumentBackfillPreview> {
  const [totalDocuments, statusCounts] = await Promise.all([
    prisma.customerDocument.count(),
    prisma.customerDocumentDropboxSync.groupBy({ by: ["syncStatus"], _count: { _all: true } }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of statusCounts) byStatus[row.syncStatus] = row._count._all;

  const synced = byStatus.SYNCED ?? 0;
  const error = (byStatus.ERROR ?? 0) + (byStatus.CONFLICT ?? 0);
  const pending = (byStatus.PENDING ?? 0) + (byStatus.SYNCING ?? 0) + (byStatus.DISABLED ?? 0);
  const rowCount = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  const notInitialized = Math.max(0, totalDocuments - rowCount);

  return { totalDocuments, synced, pending, error, notInitialized };
}

export type DocumentBackfillMode = "missing" | "retry-failed" | "verify-all";
export type DocumentBackfillBatchResult = {
  processed: number;
  succeeded: number;
  failed: number;
  results: { customerDocumentId: string; originalFileName: string; success: boolean; status: DocumentSyncOutcomeStatus; code?: DropboxErrorCode }[];
};

// Default lands in the 10-25 range Part 11 asks for; the ceiling caps any
// caller-requested limit there too. The floor is 1 (not 10) so a caller can
// still request a small batch deliberately — same convention as Phase 2's
// runCustomerFolderBackfillBatch.
const DEFAULT_DOCUMENT_BACKFILL_BATCH_SIZE = 20;
const MAX_DOCUMENT_BACKFILL_BATCH_SIZE = 25;
const MIN_DOCUMENT_BACKFILL_BATCH_SIZE = 1;

// Processes up to `limit` documents SEQUENTIALLY (never Promise.all — Part
// 11, requirement 6). Safe to call again for the next batch: it always
// re-queries whichever documents still match the mode's criteria, so it's
// naturally resumable (requirement 5) and never reprocesses already-handled
// documents in the same run.
export async function runCustomerDocumentBackfillBatch(
  mode: DocumentBackfillMode,
  limit: number = DEFAULT_DOCUMENT_BACKFILL_BATCH_SIZE
): Promise<DocumentBackfillBatchResult> {
  const boundedLimit = Math.max(MIN_DOCUMENT_BACKFILL_BATCH_SIZE, Math.min(limit, MAX_DOCUMENT_BACKFILL_BATCH_SIZE));

  const documents = await selectDocumentBackfillCandidates(mode, boundedLimit);

  const results: DocumentBackfillBatchResult["results"] = [];
  for (const document of documents) {
    const outcome = mode === "verify-all" ? await verifyCustomerDocumentSync(document.id) : await syncCustomerDocument(document.id);
    results.push({
      customerDocumentId: document.id,
      originalFileName: document.originalFileName,
      success: outcome.success,
      status: outcome.status,
      code: outcome.code,
    });
  }

  return {
    processed: results.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

async function selectDocumentBackfillCandidates(
  mode: DocumentBackfillMode,
  limit: number
): Promise<{ id: string; originalFileName: string }[]> {
  if (mode === "missing") {
    return prisma.customerDocument.findMany({
      where: { OR: [{ dropboxSync: null }, { dropboxSync: { syncStatus: { in: ["PENDING", "SYNCING"] } } }] },
      select: { id: true, originalFileName: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }
  if (mode === "retry-failed") {
    return prisma.customerDocument.findMany({
      where: { dropboxSync: { syncStatus: { in: ["ERROR", "CONFLICT"] } } },
      select: { id: true, originalFileName: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }
  // verify-all
  return prisma.customerDocument.findMany({
    where: { dropboxSync: { syncStatus: "SYNCED" } },
    select: { id: true, originalFileName: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}
