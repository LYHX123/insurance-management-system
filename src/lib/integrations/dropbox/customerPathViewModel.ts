// Server-only. Dropbox Integration Phase 5, Part 9 — assembles the safe
// path-display view model for the Customer detail page: the customer
// folder itself, its two standard subfolders, and each CustomerDocument's
// own file path. Never modifies existing Customer sync behavior — pure
// reads plus the same deterministic naming helpers Phase 2/3 already use.
import { prisma } from "@/lib/prisma";
import { getDropboxIntegrationRow } from "./service";
import { buildCustomerFolderName } from "./customer-folder-names";
import { buildStandardizedDropboxFilename } from "./customerDocumentFilenames";
import { buildDropboxPathView, safeJoinPlannedPath, type DropboxPathView, type DropboxPathSyncStatus } from "./pathDisplay";
import type { CustomerDocumentType } from "@/generated/prisma/enums";

const CUSTOMER_DOCUMENTS_SUBFOLDER = "Customer Documents";
const GENERAL_DOCUMENTS_SUBFOLDER = "General Documents";

export type CustomerDropboxPathViewModel = {
  dropboxConnected: boolean;
  customerFolder: DropboxPathView;
  customerDocumentsFolder: DropboxPathView;
  generalDocumentsFolder: DropboxPathView;
  documents: Record<string, DropboxPathView>;
};

export async function buildCustomerDropboxPathViewModel(customerId: string): Promise<CustomerDropboxPathViewModel> {
  const integration = await getDropboxIntegrationRow();
  const dropboxConnected = integration.status === "CONNECTED";

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      customerNumber: true,
      companyName: true,
      dropboxFolder: true,
      documents: { select: { id: true, projectId: true, documentType: true, originalFileName: true, mimeType: true, dropboxSync: true } },
    },
  });

  const emptyView = buildDropboxPathView({ dropboxConnected, syncStatus: null, actualPath: null, plannedPath: null });
  if (!customer) {
    return { dropboxConnected, customerFolder: emptyView, customerDocumentsFolder: emptyView, generalDocumentsFolder: emptyView, documents: {} };
  }

  const customerFolderPlannedPath = safeJoinPlannedPath(integration.rootFolder, `Customers/${buildCustomerFolderName(customer)}`);
  const customerFolder = buildDropboxPathView({
    dropboxConnected,
    syncStatus: (customer.dropboxFolder?.syncStatus as DropboxPathSyncStatus) ?? null,
    actualPath: customer.dropboxFolder?.displayPath ?? null,
    plannedPath: customerFolderPlannedPath,
    errorMessage: customer.dropboxFolder?.lastErrorMessage ?? null,
  });

  // The two standard subfolders are ensured together with the customer
  // folder itself every sync (see customer-folders.ts's
  // ensureStandardSubfolders) — no separate DB row tracks each one, so
  // display mirrors the parent folder's own state.
  const subfolderActualBase = customerFolder.state === "synced" && customerFolder.path ? customerFolder.path : null;
  const customerDocumentsFolder = buildDropboxPathView({
    dropboxConnected,
    syncStatus: customerFolder.state === "synced" ? "SYNCED" : (customer.dropboxFolder?.syncStatus as DropboxPathSyncStatus) ?? null,
    actualPath: subfolderActualBase ? safeJoinPlannedPath(subfolderActualBase, CUSTOMER_DOCUMENTS_SUBFOLDER) : null,
    plannedPath: customerFolder.path ? safeJoinPlannedPath(customerFolder.path, CUSTOMER_DOCUMENTS_SUBFOLDER) : null,
    errorMessage: customerFolder.errorMessage,
  });
  const generalDocumentsFolder = buildDropboxPathView({
    dropboxConnected,
    syncStatus: customerFolder.state === "synced" ? "SYNCED" : (customer.dropboxFolder?.syncStatus as DropboxPathSyncStatus) ?? null,
    actualPath: subfolderActualBase ? safeJoinPlannedPath(subfolderActualBase, GENERAL_DOCUMENTS_SUBFOLDER) : null,
    plannedPath: customerFolder.path ? safeJoinPlannedPath(customerFolder.path, GENERAL_DOCUMENTS_SUBFOLDER) : null,
    errorMessage: customerFolder.errorMessage,
  });

  // Best-effort preview name for documents never synced yet — see
  // policyPathViewModel.ts's identical caveat: the actual assigned name may
  // differ once collision resolution runs for real at sync time.
  const existingNamesLower = new Set(customer.documents.filter((d) => d.dropboxSync).map((d) => d.dropboxSync!.standardizedFileName.toLowerCase()));

  const documents: Record<string, DropboxPathView> = {};
  for (const doc of customer.documents) {
    const subfolderView = doc.projectId ? generalDocumentsFolder : customerDocumentsFolder;
    const standardizedFileName =
      doc.dropboxSync?.standardizedFileName ??
      buildStandardizedDropboxFilename({
        documentType: doc.documentType as CustomerDocumentType,
        originalFileName: doc.originalFileName,
        mimeType: doc.mimeType,
        existingStandardizedNamesLower: existingNamesLower,
      });
    const plannedPath = subfolderView.path ? safeJoinPlannedPath(subfolderView.path, standardizedFileName) : null;
    documents[doc.id] = buildDropboxPathView({
      dropboxConnected,
      syncStatus: (doc.dropboxSync?.syncStatus as DropboxPathSyncStatus) ?? null,
      actualPath: doc.dropboxSync?.dropboxDisplayPath ?? null,
      plannedPath,
      errorMessage: doc.dropboxSync?.lastErrorMessage ?? null,
    });
  }

  return { dropboxConnected, customerFolder, customerDocumentsFolder, generalDocumentsFolder, documents };
}
