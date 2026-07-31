// Server-only. Metadata re-resolution — the step between "verified copy"
// and "activation". Never trusts the copy/verify phases' own bookkeeping as
// final: re-fetches fresh metadata (id, rev, content_hash, size,
// path_display, path_lower) from the destination namespace for every
// VERIFIED ledger row, then writes it into the one business table that
// owns that path. Content hash/original size are NOT touched (they were
// never namespace-scoped and are already correct from creation time) —
// only the namespace-scoped identity fields (Dropbox id, paths, revision)
// are re-derived here, per the spec's "do not blindly copy old
// namespace-scoped IDs" requirement.
//
// Idempotent by construction: re-running writes the same correct values
// again, so a partial/interrupted run is always safe to resume by simply
// calling this again.
import { prisma } from "@/lib/prisma";
import { getDropboxEnv } from "../constants";
import { getMigrationDestinationClient, mapMigrationError } from "./config";
import { runInBatches } from "./batch";
import { withRateLimitBackoff } from "../rateLimitRetry";
import type { MigrationActionResult } from "./types";
import type { Dropbox } from "dropbox";
import type { DropboxMigrationObjectLedgerModel } from "@/generated/prisma/models";

type FreshFileMeta = { id: string | null; rev: string | null; pathDisplay: string; pathLower: string; contentHash: string | null; size: number | null };
type FreshFolderMeta = { id: string | null; pathDisplay: string; pathLower: string };

async function fetchFreshFolderMeta(client: Dropbox, path: string): Promise<FreshFolderMeta> {
  const meta = await withRateLimitBackoff(() => client.filesGetMetadata({ path }));
  if (meta.result[".tag"] !== "folder") {
    throw Object.assign(new Error("METADATA_RERESOLUTION_FAILED"), { code: "METADATA_RERESOLUTION_FAILED" });
  }
  return {
    id: meta.result.id ?? null,
    pathDisplay: meta.result.path_display ?? path,
    pathLower: meta.result.path_lower ?? path.toLowerCase(),
  };
}

async function fetchFreshFileMeta(client: Dropbox, path: string): Promise<FreshFileMeta> {
  const meta = await withRateLimitBackoff(() => client.filesGetMetadata({ path }));
  if (meta.result[".tag"] !== "file") {
    throw Object.assign(new Error("METADATA_RERESOLUTION_FAILED"), { code: "METADATA_RERESOLUTION_FAILED" });
  }
  const f = meta.result as { id?: string; rev?: string; path_display?: string; path_lower?: string; content_hash?: string; size?: number };
  return {
    id: f.id ?? null,
    rev: f.rev ?? null,
    pathDisplay: f.path_display ?? path,
    pathLower: f.path_lower ?? path.toLowerCase(),
    contentHash: f.content_hash ?? null,
    size: f.size ?? null,
  };
}

async function reresolveByKind(
  client: Dropbox,
  rows: DropboxMigrationObjectLedgerModel[],
  handler: (row: DropboxMigrationObjectLedgerModel) => Promise<void>
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;
  // Batch size 5, not the usual 15 — Stage D's copy phase empirically showed
  // this Dropbox app is rate-limited more aggressively than expected at
  // higher concurrency; combined with withRateLimitBackoff's per-call
  // retry above, a smaller burst size reduces how often that backoff needs
  // to trigger at all.
  await runInBatches(rows, async (row) => {
    try {
      await handler(row);
      succeeded++;
    } catch {
      failed++;
    }
  }, 5);
  return { succeeded, failed };
}

export type ReResolutionResult = { totalProcessed: number; succeeded: number; failed: number };

