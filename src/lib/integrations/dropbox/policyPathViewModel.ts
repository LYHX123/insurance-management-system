// Server-only. Dropbox Integration Phase 5, Part 2/8 — assembles the safe,
// null-safe view model the Policy detail page renders in its "Dropbox
// Filing" section. Never returns a raw Dropbox id/token/local path — only
// DropboxPathView values (see pathDisplay.ts) and plain strings.
import { prisma } from "@/lib/prisma";
import { getDropboxIntegrationRow } from "./service";
import { resolvePolicyBusinessFileRefReadOnly, type PolicyBusinessFileRef } from "./policyBusinessFile";
import { buildCustomerFolderName } from "./customer-folder-names";
import { buildStandardizedPolicyDocumentFilename } from "./policyDocumentFilenames";
import { POLICY_SUBFOLDER_NAME } from "./policyDocumentSync";
import { buildDropboxPathView, safeJoinPlannedPath, type DropboxPathView, type DropboxPathSyncStatus } from "./pathDisplay";
import type { PolicyDocumentType } from "@/generated/prisma/enums";

export type PolicyDropboxViewModel = {
  dropboxConnected: boolean;
  source: PolicyBusinessFileRef["source"];
  businessFolderName: string;
  businessFolder: DropboxPathView;
  policyFolder: DropboxPathView;
  documents: Record<string, { view: DropboxPathView; standardizedFileName: string | null; lastSyncedAt: string | null }>;
};

export async function buildPolicyDropboxViewModel(policyRecordId: string): Promise<PolicyDropboxViewModel> {
  const [integration, policy, ref] = await Promise.all([
    getDropboxIntegrationRow(),
    prisma.policyRecord.findUnique({
      where: { id: policyRecordId },
      select: { customer: { select: { customerNumber: true, companyName: true, dropboxFolder: true } } },
    }),
    resolvePolicyBusinessFileRefReadOnly(policyRecordId),
  ]);
  const dropboxConnected = integration.status === "CONNECTED";

  const emptyView = buildDropboxPathView({ dropboxConnected, syncStatus: null, actualPath: null, plannedPath: null });
  if (!policy || !ref) {
    return { dropboxConnected, source: "POLICY_FALLBACK", businessFolderName: "", businessFolder: emptyView, policyFolder: emptyView, documents: {} };
  }

  const customerFolder = policy.customer.dropboxFolder;
  const customerFolderPath =
    customerFolder?.syncStatus === "SYNCED" && customerFolder.displayPath
      ? customerFolder.displayPath
      : safeJoinPlannedPath(integration.rootFolder, `Customers/${buildCustomerFolderName(policy.customer)}`);

  const businessFolderPlannedPath = customerFolderPath ? safeJoinPlannedPath(customerFolderPath, ref.businessFolderName) : null;
  const businessFolder = buildDropboxPathView({
    dropboxConnected,
    syncStatus: ref.syncStatus as DropboxPathSyncStatus,
    actualPath: ref.dropboxDisplayPath,
    plannedPath: businessFolderPlannedPath,
    errorMessage: ref.lastErrorMessage,
  });

  const documentRows = await prisma.policyDocument.findMany({
    where: { policyRecordId },
    select: { id: true, documentType: true, originalFileName: true, dropboxSync: true },
    orderBy: { createdAt: "desc" },
  });

  const syncedDoc = documentRows.find((d) => d.dropboxSync?.syncStatus === "SYNCED" && d.dropboxSync.dropboxDisplayPath);
  const policyFolderActualPath = syncedDoc?.dropboxSync?.dropboxDisplayPath
    ? parentDropboxPath(syncedDoc.dropboxSync.dropboxDisplayPath)
    : null;
  const policyFolderPlannedPath = businessFolder.path ? safeJoinPlannedPath(businessFolder.path, POLICY_SUBFOLDER_NAME) : null;
  const policyFolderSyncStatus: DropboxPathSyncStatus = syncedDoc
    ? "SYNCED"
    : businessFolder.state === "not_connected"
      ? null
      : (ref.syncStatus as DropboxPathSyncStatus);
  const policyFolder = buildDropboxPathView({
    dropboxConnected,
    syncStatus: policyFolderSyncStatus,
    actualPath: policyFolderActualPath,
    plannedPath: policyFolderPlannedPath,
    errorMessage: businessFolder.errorMessage,
  });

  // Best-effort preview name for documents never synced yet — the actual
  // name assigned at sync time may differ if a sibling document syncs
  // first and claims this exact name (collision resolution only finalizes
  // at sync time); this is a deterministic PREVIEW, not a promise.
  const existingNamesLower = new Set(
    documentRows.filter((d) => d.dropboxSync).map((d) => d.dropboxSync!.standardizedFileName.toLowerCase())
  );

  const documents: PolicyDropboxViewModel["documents"] = {};
  for (const doc of documentRows) {
    const sync = doc.dropboxSync;
    const standardizedFileName =
      sync?.standardizedFileName ??
      buildStandardizedPolicyDocumentFilename({
        documentType: doc.documentType as PolicyDocumentType,
        originalFileName: doc.originalFileName,
        existingStandardizedNamesLower: existingNamesLower,
      });
    const plannedPath = policyFolderPlannedPath ? safeJoinPlannedPath(policyFolderPlannedPath, standardizedFileName) : null;
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
    policyFolder,
    documents,
  };
}

function parentDropboxPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : path;
}
