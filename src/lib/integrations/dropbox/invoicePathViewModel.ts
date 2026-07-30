// Server-only. Dropbox Integration Phase 6, Part 6/12 — assembles the safe,
// null-safe view model the Invoice detail page renders in its Dropbox
// section. Never returns a raw Dropbox id/token/local path — only
// DropboxPathView values (see pathDisplay.ts) and plain strings. Mirrors
// policyPathViewModel.ts, simplified: an Invoice has exactly one generated
// document (no per-document map needed).
import { prisma } from "@/lib/prisma";
import { getDropboxIntegrationRow } from "./service";
import { resolveInvoiceBusinessFileRefReadOnly, type InvoiceBusinessFileRef } from "./invoiceBusinessFile";
import { buildCustomerFolderName } from "./customer-folder-names";
import { buildStandardizedInvoiceFilename } from "./invoiceDocumentFilenames";
import { INVOICE_SUBFOLDER_NAME } from "./invoiceDocumentSync";
import { buildDropboxPathView, safeJoinPlannedPath, type DropboxPathView, type DropboxPathSyncStatus } from "./pathDisplay";

export type InvoiceDropboxViewModel = {
  dropboxConnected: boolean;
  source: InvoiceBusinessFileRef["source"];
  businessFolderName: string;
  businessFolder: DropboxPathView;
  invoiceFolder: DropboxPathView;
  invoiceFile: DropboxPathView;
  standardizedFileName: string | null;
  lastSyncedAt: string | null;
};

export async function buildInvoiceDropboxViewModel(invoiceId: string): Promise<InvoiceDropboxViewModel> {
  const [integration, invoice, ref] = await Promise.all([
    getDropboxIntegrationRow(),
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        invoiceNumber: true,
        generatedFileName: true,
        customer: { select: { customerNumber: true, companyName: true, dropboxFolder: true } },
        dropboxSync: true,
      },
    }),
    resolveInvoiceBusinessFileRefReadOnly(invoiceId),
  ]);
  const dropboxConnected = integration.status === "CONNECTED";

  const emptyView = buildDropboxPathView({ dropboxConnected, syncStatus: null, actualPath: null, plannedPath: null });
  if (!invoice || !ref) {
    return {
      dropboxConnected,
      source: "INVOICE_FALLBACK",
      businessFolderName: "",
      businessFolder: emptyView,
      invoiceFolder: emptyView,
      invoiceFile: emptyView,
      standardizedFileName: null,
      lastSyncedAt: null,
    };
  }

  const customerFolder = invoice.customer.dropboxFolder;
  const customerFolderPath =
    customerFolder?.syncStatus === "SYNCED" && customerFolder.displayPath
      ? customerFolder.displayPath
      : safeJoinPlannedPath(integration.rootFolder, `Customers/${buildCustomerFolderName(invoice.customer)}`);

  const businessFolderPlannedPath = customerFolderPath ? safeJoinPlannedPath(customerFolderPath, ref.businessFolderName) : null;
  const businessFolder = buildDropboxPathView({
    dropboxConnected,
    syncStatus: ref.syncStatus as DropboxPathSyncStatus,
    actualPath: ref.dropboxDisplayPath,
    plannedPath: businessFolderPlannedPath,
    errorMessage: ref.lastErrorMessage,
  });

  const sync = invoice.dropboxSync;
  const invoiceFolderActualPath =
    sync?.syncStatus === "SYNCED" && sync.dropboxDisplayPath ? parentDropboxPath(sync.dropboxDisplayPath) : null;
  const invoiceFolderPlannedPath = businessFolder.path ? safeJoinPlannedPath(businessFolder.path, INVOICE_SUBFOLDER_NAME) : null;
  const invoiceFolderSyncStatus: DropboxPathSyncStatus =
    sync?.syncStatus === "SYNCED" ? "SYNCED" : businessFolder.state === "not_connected" ? null : (ref.syncStatus as DropboxPathSyncStatus);
  const invoiceFolder = buildDropboxPathView({
    dropboxConnected,
    syncStatus: invoiceFolderSyncStatus,
    actualPath: invoiceFolderActualPath,
    plannedPath: invoiceFolderPlannedPath,
    errorMessage: businessFolder.errorMessage,
  });

  const standardizedFileName = sync?.standardizedFileName ?? (invoice.generatedFileName ? buildStandardizedInvoiceFilename(invoice.invoiceNumber, invoice.generatedFileName) : null);
  const invoiceFilePlannedPath =
    invoiceFolderPlannedPath && standardizedFileName ? safeJoinPlannedPath(invoiceFolderPlannedPath, standardizedFileName) : null;
  const invoiceFile = buildDropboxPathView({
    dropboxConnected,
    syncStatus: (sync?.syncStatus as DropboxPathSyncStatus) ?? null,
    actualPath: sync?.dropboxDisplayPath ?? null,
    plannedPath: invoiceFilePlannedPath,
    errorMessage: sync?.lastErrorMessage ?? null,
  });

  return {
    dropboxConnected,
    source: ref.source,
    businessFolderName: ref.businessFolderName,
    businessFolder,
    invoiceFolder,
    invoiceFile,
    standardizedFileName: sync?.standardizedFileName ?? null,
    lastSyncedAt: sync?.lastSyncedAt?.toISOString() ?? null,
  };
}

function parentDropboxPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : path;
}
