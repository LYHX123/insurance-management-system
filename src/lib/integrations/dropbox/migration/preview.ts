// Server-only, read-only. Builds the Copy Preview: every Dropbox-backed DB
// record's expected source path, its deterministic destination path (same
// relative structure — only the root's namespace changes, never folder/file
// naming), and whether the destination already has something there.
//
// Makes NO Dropbox writes, NO DB mutations beyond the migration job/ledger
// bookkeeping rows themselves (never touches business tables) — safe to
// re-run any number of times.
import { prisma } from "@/lib/prisma";
import { getDropboxEnv } from "../constants";
import { getDropboxIntegrationRow } from "../service";
import { getMigrationSourceClient, getMigrationDestinationClient, mapMigrationError } from "./config";
import { getOrCreateActiveMigrationJob } from "./job";
import { runInBatches } from "./batch";
import { isNotFoundError } from "./notFound";
import type { MigrationActionResult } from "./types";
import type { Dropbox } from "dropbox";

type ObjectKind =
  | "ROOT"
  | "CUSTOMER_FOLDER"
  | "CUSTOMER_STANDARD_SUBFOLDER"
  | "CUSTOMER_DOCUMENT"
  | "QUOTATION_BUSINESS_FOLDER"
  | "QUOTATION_VERSION_FILE"
  | "POLICY_BUSINESS_FOLDER"
  | "POLICY_DOCUMENT"
  | "INVOICE_BUSINESS_FOLDER"
  | "INVOICE_DOCUMENT"
  | "MOTOR_CLAIM_BUSINESS_FOLDER"
  | "MOTOR_CLAIM_DOCUMENT"
  | "NON_MOTOR_CLAIM_BUSINESS_FOLDER"
  | "NON_MOTOR_CLAIM_DOCUMENT"
  | "UNCLASSIFIED";

type ExpectedObject = {
  kind: ObjectKind;
  type: "FILE" | "FOLDER";
  sourcePath: string;
  sourceId: string | null;
  expectedContentHash: string | null;
  expectedFileSize: bigint | null;
};

function toDestinationPath(sourcePath: string, sourceRoot: string, destinationRoot: string): string {
  if (sourcePath === sourceRoot) return destinationRoot;
  if (sourcePath.startsWith(sourceRoot + "/")) {
    return destinationRoot + sourcePath.slice(sourceRoot.length);
  }
  return sourcePath; // outside configured root — flagged separately, never silently rewritten
}

