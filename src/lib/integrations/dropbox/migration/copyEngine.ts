// Server-only. The resumable copy phase.
//
// Folders are handled with a plain check-then-create (ensureFolder-style,
// matching this codebase's existing convention) — an empty folder has no
// content to preserve, so there is nothing copy_reference buys here beyond
// what create_folder_v2 already gives for free, idempotently.
//
// Files use Dropbox's files/copy_reference/get (source client) +
// files/copy_reference/save (destination client) — the documented
// mechanism for copying content across namespaces/accounts without
// downloading and re-uploading through this application. copy_reference is
// scoped by files.content.write, already part of this app's existing OAuth
// grant (see constants.ts's DROPBOX_SCOPES) — no scope change required.
import { prisma } from "@/lib/prisma";
import { getDropboxEnv } from "../constants";
import { getMigrationSourceClient, getMigrationDestinationClient, acquireMigrationLock, mapMigrationError } from "./config";
import { isNotFoundError } from "./notFound";
import { runInBatches, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE } from "./batch";
import type { MigrationActionResult } from "./types";
import type { Dropbox } from "dropbox";
import type { DropboxMigrationObjectLedgerModel } from "@/generated/prisma/models";
import { withRateLimitBackoff } from "../rateLimitRetry";

export async function startCopyPhase(jobId: string): Promise<MigrationActionResult<{ started: true }>> {
  const job = await prisma.dropboxMigrationJob.findUnique({ where: { id: jobId } });
  if (!job) return { success: false, error: "MIGRATION_JOB_NOT_FOUND" };

  await acquireMigrationLock();
  await prisma.dropboxMigrationJob.update({
    where: { id: jobId },
    data: { status: "COPYING", currentPhase: "copy", startedAt: job.startedAt ?? new Date() },
  });
  return { success: true, started: true };
}

export async function pauseCopyPhase(jobId: string): Promise<MigrationActionResult<{ paused: true }>> {
  const job = await prisma.dropboxMigrationJob.findUnique({ where: { id: jobId } });
  if (!job) return { success: false, error: "MIGRATION_JOB_NOT_FOUND" };
  // Deliberately does NOT release the migration lock — normal application
  // Dropbox writes stay paused for the whole migration window, not just
  // while a copy batch is actively running.
  await prisma.dropboxMigrationJob.update({ where: { id: jobId }, data: { status: "COPY_PAUSED" } });
  return { success: true, paused: true };
}

async function ensureDestinationFolder(client: Dropbox, path: string): Promise<{ id: string | null }> {
  try {
    // Phase 8 Part 8: bounded backoff on Dropbox rate-limit (429) responses
    // — Stage D's copy phase is the case that originally showed this app
    // gets rate-limited more than expected.
    const meta = await withRateLimitBackoff(() => client.filesGetMetadata({ path }));
    if (meta.result[".tag"] !== "folder") {
      throw Object.assign(new Error("COPY_DESTINATION_MISMATCH"), { code: "COPY_DESTINATION_MISMATCH" });
    }
    return { id: meta.result.id ?? null };
  } catch (err) {
    if (isNotFoundError(err)) {
      const created = await withRateLimitBackoff(() => client.filesCreateFolderV2({ path, autorename: false }));
      return { id: created.result.metadata.id ?? null };
    }
    throw err;
  }
}

async function copyFileViaReference(
  sourceClient: Dropbox,
  destinationClient: Dropbox,
  row: DropboxMigrationObjectLedgerModel
): Promise<{ id: string | null; contentHash?: string; size?: number }> {
  // Already present at destination with matching content (checked during
  // preview) — nothing to copy.
  try {
    const existing = await withRateLimitBackoff(() => destinationClient.filesGetMetadata({ path: row.destinationPath }));
    if (existing.result[".tag"] === "file") {
      const fileMeta = existing.result as { size?: number; content_hash?: string; id?: string };
      if (row.expectedContentHash && fileMeta.content_hash === row.expectedContentHash) {
        return { id: fileMeta.id ?? null, contentHash: fileMeta.content_hash, size: fileMeta.size };
      }
      throw Object.assign(new Error("COPY_CONFLICT"), { code: "COPY_CONFLICT" });
    }
    if (existing.result[".tag"] === "folder") {
      throw Object.assign(new Error("COPY_DESTINATION_MISMATCH"), { code: "COPY_DESTINATION_MISMATCH" });
    }
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
  }

  const sourcePathOrId = row.sourceId ?? row.sourcePath;
  let getRefResult;
  try {
    getRefResult = await withRateLimitBackoff(() => sourceClient.filesCopyReferenceGet({ path: sourcePathOrId }));
  } catch (err) {
    if (isNotFoundError(err)) {
      throw Object.assign(new Error("COPY_SOURCE_MISSING"), { code: "COPY_SOURCE_MISSING" });
    }
    throw err;
  }

  const saved = await withRateLimitBackoff(() =>
    destinationClient.filesCopyReferenceSave({
      copy_reference: getRefResult.result.copy_reference,
      path: row.destinationPath,
    })
  );

  const metadata = saved.result.metadata;
  if (metadata[".tag"] !== "file") {
    throw Object.assign(new Error("COPY_DESTINATION_MISMATCH"), { code: "COPY_DESTINATION_MISMATCH" });
  }
  return { id: metadata.id ?? null, contentHash: metadata.content_hash, size: metadata.size };
}

