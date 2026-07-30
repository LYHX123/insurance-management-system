// Server-only. Activation — the one-way switch from Home namespace to the
// destination Team Folder namespace, gated behind typed confirmation and an
// explicit DB-backup attestation. Runs the Part 10 sequence in order:
// re-resolve metadata -> switch active namespace/root -> release the
// migration lock -> replay pending sync (via each module's EXISTING
// "retry-failed" backfill batch runner — no new replay-queue machinery;
// every record that was blocked by MIGRATION_LOCKED during the lock window
// is, by construction, sitting in ERROR/ syncStatus with that safe error
// code, which is exactly what "retry-failed" already knows how to find).
import { prisma } from "@/lib/prisma";
import { DROPBOX_NAMESPACE_CONFIG_ID } from "../constants";
import { getNamespaceConfigRow, releaseMigrationLock } from "./config";
import { runMetadataReResolution } from "./reresolve";
import { getVerificationSummary } from "./verify";
import { runCustomerFolderBackfillBatch } from "../customer-folders";
import { runCustomerDocumentBackfillBatch } from "../customerDocumentSync";
import { runQuotationBackfillBatch } from "../quotationDropboxSync";
import { runPolicyDocumentBackfillBatch } from "../policyDocumentSync";
import { runInvoiceDocumentBackfillBatch } from "../invoiceDocumentSync";
import { runMotorClaimDocumentBackfillBatch } from "../motorClaimDocumentSync";
import { runNonMotorClaimDocumentBackfillBatch } from "../nonMotorClaimDocumentSync";
import type { MigrationActionResult } from "./types";

const ACTIVATION_CONFIRMATION_TEXT = "ACTIVATE ENFB SYSTEM FILE";

export type ActivationResult = {
  activated: boolean;
  alreadyActive?: boolean;
  reresolved: { succeeded: number; failed: number };
  replaySummary: Record<string, number>;
};

// dbBackupConfirmed is a human attestation (an admin-checked checkbox in
// Settings), not something this server process can verify by inspecting
// the filesystem/Docker volume itself — that would be the wrong
// architectural layer for a Next.js server action.
export async function activateDestinationNamespace(
  jobId: string,
  confirmationText: string,
  dbBackupConfirmed: boolean
): Promise<MigrationActionResult<ActivationResult>> {
  if (confirmationText.trim() !== ACTIVATION_CONFIRMATION_TEXT) return { success: false, error: "ACTIVATION_BLOCKED" };
  if (!dbBackupConfirmed) return { success: false, error: "ACTIVATION_BLOCKED" };

  const job = await prisma.dropboxMigrationJob.findUnique({ where: { id: jobId } });
  if (!job) return { success: false, error: "MIGRATION_JOB_NOT_FOUND" };

  if (job.status === "ACTIVE" || job.status === "COMPLETED") {
    return { success: true, activated: true, alreadyActive: true, reresolved: { succeeded: 0, failed: 0 }, replaySummary: {} };
  }
  if (job.status !== "READY_TO_ACTIVATE") {
    return { success: false, error: "ACTIVATION_BLOCKED" };
  }

  const verification = await getVerificationSummary(jobId);
  if (!verification.readyToActivate) return { success: false, error: "VERIFICATION_INCOMPLETE" };

  await prisma.dropboxMigrationJob.update({ where: { id: jobId }, data: { status: "ACTIVATING", currentPhase: "activate" } });

  const reresolveResult = await runMetadataReResolution(jobId);
  if (!reresolveResult.success) {
    await prisma.dropboxMigrationJob.update({
      where: { id: jobId },
      data: { status: "READY_TO_ACTIVATE", safeErrorCode: "METADATA_RERESOLUTION_FAILED", safeErrorMessage: "Metadata re-resolution failed before activation." },
    });
    return { success: false, error: "METADATA_RERESOLUTION_FAILED" };
  }
  if (reresolveResult.failed > 0) {
    await prisma.dropboxMigrationJob.update({
      where: { id: jobId },
      data: {
        status: "READY_TO_ACTIVATE",
        safeErrorCode: "METADATA_RERESOLUTION_FAILED",
        safeErrorMessage: `${reresolveResult.failed} record(s) failed metadata re-resolution — resolve and retry before activating.`,
      },
    });
    return { success: false, error: "METADATA_RERESOLUTION_FAILED" };
  }

  const namespaceConfig = await getNamespaceConfigRow();
  await prisma.dropboxNamespaceConfig.update({
    where: { id: DROPBOX_NAMESPACE_CONFIG_ID },
    data: {
      activeNamespaceMode: "TEAM_FOLDER_NAMESPACE",
      activeRootFolder: namespaceConfig.destinationRootFolder,
      activatedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });

  await releaseMigrationLock();

  // Replay pending sync — one bounded "retry-failed" batch per module,
  // reusing existing, already-tested backfill machinery. Any record beyond
  // this one batch's limit simply remains ERROR/MIGRATION_LOCKED and is
  // picked up by the module's normal existing "Retry Failed" Settings
  // button exactly as it already works today — no behavior change there.
  const replaySummary: Record<string, number> = {};
  try {
    replaySummary.customerFolders = (await runCustomerFolderBackfillBatch("retry-failed")).results.length;
    replaySummary.customerDocuments = (await runCustomerDocumentBackfillBatch("retry-failed")).results.length;
    replaySummary.quotations = (await runQuotationBackfillBatch("retry-failed")).results.length;
    replaySummary.policyDocuments = (await runPolicyDocumentBackfillBatch("retry-failed")).results.length;
    replaySummary.invoiceDocuments = (await runInvoiceDocumentBackfillBatch("retry-failed")).results.length;
    replaySummary.motorClaimDocuments = (await runMotorClaimDocumentBackfillBatch("retry-failed")).results.length;
    replaySummary.nonMotorClaimDocuments = (await runNonMotorClaimDocumentBackfillBatch("retry-failed")).results.length;
  } catch {
    // Replay is best-effort and non-blocking for activation itself —
    // activation has already succeeded at this point (namespace switched,
    // lock released); a replay hiccup is surfaced via safeErrorCode but
    // does not roll back the switch (Part 12: no blind reverse moves).
    await prisma.dropboxMigrationJob.update({
      where: { id: jobId },
      data: { safeErrorCode: "PENDING_SYNC_REPLAY_FAILED", safeErrorMessage: "Some pending Dropbox syncs could not be replayed automatically — use each module's existing Retry Failed action." },
    });
  }

  await prisma.dropboxMigrationJob.update({
    where: { id: jobId },
    data: { status: "COMPLETED", activatedAt: new Date(), completedAt: new Date() },
  });

  return { success: true, activated: true, reresolved: { succeeded: reresolveResult.succeeded, failed: reresolveResult.failed }, replaySummary };
}