async function collectExpectedObjects(sourceRoot: string): Promise<ExpectedObject[]> {
  const objects: ExpectedObject[] = [{ kind: "ROOT", type: "FOLDER", sourcePath: sourceRoot, sourceId: null, expectedContentHash: null, expectedFileSize: null }];

  const customerFolders = await prisma.customerDropboxFolder.findMany({
    where: { displayPath: { not: null } },
    select: { displayPath: true, dropboxFolderId: true },
  });
  for (const row of customerFolders) {
    const path = row.displayPath!;
    objects.push({ kind: "CUSTOMER_FOLDER", type: "FOLDER", sourcePath: path, sourceId: row.dropboxFolderId, expectedContentHash: null, expectedFileSize: null });
    for (const sub of ["Customer Documents", "General Documents"]) {
      objects.push({ kind: "CUSTOMER_STANDARD_SUBFOLDER", type: "FOLDER", sourcePath: `${path}/${sub}`, sourceId: null, expectedContentHash: null, expectedFileSize: null });
    }
  }

  const customerDocs = await prisma.customerDocumentDropboxSync.findMany({
    where: { dropboxDisplayPath: { not: null } },
    select: { dropboxDisplayPath: true, dropboxFileId: true, contentHash: true, uploadedSize: true },
  });
  for (const row of customerDocs) {
    objects.push({
      kind: "CUSTOMER_DOCUMENT",
      type: "FILE",
      sourcePath: row.dropboxDisplayPath!,
      sourceId: row.dropboxFileId,
      expectedContentHash: row.contentHash,
      expectedFileSize: row.uploadedSize,
    });
  }

  const quotationFolders = await prisma.quotationDropboxBusinessFile.findMany({
    where: { dropboxDisplayPath: { not: null } },
    select: { dropboxDisplayPath: true, dropboxFolderId: true },
  });
  for (const row of quotationFolders) {
    objects.push({ kind: "QUOTATION_BUSINESS_FOLDER", type: "FOLDER", sourcePath: row.dropboxDisplayPath!, sourceId: row.dropboxFolderId, expectedContentHash: null, expectedFileSize: null });
  }

  const quotationVersions = await prisma.quotationDropboxVersion.findMany({
    where: { OR: [{ excelDropboxPath: { not: null } }, { pdfDropboxPath: { not: null } }] },
    select: { excelDropboxPath: true, excelDropboxFileId: true, pdfDropboxPath: true, pdfDropboxFileId: true },
  });
  for (const row of quotationVersions) {
    if (row.excelDropboxPath) {
      objects.push({ kind: "QUOTATION_VERSION_FILE", type: "FILE", sourcePath: row.excelDropboxPath, sourceId: row.excelDropboxFileId, expectedContentHash: null, expectedFileSize: null });
    }
    if (row.pdfDropboxPath) {
      objects.push({ kind: "QUOTATION_VERSION_FILE", type: "FILE", sourcePath: row.pdfDropboxPath, sourceId: row.pdfDropboxFileId, expectedContentHash: null, expectedFileSize: null });
    }
  }

  const policyFolders = await prisma.policyDropboxBusinessFile.findMany({
    where: { dropboxDisplayPath: { not: null } },
    select: { dropboxDisplayPath: true, dropboxFolderId: true },
  });
  for (const row of policyFolders) {
    objects.push({ kind: "POLICY_BUSINESS_FOLDER", type: "FOLDER", sourcePath: row.dropboxDisplayPath!, sourceId: row.dropboxFolderId, expectedContentHash: null, expectedFileSize: null });
  }

  const policyDocs = await prisma.policyDocumentDropboxSync.findMany({
    where: { dropboxDisplayPath: { not: null } },
    select: { dropboxDisplayPath: true, dropboxFileId: true, dropboxContentHash: true, dropboxSize: true },
  });
  for (const row of policyDocs) {
    objects.push({ kind: "POLICY_DOCUMENT", type: "FILE", sourcePath: row.dropboxDisplayPath!, sourceId: row.dropboxFileId, expectedContentHash: row.dropboxContentHash, expectedFileSize: row.dropboxSize });
  }

  const invoiceFolders = await prisma.invoiceDropboxBusinessFile.findMany({
    where: { dropboxDisplayPath: { not: null } },
    select: { dropboxDisplayPath: true, dropboxFolderId: true },
  });
  for (const row of invoiceFolders) {
    objects.push({ kind: "INVOICE_BUSINESS_FOLDER", type: "FOLDER", sourcePath: row.dropboxDisplayPath!, sourceId: row.dropboxFolderId, expectedContentHash: null, expectedFileSize: null });
  }

  const invoiceDocs = await prisma.invoiceDocumentDropboxSync.findMany({
    where: { dropboxDisplayPath: { not: null } },
    select: { dropboxDisplayPath: true, dropboxFileId: true, dropboxContentHash: true, dropboxSize: true },
  });
  for (const row of invoiceDocs) {
    objects.push({ kind: "INVOICE_DOCUMENT", type: "FILE", sourcePath: row.dropboxDisplayPath!, sourceId: row.dropboxFileId, expectedContentHash: row.dropboxContentHash, expectedFileSize: row.dropboxSize });
  }

  const motorClaimFolders = await prisma.motorClaimDropboxBusinessFile.findMany({
    where: { dropboxDisplayPath: { not: null } },
    select: { dropboxDisplayPath: true, dropboxFolderId: true },
  });
  for (const row of motorClaimFolders) {
    objects.push({ kind: "MOTOR_CLAIM_BUSINESS_FOLDER", type: "FOLDER", sourcePath: row.dropboxDisplayPath!, sourceId: row.dropboxFolderId, expectedContentHash: null, expectedFileSize: null });
  }

  const motorClaimDocs = await prisma.motorClaimDocumentDropboxSync.findMany({
    where: { dropboxDisplayPath: { not: null } },
    select: { dropboxDisplayPath: true, dropboxFileId: true, dropboxContentHash: true, dropboxSize: true },
  });
  for (const row of motorClaimDocs) {
    objects.push({ kind: "MOTOR_CLAIM_DOCUMENT", type: "FILE", sourcePath: row.dropboxDisplayPath!, sourceId: row.dropboxFileId, expectedContentHash: row.dropboxContentHash, expectedFileSize: row.dropboxSize });
  }

  const nonMotorClaimFolders = await prisma.nonMotorClaimDropboxBusinessFile.findMany({
    where: { dropboxDisplayPath: { not: null } },
    select: { dropboxDisplayPath: true, dropboxFolderId: true },
  });
  for (const row of nonMotorClaimFolders) {
    objects.push({ kind: "NON_MOTOR_CLAIM_BUSINESS_FOLDER", type: "FOLDER", sourcePath: row.dropboxDisplayPath!, sourceId: row.dropboxFolderId, expectedContentHash: null, expectedFileSize: null });
  }

  const nonMotorClaimDocs = await prisma.nonMotorClaimDocumentDropboxSync.findMany({
    where: { dropboxDisplayPath: { not: null } },
    select: { dropboxDisplayPath: true, dropboxFileId: true, dropboxContentHash: true, dropboxSize: true },
  });
  for (const row of nonMotorClaimDocs) {
    objects.push({ kind: "NON_MOTOR_CLAIM_DOCUMENT", type: "FILE", sourcePath: row.dropboxDisplayPath!, sourceId: row.dropboxFileId, expectedContentHash: row.dropboxContentHash, expectedFileSize: row.dropboxSize });
  }

  return objects;
}

