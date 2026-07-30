// Server-only. Post-copy verification — re-confirms each COPIED ledger
// row's destination metadata (existence, type, size, content hash for
// files) before the job is allowed to reach READY_TO_ACTIVATE.
// SKIPPED_IDENTICAL rows were already confirmed identical during preview's
// collision check, so they count as verified without a redundant call.
import { prisma } from "@/lib/prisma";
import { getDropboxEnv } from "../constants";
import { getMigrationDestinationClient, mapMigrationError } from "./config";
import { isNotFoundError } from "./notFound";
import { runInBatches, DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE } from "./batch";
import type { MigrationActionResult } from "./types";
import type { Dropbox } from "dropbox";
import type { DropboxMigrationObjectLedgerModel } from "@/generated/prisma/models";

async function verifyRow(client: Dropbox, row: DropboxMigrationObjectLedgerModel): Promise<void> {
  let meta;
  try {
    meta = await client.filesGetMetadata({ path: row.destinationPath });
  } catch (err) {
    if (isNotFoundError(err)) {
      throw Object.assign(new Error("VERIFICATION_INCOMPLETE"), { code: "VERIFICATION_INCOMPLETE" });
    }
    throw err;
  }

  if (row.objectType === "FOLDER") {
    if (meta.result[".tag"] !== "folder") {
      throw Object.assign(new Error("COPY_DESTINATION_MISMATCH"), { code: "COPY_DESTINATION_MISMATCH" });
    }
    return;
  }

  if (meta.result[".tag"] !== "file") {
    throw Object.assign(new Error("COPY_DESTINATION_MISMATCH"), { code: "COPY_DESTINATION_MISMATCH" });
  }
  const fileMeta = meta.result as { size?: number; content_hash?: string };
  if (row.expectedContentHash && fileMeta.content_hash !== row.expectedContentHash) {
    throw Object.assign(new Error("COPY_DESTINATION_MISMATCH"), { code: "COPY_DESTINATION_MISMATCH" });
  }
  if (row.expectedFileSize !== null && fileMeta.size !== undefined && BigInt(fileMeta.size) !== row.expectedFileSize) {
    throw Object.assign(new Error("COPY_DESTINATION_MISMATCH"), { code: "COPY_DESTINATION_MISMATCH" });
  }
}

export type VerificationBatchResult = {
  processed: number;
  verified: number;
  failed: number;
  remaining: number;
};

export async function runVerificationBatch(jobId: string, batchSize: number = DEFAULT_BATCH_SIZE): Promise<MigrationActionResult<VerificationBatchResult>> {
  const envResult = getDropboxEnv();
  if (!envResult.ok) return { success: false, error: "CONFIGURATION_MISSING" };

  const job = await prisma.dropboxMigrationJob.findUnique({ where: { id: jobId } });
  if (!job) return { success: false, error: "MIGRATION_JOB_NOT_FOUND" };

  let client: Dropbox;
  try {
    client = await getMigrationDestinationClient(envResult.config);
  } catch (err) {
    const mapped = mapMigrationError(err);
    return { success: false, error: mapped.code };
  }

  const size = Math.min(Math.max(1, batchSize), MAX_BATCH_SIZE);

  // SKIPPED_IDENTICAL rows are already-verified — mark them VERIFIED once,
  // no Dropbox call needed (their content was already confirmed identical
  // during the preview collision check).
  await prisma.dropboxMigrationObjectLedger.updateMany({
    where: { migrationJobId: jobId, status: "SKIPPED_IDENTICAL" },
    data: { status: "VERIFIED", verifiedAt: new Date() },
  });

  const rows = await prisma.dropboxMigrationObjectLedger.findMany({
    where: { migrationJobId: jobId, status: "COPIED" },
    orderBy: { sourcePath: "asc" },
    take: size,
  });

  let verified = 0;
  let failed = 0;

  await prisma.dropboxMigrationObjectLedger.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { status: "VERIFYING" },
  });

  await runInBatches(rows, async (row) => {
    try {
      await verifyRow(client, row);
      await prisma.dropboxMigrationObjectLedger.update({
        where: { id: row.id },
        data: { status: "VERIFIED", verifiedAt: new Date(), safeErrorCode: null, safeErrorMessage: null },
      });
      verified++;
    } catch (err) {
      const mapped = mapMigrationError(err);
      await prisma.dropboxMigrationObjectLedger.update({
        where: { id: row.id },
        data: { status: "FAILED", safeErrorCode: mapped.code, safeErrorMessage: mapped.message },
      });
      failed++;
    }
  }, size);

  const remaining = await prisma.dropboxMigrationObjectLedger.count({
    where: { migrationJobId: jobId, status: { in: ["COPIED", "VERIFYING"] } },
  });

  const unresolved = await prisma.dropboxMigrationObjectLedger.count({
    where: { migrationJobId: jobId, status: { in: ["DISCOVERED", "PENDING", "COPYING", "CONFLICT", "MISSING_SOURCE", "FAILED"] } },
  });

  const allVerified = remaining === 0 && unresolved === 0;

  await prisma.dropboxMigrationJob.update({
    where: { id: jobId },
    data: {
      status: allVerified ? "READY_TO_ACTIVATE" : remaining > 0 ? "VERIFYING" : "VERIFICATION_FAILED",
      currentPhase: "verify",
      verifiedAt: allVerified ? new Date() : job.verifiedAt,
    },
  });

  return { success: true, processed: rows.length, verified, failed, remaining: remaining + unresolved };
}

export type VerificationSummary = {
  verifiedFolders: number;
  verifiedFiles: number;
  verifiedBytes: number;
  missing: number;
  conflict: number;
  failed: number;
  skippedIdentical: number;
  unresolved: number;
  readyToActivate: boolean;
};

export async function getVerificationSummary(jobId: string): Promise<VerificationSummary> {
  const [verifiedFolders, verifiedFiles, verifiedBytesAgg, missing, conflict, failed, skippedIdentical, unresolved] = await Promise.all([
    prisma.dropboxMigrationObjectLedger.count({ where: { migrationJobId: jobId, status: "VERIFIED", objectType: "FOLDER" } }),
    prisma.dropboxMigrationObjectLedger.count({ where: { migrationJobId: jobId, status: "VERIFIED", objectType: "FILE" } }),
    prisma.dropboxMigrationObjectLedger.aggregate({
      where: { migrationJobId: jobId, status: "VERIFIED", objectType: "FILE" },
      _sum: { expectedFileSize: true },
    }),
    prisma.dropboxMigrationObjectLedger.count({ where: { migrationJobId: jobId, status: "MISSING_SOURCE" } }),
    prisma.dropboxMigrationObjectLedger.count({ where: { migrationJobId: jobId, status: "CONFLICT" } }),
    prisma.dropboxMigrationObjectLedger.count({ where: { migrationJobId: jobId, status: "FAILED" } }),
    prisma.dropboxMigrationObjectLedger.count({ where: { migrationJobId: jobId, status: "SKIPPED_IDENTICAL" } }),
    prisma.dropboxMigrationObjectLedger.count({
      where: { migrationJobId: jobId, status: { in: ["DISCOVERED", "PENDING", "COPYING", "COPIED", "VERIFYING", "CONFLICT", "MISSING_SOURCE", "FAILED"] } },
    }),
  ]);

  return {
    verifiedFolders,
    verifiedFiles,
    verifiedBytes: Number(verifiedBytesAgg._sum.expectedFileSize ?? BigInt(0)),
    missing,
    conflict,
    failed,
    skippedIdentical,
    unresolved,
    readyToActivate: unresolved === 0,
  };
}
