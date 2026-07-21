import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { getQuotationDetailData } from "@/lib/quotationRevisions/getQuotationDetail";
import { QuotationCaseView } from "@/components/quotations/quotation-case-view";

export default async function QuotationCasePage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "quotation")) {
    redirect("/access-denied");
  }

  const { caseId } = await params;

  const quotationCase = await prisma.quotationCase.findUnique({
    where: { id: caseId },
    include: {
      customer: { select: { companyName: true } },
      project: { select: { projectName: true } },
    },
  });
  if (!quotationCase) notFound();

  const revisions = await prisma.quotation.findMany({
    where: { quotationCaseId: caseId },
    orderBy: { revisionNumber: "desc" },
    include: { sections: { select: { insuranceTypeNameSnapshot: true } } },
  });

  const creatorIds = Array.from(new Set(revisions.map((r) => r.createdBy)));
  const creators = creatorIds.length
    ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, fullName: true, username: true } })
    : [];
  const creatorNameById = new Map(creators.map((u) => [u.id, u.fullName || u.username]));

  const revisionRows = revisions.map((r) => ({
    id: r.id,
    revisionCode: r.revisionCode ?? "R01",
    revisionNumber: r.revisionNumber ?? 1,
    revisionStatus: r.revisionStatus ?? "DRAFT",
    revisionReason: r.revisionReason,
    isCurrentRevision: r.isCurrentRevision,
    createdAt: r.createdAt.toISOString(),
    createdByName: creatorNameById.get(r.createdBy) ?? "—",
    insuranceTypeNames: r.sections.map((s) => s.insuranceTypeNameSnapshot),
    subtotalPremium: r.subtotalPremium.toString(),
    grandTotal: r.grandTotal.toString(),
  }));

  const currentRevisionId = quotationCase.currentRevisionId ?? revisions[0]?.id ?? null;
  const currentDetail = currentRevisionId ? await getQuotationDetailData(currentRevisionId) : null;

  // Shared by every revision of this case — see QuotationDocument's schema
  // doc comment. Never filtered/joined by revision.
  const documents = await prisma.quotationDocument.findMany({
    where: { quotationCaseId: caseId, deletedAt: null },
    orderBy: { uploadedAt: "desc" },
  });
  const documentUserIds = Array.from(
    new Set(documents.flatMap((d) => [d.uploadedById, d.updatedById]).filter((id): id is string => !!id))
  );
  const documentUsers = documentUserIds.length
    ? await prisma.user.findMany({ where: { id: { in: documentUserIds } }, select: { id: true, fullName: true, username: true } })
    : [];
  const documentUserNameById = new Map(documentUsers.map((u) => [u.id, u.fullName || u.username]));

  const documentRows = documents.map((d) => ({
    id: d.id,
    documentType: d.documentType,
    customTypeName: d.customTypeName,
    originalFileName: d.originalFileName,
    mimeType: d.mimeType,
    fileExtension: d.fileExtension,
    fileSize: d.fileSize,
    description: d.description,
    documentDate: d.documentDate ? d.documentDate.toISOString() : null,
    syncStatus: d.syncStatus,
    uploadedByName: documentUserNameById.get(d.uploadedById) ?? "—",
    uploadedAt: d.uploadedAt.toISOString(),
    updatedByName: d.updatedById ? documentUserNameById.get(d.updatedById) ?? "—" : null,
    updatedAt: d.updatedAt.toISOString(),
  }));

  return (
    <QuotationCaseView
      quotationCase={{
        id: quotationCase.id,
        quotationNumber: quotationCase.quotationNumber,
        customerName: quotationCase.customer.companyName,
        projectName: quotationCase.project?.projectName ?? null,
        status: quotationCase.status,
        currentRevisionId,
      }}
      revisions={revisionRows}
      currentDetail={currentDetail}
      documents={documentRows}
    />
  );
}
