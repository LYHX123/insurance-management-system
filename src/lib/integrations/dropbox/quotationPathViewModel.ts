// Server-only. Dropbox Integration Phase 5, Part 10 — assembles the safe
// path-display view model for the Quotation detail page: the business
// folder, the "Quotation" subfolder, the current Excel version's path, and
// (for the optional expandable history) every prior version's path.
import { prisma } from "@/lib/prisma";
import { getDropboxIntegrationRow } from "./service";
import { buildCustomerFolderName } from "./customer-folder-names";
import { buildDropboxPathView, safeJoinPlannedPath, type DropboxPathView, type DropboxPathSyncStatus } from "./pathDisplay";

const QUOTATION_SUBFOLDER_NAME = "Quotation";

export type QuotationVersionPathView = {
  versionNumber: number;
  excelFileName: string;
  view: DropboxPathView;
};

export type QuotationPathViewModel = {
  businessFolder: DropboxPathView;
  quotationFolder: DropboxPathView;
  versions: QuotationVersionPathView[];
};

export async function buildQuotationPathViewModel(quotationCaseId: string | null, dropboxConnected: boolean): Promise<QuotationPathViewModel> {
  const emptyView = buildDropboxPathView({ dropboxConnected, syncStatus: null, actualPath: null, plannedPath: null });
  if (!quotationCaseId) {
    return { businessFolder: emptyView, quotationFolder: emptyView, versions: [] };
  }

  const [integration, quotationCase, businessFile] = await Promise.all([
    getDropboxIntegrationRow(),
    prisma.quotationCase.findUnique({
      where: { id: quotationCaseId },
      select: { customer: { select: { customerNumber: true, companyName: true, dropboxFolder: true } } },
    }),
    prisma.quotationDropboxBusinessFile.findUnique({
      where: { quotationCaseId },
      include: { versions: { orderBy: { versionNumber: "desc" } } },
    }),
  ]);
  if (!quotationCase) return { businessFolder: emptyView, quotationFolder: emptyView, versions: [] };

  const customerFolder = quotationCase.customer.dropboxFolder;
  const customerFolderPath =
    customerFolder?.syncStatus === "SYNCED" && customerFolder.displayPath
      ? customerFolder.displayPath
      : safeJoinPlannedPath(integration.rootFolder, `Customers/${buildCustomerFolderName(quotationCase.customer)}`);

  const businessFolderPlannedPath =
    businessFile && customerFolderPath ? safeJoinPlannedPath(customerFolderPath, businessFile.businessFolderName) : null;
  const businessFolder = buildDropboxPathView({
    dropboxConnected,
    syncStatus: (businessFile?.syncStatus as DropboxPathSyncStatus) ?? null,
    actualPath: businessFile?.dropboxDisplayPath ?? null,
    plannedPath: businessFolderPlannedPath,
    errorMessage: businessFile?.lastErrorMessage ?? null,
  });

  const quotationFolderPlannedPath = businessFolder.path ? safeJoinPlannedPath(businessFolder.path, QUOTATION_SUBFOLDER_NAME) : null;
  const quotationFolder = buildDropboxPathView({
    dropboxConnected,
    syncStatus: businessFolder.state === "synced" ? "SYNCED" : ((businessFile?.syncStatus as DropboxPathSyncStatus) ?? null),
    actualPath: businessFolder.state === "synced" && quotationFolderPlannedPath ? quotationFolderPlannedPath : null,
    plannedPath: quotationFolderPlannedPath,
    errorMessage: businessFolder.errorMessage,
  });

  const versions: QuotationVersionPathView[] = (businessFile?.versions ?? []).map((v) => {
    const excelFileName = `${v.baseFileName}.xlsx`;
    const plannedPath = quotationFolder.path ? safeJoinPlannedPath(quotationFolder.path, excelFileName) : null;
    return {
      versionNumber: v.versionNumber,
      excelFileName,
      view: buildDropboxPathView({
        dropboxConnected,
        syncStatus: v.excelSyncStatus as DropboxPathSyncStatus,
        actualPath: v.excelDropboxPath,
        plannedPath,
        errorMessage: businessFile?.lastErrorMessage ?? null,
      }),
    };
  });

  return { businessFolder, quotationFolder, versions };
}
