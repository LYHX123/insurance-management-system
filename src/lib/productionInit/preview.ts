import { prisma } from "@/lib/prisma";
import { SYSTEM_SETTINGS_ID } from "@/lib/settings/constants";
import { DROPBOX_INTEGRATION_ID, DROPBOX_NAMESPACE_CONFIG_ID } from "@/lib/integrations/dropbox/constants";
import type { Prisma } from "@/generated/prisma/client";
import type { ProductionInitPreview } from "./types";

// Read-only. Every count below is a single, independent COUNT query run in
// parallel via Promise.all (never a loop over rows) — this function never
// writes anything. Accepts either the top-level `prisma` client or an
// interactive transaction's `tx` handle, so execute.ts can call this SAME
// function inside its deletion transaction (to snapshot "about to delete"
// counts atomically alongside the actual deletes) instead of duplicating
// the query list.
export async function getProductionInitializationPreview(
  client: Prisma.TransactionClient = prisma
): Promise<ProductionInitPreview> {
  const [
    customers,
    customerProjects,
    customerDocuments,
    quotationCases,
    quotationRevisions,
    policies,
    invoices,
    tasks,
    motorClaims,
    nonMotorClaims,
    manualLedgerEntries,
    policyImportBatches,
    policyImportRows,
    quotationDocuments,
    policyDocuments,
    motorClaimDocuments,
    nonMotorClaimDocuments,
    // Business Dropbox mapping records — every table that maps a Dropbox
    // path/file/folder identity onto a business record (never the
    // DropboxIntegration/DropboxNamespaceConfig connection config itself).
    customerDropboxFolders,
    customerDocumentDropboxSyncs,
    quotationDropboxBusinessFiles,
    quotationDropboxVersions,
    policyDropboxBusinessFiles,
    policyDocumentDropboxSyncs,
    invoiceDropboxBusinessFiles,
    invoiceDocumentDropboxSyncs,
    motorClaimDropboxBusinessFiles,
    nonMotorClaimDropboxBusinessFiles,
    motorClaimDocumentDropboxSyncs,
    nonMotorClaimDocumentDropboxSyncs,
    // Number counters — row counts only (the tables themselves are kept).
    quotationNumberCounterRows,
    policyRecordNumberCounterRows,
    invoiceNumberCounterRows,
    motorClaimNumberCounterRows,
    nonMotorClaimNumberCounterRows,
    // Preserved
    users,
    systemSettings,
    dropboxIntegration,
    dropboxNamespaceConfig,
    insuranceTypes,
    ledgerCategories,
    dropboxMigrationJobs,
    dropboxMigrationObjectLedgers,
  ] = await Promise.all([
    client.customer.count(),
    client.customerProject.count(),
    client.customerDocument.count(),
    client.quotationCase.count(),
    client.quotation.count(),
    client.policyRecord.count(),
    client.invoice.count(),
    client.task.count(),
    client.motorClaim.count(),
    client.nonMotorClaim.count(),
    client.ledgerManualEntry.count(),
    client.policyImportBatch.count(),
    client.policyImportRow.count(),
    client.quotationDocument.count(),
    client.policyDocument.count(),
    client.motorClaimDocument.count(),
    client.nonMotorClaimDocument.count(),
    client.customerDropboxFolder.count(),
    client.customerDocumentDropboxSync.count(),
    client.quotationDropboxBusinessFile.count(),
    client.quotationDropboxVersion.count(),
    client.policyDropboxBusinessFile.count(),
    client.policyDocumentDropboxSync.count(),
    client.invoiceDropboxBusinessFile.count(),
    client.invoiceDocumentDropboxSync.count(),
    client.motorClaimDropboxBusinessFile.count(),
    client.nonMotorClaimDropboxBusinessFile.count(),
    client.motorClaimDocumentDropboxSync.count(),
    client.nonMotorClaimDocumentDropboxSync.count(),
    client.quotationNumberCounter.count(),
    client.policyRecordNumberCounter.count(),
    client.invoiceNumberCounter.count(),
    client.motorClaimNumberCounter.count(),
    client.nonMotorClaimNumberCounter.count(),
    client.user.count(),
    client.systemSettings.findUnique({ where: { id: SYSTEM_SETTINGS_ID }, select: { id: true } }),
    client.dropboxIntegration.findUnique({ where: { id: DROPBOX_INTEGRATION_ID }, select: { id: true } }),
    client.dropboxNamespaceConfig.findUnique({ where: { id: DROPBOX_NAMESPACE_CONFIG_ID }, select: { id: true } }),
    client.insuranceType.count(),
    client.ledgerCategory.count(),
    client.dropboxMigrationJob.count(),
    client.dropboxMigrationObjectLedger.count(),
  ]);

  const dropboxMappingRecords =
    customerDropboxFolders +
    customerDocumentDropboxSyncs +
    quotationDropboxBusinessFiles +
    quotationDropboxVersions +
    policyDropboxBusinessFiles +
    policyDocumentDropboxSyncs +
    invoiceDropboxBusinessFiles +
    invoiceDocumentDropboxSyncs +
    motorClaimDropboxBusinessFiles +
    nonMotorClaimDropboxBusinessFiles +
    motorClaimDocumentDropboxSyncs +
    nonMotorClaimDocumentDropboxSyncs;

  const numberCounterRows =
    quotationNumberCounterRows + policyRecordNumberCounterRows + invoiceNumberCounterRows + motorClaimNumberCounterRows + nonMotorClaimNumberCounterRows;

  const businessDocumentRecordsTotal = quotationDocuments + policyDocuments + motorClaimDocuments + nonMotorClaimDocuments;

  return {
    toDelete: {
      customers,
      customerProjects,
      customerDocuments,
      quotationCases,
      quotationRevisions,
      policies,
      invoices,
      tasks,
      motorClaims,
      nonMotorClaims,
      manualLedgerEntries,
      policyImportBatches,
      policyImportRows,
      quotationDocuments,
      policyDocuments,
      motorClaimDocuments,
      nonMotorClaimDocuments,
      businessDocumentRecordsTotal,
      dropboxMappingRecords,
      numberCounterRows,
    },
    toPreserve: {
      users,
      systemSettingsExists: !!systemSettings,
      dropboxIntegrationExists: !!dropboxIntegration,
      dropboxNamespaceConfigExists: !!dropboxNamespaceConfig,
      insuranceTypes,
      ledgerCategories,
      dropboxMigrationJobs,
      dropboxMigrationObjectLedgers,
    },
  };
}
