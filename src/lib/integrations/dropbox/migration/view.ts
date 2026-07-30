// Server-only. Builds the combined safe view the Settings page renders —
// never a raw namespace id, never anything beyond what toMigrationNamespaceView
// and this function's own mapping expose.
import { getNamespaceConfigRow, toMigrationNamespaceView, type DropboxMigrationNamespaceView } from "./config";
import { getLatestMigrationJob } from "./job";
import type { DropboxMigrationJobView } from "./types";
import type { DropboxMigrationJobModel } from "@/generated/prisma/models";

function toJobView(job: DropboxMigrationJobModel): DropboxMigrationJobView {
  return {
    id: job.id,
    status: job.status,
    currentPhase: job.currentPhase,
    sourceRootPath: job.sourceRootPath,
    destinationRootPath: job.destinationRootPath,
    previewResult: job.previewResult,
    previewSummary: job.previewSummary,
    previewTotals: {
      folders: job.previewTotalFolders,
      files: job.previewTotalFiles,
      bytes: job.previewTotalBytes !== null ? Number(job.previewTotalBytes) : null,
      customerFolders: job.previewCustomerFolders,
      customerDocuments: job.previewCustomerDocuments,
      quotationFolders: job.previewQuotationFolders,
      quotationFiles: job.previewQuotationFiles,
      policyFolders: job.previewPolicyFolders,
      policyFiles: job.previewPolicyFiles,
      invoiceFolders: job.previewInvoiceFolders,
      invoiceFiles: job.previewInvoiceFiles,
      motorClaimFolders: job.previewMotorClaimFolders,
      motorClaimFiles: job.previewMotorClaimFiles,
      nonMotorClaimFolders: job.previewNonMotorClaimFolders,
      nonMotorClaimFiles: job.previewNonMotorClaimFiles,
      unexpectedObjects: job.previewUnexpectedObjects,
      identicalDestinationObjects: job.previewIdenticalDestinationObjects,
      conflictObjects: job.previewConflictObjects,
    },
    safeErrorCode: job.safeErrorCode,
    safeErrorMessage: job.safeErrorMessage,
    startedAt: job.startedAt?.toISOString() ?? null,
    copiedAt: job.copiedAt?.toISOString() ?? null,
    verifiedAt: job.verifiedAt?.toISOString() ?? null,
    activatedAt: job.activatedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
  };
}

export type DropboxMigrationPageData = {
  namespace: DropboxMigrationNamespaceView;
  latestJob: DropboxMigrationJobView | null;
};

export async function getMigrationPageData(): Promise<DropboxMigrationPageData> {
  const [configRow, latestJob] = await Promise.all([getNamespaceConfigRow(), getLatestMigrationJob()]);
  return {
    namespace: toMigrationNamespaceView(configRow),
    latestJob: latestJob ? toJobView(latestJob) : null,
  };
}
