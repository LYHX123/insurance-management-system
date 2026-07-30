import type { DropboxErrorCode } from "../errors";
import type { DropboxMigrationStatus, DropboxMigrationPreviewResult } from "@/generated/prisma/enums";

export type MigrationActionResult<T = object> =
  | ({ success: true } & T)
  | { success: false; error: DropboxErrorCode };

// Safe, browser-facing view of a migration job — never a raw namespace id,
// never a raw Dropbox object id beyond what's already safe to show (folder
// ids are not secrets, but this view still only carries what Settings
// actually renders).
export type DropboxMigrationJobView = {
  id: string;
  status: DropboxMigrationStatus;
  currentPhase: string | null;
  sourceRootPath: string;
  destinationRootPath: string;
  previewResult: DropboxMigrationPreviewResult | null;
  previewSummary: string | null;
  previewTotals: {
    folders: number | null;
    files: number | null;
    bytes: number | null;
    customerFolders: number | null;
    customerDocuments: number | null;
    quotationFolders: number | null;
    quotationFiles: number | null;
    policyFolders: number | null;
    policyFiles: number | null;
    invoiceFolders: number | null;
    invoiceFiles: number | null;
    motorClaimFolders: number | null;
    motorClaimFiles: number | null;
    nonMotorClaimFolders: number | null;
    nonMotorClaimFiles: number | null;
    unexpectedObjects: number | null;
    identicalDestinationObjects: number | null;
    conflictObjects: number | null;
  };
  safeErrorCode: string | null;
  safeErrorMessage: string | null;
  startedAt: string | null;
  copiedAt: string | null;
  verifiedAt: string | null;
  activatedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type LedgerCounts = Record<string, number>;