export type CopyBatchResult = {
  processed: number;
  succeeded: number;
  failed: number;
  remainingFolders: number;
  remainingFiles: number;
  phaseComplete: boolean;
};

// Processes exactly one bounded batch (folders exhausted before files
// begin, so parents always exist before their children/files are touched)
// and returns — the Settings UI calls this repeatedly ("Resume Copy") the
// same way existing per-entity backfill actions are already driven,
// matching this codebase's established click-driven-batch convention
// rather than introducing a new background worker.
export async function runCopyBatch(jobId: string, batchSize: number = DEFAULT_BATCH_SIZE): Promise<MigrationActionResult<CopyBatchResult>> {
  const envResult = getDropboxEnv();
  if (!envResult.ok) return { success: false, error: "CONFIGURATION_MISSING" };

  const job = await prisma.dropboxMigrationJob.findUnique({ where: { id: jobId } });
  if (!job) return { success: false, error: "MIGRATION_JOB_NOT_FOUND" };

  let sourceClient: Dropbox;
  let destinationClient: Dropbox;
  try {
    sourceClient = (await getMigrationSourceClient(envResult.config)).client;
    destinationClient = await getMigrationDestinationClient(envResult.config);
  } catch (err) {
    const mapped = mapMigrationError(err);
    return { success: false, error: mapped.code };
  }

  const size = Math.min(Math.max(1, batchSize), MAX_BATCH_SIZE);

  const remainingFolders = await prisma.dropboxMigrationObjectLedger.count({
    where: { migrationJobId: jobId, objectType: "FOLDER", status: { in: ["DISCOVERED", "FAILED"] } },
  });

  let succeeded = 0;
  let failed = 0;
  let processed = 0;

  if (remainingFolders > 0) {
    const rows = await prisma.dropboxMigrationObjectLedger.findMany({
      where: { migrationJobId: jobId, objectType: "FOLDER", status: { in: ["DISCOVERED", "FAILED"] } },
      orderBy: { sourcePath: "asc" }, // shorter/shallower paths sort first, so parents precede children
      take: size,
    });
    processed = rows.length;
    await runInBatches(rows, async (row) => {
      await prisma.dropboxMigrationObjectLedger.update({ where: { id: row.id }, data: { status: "COPYING", attemptCount: { increment: 1 } } });
      try {
        const result = await ensureDestinationFolder(destinationClient, row.destinationPath);
        await prisma.dropboxMigrationObjectLedger.update({
          where: { id: row.id },
          data: { status: "COPIED", destinationId: result.id, copiedAt: new Date(), safeErrorCode: null, safeErrorMessage: null },
        });
        succeeded++;
      } catch (err) {
        const mapped = mapMigrationError(err);
        await prisma.dropboxMigrationObjectLedger.update({
          where: { id: row.id },
          data: { status: mapped.code === "COPY_SOURCE_MISSING" ? "MISSING_SOURCE" : "FAILED", safeErrorCode: mapped.code, safeErrorMessage: mapped.message },
        });
        failed++;
      }
    }, size);
  } else {
    const rows = await prisma.dropboxMigrationObjectLedger.findMany({
      where: { migrationJobId: jobId, objectType: "FILE", status: { in: ["DISCOVERED", "FAILED"] } },
      orderBy: { sourcePath: "asc" },
      take: size,
    });
    processed = rows.length;
    await runInBatches(rows, async (row) => {
      await prisma.dropboxMigrationObjectLedger.update({ where: { id: row.id }, data: { status: "COPYING", attemptCount: { increment: 1 } } });
      try {
        const result = await copyFileViaReference(sourceClient, destinationClient, row);
        await prisma.dropboxMigrationObjectLedger.update({
          where: { id: row.id },
          data: {
            status: "COPIED",
            destinationId: result.id,
            copiedAt: new Date(),
            expectedContentHash: row.expectedContentHash ?? result.contentHash ?? null,
            expectedFileSize: row.expectedFileSize ?? (result.size !== undefined ? BigInt(result.size) : null),
            safeErrorCode: null,
            safeErrorMessage: null,
          },
        });
        succeeded++;
      } catch (err) {
        const mapped = mapMigrationError(err);
        await prisma.dropboxMigrationObjectLedger.update({
          where: { id: row.id },
          data: { status: mapped.code === "COPY_SOURCE_MISSING" ? "MISSING_SOURCE" : "FAILED", safeErrorCode: mapped.code, safeErrorMessage: mapped.message },
        });
        failed++;
      }
    }, size);
  }

  const stillRemainingFolders = await prisma.dropboxMigrationObjectLedger.count({
    where: { migrationJobId: jobId, objectType: "FOLDER", status: { in: ["DISCOVERED", "FAILED"] } },
  });
  const stillRemainingFiles = await prisma.dropboxMigrationObjectLedger.count({
    where: { migrationJobId: jobId, objectType: "FILE", status: { in: ["DISCOVERED", "FAILED"] } },
  });
  const phaseComplete = stillRemainingFolders === 0 && stillRemainingFiles === 0;

  await prisma.dropboxMigrationJob.update({
    where: { id: jobId },
    data: { status: phaseComplete ? "COPY_COMPLETE" : failed > 0 ? "COPY_FAILED" : "COPYING", copiedAt: phaseComplete ? new Date() : job.copiedAt },
  });

  return {
    success: true,
    processed,
    succeeded,
    failed,
    remainingFolders: stillRemainingFolders,
    remainingFiles: stillRemainingFiles,
    phaseComplete,
  };
}