export async function runMetadataReResolution(jobId: string): Promise<MigrationActionResult<ReResolutionResult>> {
  const envResult = getDropboxEnv();
  if (!envResult.ok) return { success: false, error: "CONFIGURATION_MISSING" };

  let client: Dropbox;
  try {
    client = await getMigrationDestinationClient(envResult.config);
  } catch (err) {
    const mapped = mapMigrationError(err);
    return { success: false, error: mapped.code };
  }

  const verifiedRows = await prisma.dropboxMigrationObjectLedger.findMany({
    where: { migrationJobId: jobId, status: "VERIFIED" },
  });

  let succeeded = 0;
  let failed = 0;

  const byKind = new Map<string, DropboxMigrationObjectLedgerModel[]>();
  for (const row of verifiedRows) {
    const list = byKind.get(row.objectKind) ?? [];
    list.push(row);
    byKind.set(row.objectKind, list);
  }

  const customerFolders = byKind.get("CUSTOMER_FOLDER") ?? [];
  const r1 = await reresolveByKind(client, customerFolders, async (row) => {
    const fresh = await fetchFreshFolderMeta(client, row.destinationPath);
    await prisma.customerDropboxFolder.updateMany({
      where: { displayPath: row.sourcePath },
      data: { dropboxFolderId: fresh.id, displayPath: fresh.pathDisplay, pathLower: fresh.pathLower, syncStatus: "SYNCED", lastSyncedAt: new Date() },
    });
  });
  succeeded += r1.succeeded;
  failed += r1.failed;

  const customerDocs = byKind.get("CUSTOMER_DOCUMENT") ?? [];
  const r2 = await reresolveByKind(client, customerDocs, async (row) => {
    const fresh = await fetchFreshFileMeta(client, row.destinationPath);
    await prisma.customerDocumentDropboxSync.updateMany({
      where: { dropboxDisplayPath: row.sourcePath },
      data: { dropboxFileId: fresh.id, dropboxRevision: fresh.rev, dropboxDisplayPath: fresh.pathDisplay, dropboxPathLower: fresh.pathLower, syncStatus: "SYNCED", lastSyncedAt: new Date() },
    });
  });
  succeeded += r2.succeeded;
  failed += r2.failed;

  const quotationFolders = byKind.get("QUOTATION_BUSINESS_FOLDER") ?? [];
  const r3 = await reresolveByKind(client, quotationFolders, async (row) => {
    const fresh = await fetchFreshFolderMeta(client, row.destinationPath);
    await prisma.quotationDropboxBusinessFile.updateMany({
      where: { dropboxDisplayPath: row.sourcePath },
      data: { dropboxFolderId: fresh.id, dropboxDisplayPath: fresh.pathDisplay, dropboxPathLower: fresh.pathLower, syncStatus: "SYNCED", lastSyncedAt: new Date() },
    });
  });
  succeeded += r3.succeeded;
  failed += r3.failed;

  const quotationVersions = byKind.get("QUOTATION_VERSION_FILE") ?? [];
  const r4 = await reresolveByKind(client, quotationVersions, async (row) => {
    const fresh = await fetchFreshFileMeta(client, row.destinationPath);
    const byExcel = await prisma.quotationDropboxVersion.updateMany({
      where: { excelDropboxPath: row.sourcePath },
      data: { excelDropboxFileId: fresh.id, excelDropboxRevision: fresh.rev, excelDropboxPath: fresh.pathDisplay, excelSyncStatus: "SYNCED", lastSyncedAt: new Date() },
    });
    if (byExcel.count === 0) {
      await prisma.quotationDropboxVersion.updateMany({
        where: { pdfDropboxPath: row.sourcePath },
        data: { pdfDropboxFileId: fresh.id, pdfDropboxRevision: fresh.rev, pdfDropboxPath: fresh.pathDisplay, pdfSyncStatus: "SYNCED", lastSyncedAt: new Date() },
      });
    }
  });
  succeeded += r4.succeeded;
  failed += r4.failed;

  const policyFolders = byKind.get("POLICY_BUSINESS_FOLDER") ?? [];
  const r5 = await reresolveByKind(client, policyFolders, async (row) => {
    const fresh = await fetchFreshFolderMeta(client, row.destinationPath);
    await prisma.policyDropboxBusinessFile.updateMany({
      where: { dropboxDisplayPath: row.sourcePath },
      data: { dropboxFolderId: fresh.id, dropboxDisplayPath: fresh.pathDisplay, dropboxPathLower: fresh.pathLower, syncStatus: "SYNCED", lastSyncedAt: new Date() },
    });
  });
  succeeded += r5.succeeded;
  failed += r5.failed;

  const policyDocs = byKind.get("POLICY_DOCUMENT") ?? [];
  const r6 = await reresolveByKind(client, policyDocs, async (row) => {
    const fresh = await fetchFreshFileMeta(client, row.destinationPath);
    await prisma.policyDocumentDropboxSync.updateMany({
      where: { dropboxDisplayPath: row.sourcePath },
      data: {
        dropboxFileId: fresh.id,
        dropboxRevision: fresh.rev,
        dropboxDisplayPath: fresh.pathDisplay,
        dropboxPathLower: fresh.pathLower,
        syncStatus: "SYNCED",
        lastSyncedAt: new Date(),
      },
    });
  });
  succeeded += r6.succeeded;
  failed += r6.failed;

  const invoiceFolders = byKind.get("INVOICE_BUSINESS_FOLDER") ?? [];
  const r7 = await reresolveByKind(client, invoiceFolders, async (row) => {
    const fresh = await fetchFreshFolderMeta(client, row.destinationPath);
    await prisma.invoiceDropboxBusinessFile.updateMany({
      where: { dropboxDisplayPath: row.sourcePath },
      data: { dropboxFolderId: fresh.id, dropboxDisplayPath: fresh.pathDisplay, dropboxPathLower: fresh.pathLower, syncStatus: "SYNCED", lastSyncedAt: new Date() },
    });
  });
  succeeded += r7.succeeded;
  failed += r7.failed;

  const invoiceDocs = byKind.get("INVOICE_DOCUMENT") ?? [];
  const r8 = await reresolveByKind(client, invoiceDocs, async (row) => {
    const fresh = await fetchFreshFileMeta(client, row.destinationPath);
    await prisma.invoiceDocumentDropboxSync.updateMany({
      where: { dropboxDisplayPath: row.sourcePath },
      data: {
        dropboxFileId: fresh.id,
        dropboxRevision: fresh.rev,
        dropboxDisplayPath: fresh.pathDisplay,
        dropboxPathLower: fresh.pathLower,
        syncStatus: "SYNCED",
        lastSyncedAt: new Date(),
      },
    });
  });
  succeeded += r8.succeeded;
  failed += r8.failed;

  const motorClaimFolders = byKind.get("MOTOR_CLAIM_BUSINESS_FOLDER") ?? [];
  const r9 = await reresolveByKind(client, motorClaimFolders, async (row) => {
    const fresh = await fetchFreshFolderMeta(client, row.destinationPath);
    await prisma.motorClaimDropboxBusinessFile.updateMany({
      where: { dropboxDisplayPath: row.sourcePath },
      data: { dropboxFolderId: fresh.id, dropboxDisplayPath: fresh.pathDisplay, dropboxPathLower: fresh.pathLower, syncStatus: "SYNCED", lastSyncedAt: new Date() },
    });
  });
  succeeded += r9.succeeded;
  failed += r9.failed;

  const motorClaimDocs = byKind.get("MOTOR_CLAIM_DOCUMENT") ?? [];
  const r10 = await reresolveByKind(client, motorClaimDocs, async (row) => {
    const fresh = await fetchFreshFileMeta(client, row.destinationPath);
    await prisma.motorClaimDocumentDropboxSync.updateMany({
      where: { dropboxDisplayPath: row.sourcePath },
      data: {
        dropboxFileId: fresh.id,
        dropboxRevision: fresh.rev,
        dropboxDisplayPath: fresh.pathDisplay,
        dropboxPathLower: fresh.pathLower,
        syncStatus: "SYNCED",
        lastSyncedAt: new Date(),
      },
    });
  });
  succeeded += r10.succeeded;
  failed += r10.failed;

  const nonMotorClaimFolders = byKind.get("NON_MOTOR_CLAIM_BUSINESS_FOLDER") ?? [];
  const r11 = await reresolveByKind(client, nonMotorClaimFolders, async (row) => {
    const fresh = await fetchFreshFolderMeta(client, row.destinationPath);
    await prisma.nonMotorClaimDropboxBusinessFile.updateMany({
      where: { dropboxDisplayPath: row.sourcePath },
      data: { dropboxFolderId: fresh.id, dropboxDisplayPath: fresh.pathDisplay, dropboxPathLower: fresh.pathLower, syncStatus: "SYNCED", lastSyncedAt: new Date() },
    });
  });
  succeeded += r11.succeeded;
  failed += r11.failed;

  const nonMotorClaimDocs = byKind.get("NON_MOTOR_CLAIM_DOCUMENT") ?? [];
  const r12 = await reresolveByKind(client, nonMotorClaimDocs, async (row) => {
    const fresh = await fetchFreshFileMeta(client, row.destinationPath);
    await prisma.nonMotorClaimDocumentDropboxSync.updateMany({
      where: { dropboxDisplayPath: row.sourcePath },
      data: {
        dropboxFileId: fresh.id,
        dropboxRevision: fresh.rev,
        dropboxDisplayPath: fresh.pathDisplay,
        dropboxPathLower: fresh.pathLower,
        syncStatus: "SYNCED",
        lastSyncedAt: new Date(),
      },
    });
  });
  succeeded += r12.succeeded;
  failed += r12.failed;

  return { success: true, totalProcessed: verifiedRows.length, succeeded, failed };
}
