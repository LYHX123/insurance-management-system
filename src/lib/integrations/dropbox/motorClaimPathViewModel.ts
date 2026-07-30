// Server-only. Dropbox Integration Phase 7, Part 8/9 — assembles the safe,
// null-safe view model the Motor Claim detail page renders in its Dropbox
// section and document list. Never returns a raw Dropbox id/token/local
// path — only DropboxPathView values (see pathDisplay.ts) and plain
// strings. Mirrors policyPathViewModel.ts, with one extra nesting level
// (Claim -> Claim Reference, not just Policy).
import { prisma } from "@/lib/prisma";
import { getDropboxIntegrationRow } from "./service";
import { resolveMotorClaimBusinessFileRefReadOnly, type ClaimBusinessFileRef } from "./motorClaimBusinessFile";
import { buildCustomerFolderName } from "./customer-folder-names";
import { buildStandardizedMotorClaimDocumentFilename } from "./claimDocumentFilenames";
import { CLAIM_SUBFOLDER_NAME } from "./motorClaimDocumentSync";
import { buildDropboxPathView, safeJoinPlannedPath, type DropboxPathView, type DropboxPathSyncStatus } from "./pathDisplay";
import type { MotorClaimDocumentType } from "@/generated/prisma/enums";

export type MotorClaimDropboxViewModel = {
  dropboxConnected: boolean;
  source: ClaimBusinessFileRef["source"];
  businessFolderName: string;
  businessFolder: DropboxPathView;
  claimFolder: DropboxPathView;
  claimReferenceFolder: DropboxPathView;
  documents: Record<string, { view: DropboxPathView; standardizedFileName: string | null; lastSyncedAt: string | null }>;
};

export async function buildMotorClaimDropboxViewModel(motorClaimId: string): Promise<MotorClaimDropboxViewModel> {
  const [integration, claim, ref] = await Promise.all([
    getDropboxIntegrationRow(),
    prisma.motorClaim.findUnique({
      where: { id: motorClaimId },
      select: { customer: { select: { customerNumber: true, companyName: true, dropboxFolder: true } } },
    }),
    resolveMotorClaimBusinessFileRefReadOnly(motorClaimId),
  ]);
  const dropboxConnected = integration.status === "CONNECTED";

  const emptyView = buildDropboxPathView({ dropboxConnected, syncStatus: null, actualPath: null, plannedPath: null });
  if (!claim || !ref) {
    return {
      dropboxConnected,
      source: "CLAIM_FALLBACK",
      businessFolderName: "",
      businessFolder: emptyView,
      claimFolder: emptyView,
      claimReferenceFolder: emptyView,
      documents: {},
    };
  }

  const customerFolder = claim.customer.dropboxFolder;
  const customerFolderPath =
    customerFolder?.syncStatus === "SYNCED" && customerFolder.displayPath
      ? customerFolder.displayPath
      : safeJoinPlannedPath(integration.rootFolder, `Customers/${buildCustomerFolderName(claim.customer)}`);

  const businessFolderPlannedPath = customerFolderPath ? safeJoinPlannedPath(customerFolderPath, ref.businessFolderName) : null;
  const businessFolder = buildDropboxPathView({
    dropboxConnected,
    syncStatus: ref.syncStatus as DropboxPathSyncStatus,
    actualPath: ref.dropboxDisplayPath,
    plannedPath: businessFolderPlannedPath,
    errorMessage: ref.lastErrorMessage,
  });

  const documentRows = await prisma.motorClaimDocument.findMany({
    where: { motorClaimId },
    select: { id: true, documentType: true, originalFileName: true, dropboxSync: true },
    orderBy: { createdAt: "desc" },
  });

  const syncedDoc = documentRows.find((d) => d.dropboxSync?.syncStatus === "SYNCED" && d.dropboxSync.dropboxDisplayPath);
  const claimReferenceFolderName = documentRows.find((d) => d.dropboxSync?.claimFolderName)?.dropboxSync?.claimFolderName ?? null;

  const claimFolderPlannedPath = businessFolder.path ? safeJoinPlannedPath(businessFolder.path, CLAIM_SUBFOLDER_NAME) : null;
  const claimFolderActualPath = syncedDoc ? grandParentDropboxPath(syncedDoc.dropboxSync!.dropboxDisplayPath!) : null;
  const claimFolderSyncStatus: DropboxPathSyncStatus = syncedDoc ? "SYNCED" : businessFolder.state === "not_connected" ? null : (ref.syncStatus as DropboxPathSyncStatus);
  const claimFolder = buildDropboxPathView({
    dropboxConnected,
    syncStatus: claimFolderSyncStatus,
    actualPath: claimFolderActualPath,
    plannedPath: claimFolderPlannedPath,
    errorMessage: businessFolder.errorMessage,
  });

  const claimReferenceFolderPlannedPath =
    claimFolderPlannedPath && claimReferenceFolderName ? safeJoinPlannedPath(claimFolderPlannedPath, claimReferenceFolderName) : null;
  const claimReferenceFolderActualPath = syncedDoc ? parentDropboxPath(syncedDoc.dropboxSync!.dropboxDisplayPath!) : null;
  const claimReferenceFolder = buildDropboxPathView({
    dropboxConnected,
    syncStatus: claimFolderSyncStatus,
    actualPath: claimReferenceFolderActualPath,
    plannedPath: claimReferenceFolderPlannedPath,
    errorMessage: businessFolder.errorMessage,
  });

  const existingNamesLower = new Set(documentRows.filter((d) => d.dropboxSync).map((d) => d.dropboxSync!.standardizedFileName.toLowerCase()));

  const documents: MotorClaimDropboxViewModel["documents"] = {};
  for (const doc of documentRows) {
    const sync = doc.dropboxSync;
    const standardizedFileName =
      sync?.standardizedFileName ??
      buildStandardizedMotorClaimDocumentFilename({
        documentType: doc.documentType as MotorClaimDocumentType,
        originalFileName: doc.originalFileName,
        existingStandardizedNamesLower: existingNamesLower,
      });
    const plannedPath = claimReferenceFolderPlannedPath ? safeJoinPlannedPath(claimReferenceFolderPlannedPath, standardizedFileName) : null;
    documents[doc.id] = {
      view: buildDropboxPathView({
        dropboxConnected,
        syncStatus: (sync?.syncStatus as DropboxPathSyncStatus) ?? null,
        actualPath: sync?.dropboxDisplayPath ?? null,
        plannedPath,
        errorMessage: sync?.lastErrorMessage ?? null,
      }),
      standardizedFileName: sync?.standardizedFileName ?? null,
      lastSyncedAt: sync?.lastSyncedAt?.toISOString() ?? null,
    };
  }

  return {
    dropboxConnected,
    source: ref.source,
    businessFolderName: ref.businessFolderName,
    businessFolder,
    claimFolder,
    claimReferenceFolder,
    documents,
  };
}

function parentDropboxPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : path;
}
function grandParentDropboxPath(path: string): string {
  return parentDropboxPath(parentDropboxPath(path));
}
