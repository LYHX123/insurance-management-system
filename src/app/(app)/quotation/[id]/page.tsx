import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canEdit, hasPermission, isAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getQuotationDetailData } from "@/lib/quotationRevisions/getQuotationDetail";
import { getDropboxIntegrationRow } from "@/lib/integrations/dropbox/service";
import { buildQuotationPathViewModel } from "@/lib/integrations/dropbox/quotationPathViewModel";
import { QuotationDetailView } from "@/components/quotations/quotation-detail";
import type { QuotationDropboxView } from "@/components/quotations/quotation-dropbox-status";

export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "quotation")) {
    redirect("/access-denied");
  }

  const { id } = await params;
  const detail = await getQuotationDetailData(id);
  if (!detail) notFound();

  const [quotationCase, dropboxIntegration, businessFile] = await Promise.all([
    detail.quotationCaseId
      ? prisma.quotationCase.findUnique({ where: { id: detail.quotationCaseId }, select: { status: true } })
      : Promise.resolve(null),
    getDropboxIntegrationRow(),
    detail.quotationCaseId
      ? prisma.quotationDropboxBusinessFile.findUnique({
          where: { quotationCaseId: detail.quotationCaseId },
          include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
        })
      : Promise.resolve(null),
  ]);

  // Safe view model only — never a raw Dropbox ID or absolute local path
  // (Part 9, requirement 3-4).
  const dropboxView: QuotationDropboxView = businessFile
    ? {
        businessFolderName: businessFile.businessFolderName,
        businessFileSyncStatus: businessFile.syncStatus,
        businessFileLastErrorMessage: businessFile.lastErrorMessage,
        currentVersion: businessFile.versions[0]
          ? {
              id: businessFile.versions[0].id,
              versionNumber: businessFile.versions[0].versionNumber,
              excelFileName: `${businessFile.versions[0].baseFileName}.xlsx`,
              excelSyncStatus: businessFile.versions[0].excelSyncStatus,
              lastSyncedAt: businessFile.versions[0].lastSyncedAt?.toISOString() ?? null,
            }
          : null,
      }
    : null;

  const dropboxConnected = dropboxIntegration.status === "CONNECTED";
  const dropboxPaths = await buildQuotationPathViewModel(detail.quotationCaseId ?? null, dropboxConnected);

  return (
    <QuotationDetailView
      quotation={detail}
      caseStatus={quotationCase?.status ?? null}
      dropbox={dropboxView}
      dropboxConnected={dropboxConnected}
      dropboxPaths={dropboxPaths}
      isAdmin={isAdmin(session.user)}
      canEdit={canEdit(session.user, "quotation")}
    />
  );
}