type CollisionState = "MISSING" | "IDENTICAL" | "CONFLICT" | "TYPE_CONFLICT";

async function checkDestinationCollision(client: Dropbox, destinationPath: string, expected: ExpectedObject): Promise<CollisionState> {
  try {
    const meta = await client.filesGetMetadata({ path: destinationPath });
    const tag = meta.result[".tag"];
    if (expected.type === "FOLDER") {
      return tag === "folder" ? "IDENTICAL" : "TYPE_CONFLICT";
    }
    if (tag !== "file") return "TYPE_CONFLICT";
    const fileMeta = meta.result as { size?: number; content_hash?: string };
    if (
      expected.expectedContentHash &&
      fileMeta.content_hash &&
      expected.expectedFileSize !== null &&
      fileMeta.size !== undefined &&
      fileMeta.content_hash === expected.expectedContentHash &&
      BigInt(fileMeta.size) === expected.expectedFileSize
    ) {
      return "IDENTICAL";
    }
    // Existing file but we can't (or didn't) confirm identical content —
    // treat conservatively as a conflict rather than assuming safe-to-skip.
    return "CONFLICT";
  } catch (err) {
    if (isNotFoundError(err)) return "MISSING";
    throw err;
  }
}

async function scanSourceForUnexpected(client: Dropbox, sourceRoot: string, expectedPaths: Set<string>): Promise<number> {
  let cursor: string | undefined;
  let page = 0;
  let unexpected = 0;
  const MAX_PAGES = 60;

  while (true) {
    page++;
    if (page > MAX_PAGES) break;
    const res = cursor
      ? await client.filesListFolderContinue({ cursor })
      : await client.filesListFolder({ path: sourceRoot, recursive: true, include_deleted: false });

    for (const e of res.result.entries) {
      if (e[".tag"] !== "folder" && e[".tag"] !== "file") continue;
      const path = e.path_display ?? "";
      if (!expectedPaths.has(path)) unexpected++;
    }

    if (!res.result.has_more) break;
    cursor = res.result.cursor;
  }
  return unexpected;
}

export type PreviewSummary = {
  jobId: string;
  result: "SAFE_TO_CONTINUE" | "BLOCKED_BY_CONFLICT" | "BLOCKED_BY_PERMISSION" | "BLOCKED_BY_STRUCTURE" | "MANUAL_REVIEW_REQUIRED";
  totals: {
    folders: number;
    files: number;
    bytes: number;
    conflicts: number;
    identical: number;
    unexpected: number;
  };
};

export async function runCopyPreview(initiatedById?: string | null): Promise<MigrationActionResult<PreviewSummary>> {
  const envResult = getDropboxEnv();
  if (!envResult.ok) return { success: false, error: "CONFIGURATION_MISSING" };

  const job = await getOrCreateActiveMigrationJob(initiatedById);
  const integrationRow = await getDropboxIntegrationRow();
  const sourceRoot = integrationRow.rootFolder;
  const destinationRoot = job.destinationRootPath;

  let sourceClient: Dropbox;
  let destinationClient: Dropbox;
  try {
    sourceClient = (await getMigrationSourceClient(envResult.config)).client;
    destinationClient = await getMigrationDestinationClient(envResult.config);
  } catch (err) {
    const mapped = mapMigrationError(err);
    await prisma.dropboxMigrationJob.update({ where: { id: job.id }, data: { safeErrorCode: mapped.code, safeErrorMessage: mapped.message } });
    return { success: false, error: mapped.code };
  }

  // Source root must exist.
  try {
    await sourceClient.filesGetMetadata({ path: sourceRoot });
  } catch (err) {
    if (isNotFoundError(err)) {
      await prisma.dropboxMigrationJob.update({
        where: { id: job.id },
        data: { previewResult: "BLOCKED_BY_STRUCTURE", safeErrorCode: "COPY_SOURCE_MISSING", safeErrorMessage: "Source root folder does not exist." },
      });
      return { success: false, error: "COPY_SOURCE_MISSING" };
    }
    throw err;
  }

  const expectedObjects = await collectExpectedObjects(sourceRoot);
  const expectedPaths = new Set(expectedObjects.map((o) => o.sourcePath));

  const collisions = await runInBatches(expectedObjects, async (obj) => {
    const destinationPath = toDestinationPath(obj.sourcePath, sourceRoot, destinationRoot);
    const state = await checkDestinationCollision(destinationClient, destinationPath, obj);
    return { obj, destinationPath, state };
  });

  const unexpectedCount = await scanSourceForUnexpected(sourceClient, sourceRoot, expectedPaths);

  // Statuses a re-run of preview is still allowed to reclassify. Anything
  // further along (COPYING/COPIED/VERIFYING/VERIFIED) must NOT be reset back
  // to DISCOVERED/CONFLICT by a repeated preview call — only the copy/verify
  // phases themselves advance those.
  const PREVIEW_OWNED_STATUSES = new Set(["DISCOVERED", "PENDING", "CONFLICT", "MISSING_SOURCE", "SKIPPED_IDENTICAL"]);

  // Persist the ledger — upsert so a re-run is safe/idempotent and never
  // clobbers a later phase's progress.
  for (const { obj, destinationPath, state } of collisions) {
    const status = state === "CONFLICT" || state === "TYPE_CONFLICT" ? "CONFLICT" : state === "IDENTICAL" ? "SKIPPED_IDENTICAL" : "DISCOVERED";
    const safeErrorCode = state === "TYPE_CONFLICT" ? "COPY_DESTINATION_MISMATCH" : state === "CONFLICT" ? "COPY_CONFLICT" : null;

    const existing = await prisma.dropboxMigrationObjectLedger.findUnique({
      where: { migrationJobId_sourcePath: { migrationJobId: job.id, sourcePath: obj.sourcePath } },
      select: { status: true },
    });

    await prisma.dropboxMigrationObjectLedger.upsert({
      where: { migrationJobId_sourcePath: { migrationJobId: job.id, sourcePath: obj.sourcePath } },
      update: {
        objectKind: obj.kind,
        objectType: obj.type,
        destinationPath,
        expectedContentHash: obj.expectedContentHash,
        expectedFileSize: obj.expectedFileSize,
        ...(!existing || PREVIEW_OWNED_STATUSES.has(existing.status) ? { status, safeErrorCode } : {}),
      },
      create: {
        migrationJobId: job.id,
        objectKind: obj.kind,
        objectType: obj.type,
        sourcePath: obj.sourcePath,
        sourceId: obj.sourceId,
        destinationPath,
        expectedContentHash: obj.expectedContentHash,
        expectedFileSize: obj.expectedFileSize,
        status,
        safeErrorCode,
      },
    });
  }

  const count = (kind: ObjectKind, type: "FILE" | "FOLDER") => expectedObjects.filter((o) => o.kind === kind && o.type === type).length;
  const conflictCount = collisions.filter((c) => c.state === "CONFLICT" || c.state === "TYPE_CONFLICT").length;
  const identicalCount = collisions.filter((c) => c.state === "IDENTICAL").length;
  const totalBytes = expectedObjects.reduce((sum, o) => sum + (o.expectedFileSize ?? BigInt(0)), BigInt(0));

  let result: PreviewSummary["result"] = "SAFE_TO_CONTINUE";
  if (conflictCount > 0) result = "BLOCKED_BY_CONFLICT";
  else if (unexpectedCount > 0) result = "MANUAL_REVIEW_REQUIRED";

  const summaryText =
    `${expectedObjects.length} tracked objects (${expectedObjects.filter((o) => o.type === "FOLDER").length} folders, ` +
    `${expectedObjects.filter((o) => o.type === "FILE").length} files). ${identicalCount} already identical at destination, ` +
    `${conflictCount} conflicts, ${unexpectedCount} untracked objects found in source.`;

  await prisma.dropboxMigrationJob.update({
    where: { id: job.id },
    data: {
      status: result === "SAFE_TO_CONTINUE" || result === "MANUAL_REVIEW_REQUIRED" ? "PREVIEW_READY" : job.status,
      currentPhase: "preview",
      previewResult: result,
      previewSummary: summaryText,
      previewTotalFolders: expectedObjects.filter((o) => o.type === "FOLDER").length,
      previewTotalFiles: expectedObjects.filter((o) => o.type === "FILE").length,
      previewTotalBytes: totalBytes,
      previewCustomerFolders: count("CUSTOMER_FOLDER", "FOLDER"),
      previewCustomerDocuments: count("CUSTOMER_DOCUMENT", "FILE"),
      previewQuotationFolders: count("QUOTATION_BUSINESS_FOLDER", "FOLDER"),
      previewQuotationFiles: count("QUOTATION_VERSION_FILE", "FILE"),
      previewPolicyFolders: count("POLICY_BUSINESS_FOLDER", "FOLDER"),
      previewPolicyFiles: count("POLICY_DOCUMENT", "FILE"),
      previewInvoiceFolders: count("INVOICE_BUSINESS_FOLDER", "FOLDER"),
      previewInvoiceFiles: count("INVOICE_DOCUMENT", "FILE"),
      previewMotorClaimFolders: count("MOTOR_CLAIM_BUSINESS_FOLDER", "FOLDER"),
      previewMotorClaimFiles: count("MOTOR_CLAIM_DOCUMENT", "FILE"),
      previewNonMotorClaimFolders: count("NON_MOTOR_CLAIM_BUSINESS_FOLDER", "FOLDER"),
      previewNonMotorClaimFiles: count("NON_MOTOR_CLAIM_DOCUMENT", "FILE"),
      previewUnexpectedObjects: unexpectedCount,
      previewIdenticalDestinationObjects: identicalCount,
      previewConflictObjects: conflictCount,
      previewedAt: new Date(),
      safeErrorCode: null,
      safeErrorMessage: null,
    },
  });

  return {
    success: true,
    jobId: job.id,
    result,
    totals: {
      folders: expectedObjects.filter((o) => o.type === "FOLDER").length,
      files: expectedObjects.filter((o) => o.type === "FILE").length,
      bytes: Number(totalBytes),
      conflicts: conflictCount,
      identical: identicalCount,
      unexpected: unexpectedCount,
    },
  };
}
