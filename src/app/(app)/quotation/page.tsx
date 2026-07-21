import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { toDecimal } from "@/lib/money";
import { QuotationsTable } from "@/components/quotations/quotations-table";

export default async function QuotationPage() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "quotation")) {
    redirect("/access-denied");
  }

  // One row per QuotationCase (the permanent enquiry), never one row per
  // revision — see Phase 1 revision history. currentRevisionId is a plain
  // pointer column (not a Prisma relation, see QuotationCase's schema doc
  // comment), so the current revision's own display data is fetched
  // separately and joined in application code below.
  const cases = await prisma.quotationCase.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      customer: { select: { companyName: true } },
      project: { select: { projectName: true } },
    },
  });

  const currentRevisionIds = cases.map((c) => c.currentRevisionId).filter((id): id is string => !!id);
  const currentRevisions = currentRevisionIds.length
    ? await prisma.quotation.findMany({
        where: { id: { in: currentRevisionIds } },
        include: { sections: { select: { insuranceTypeNameSnapshot: true } } },
      })
    : [];
  const revisionById = new Map(currentRevisions.map((r) => [r.id, r]));

  const creatorIds = Array.from(new Set(cases.map((c) => c.createdById)));
  const creators = creatorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, fullName: true, username: true },
      })
    : [];
  const creatorNameById = new Map(creators.map((u) => [u.id, u.fullName || u.username]));

  // One extra grouped query for the list's "Documents: N" indicator — active
  // (non-deleted) documents only. No pagination exists on this page yet, so
  // this stays a single flat query, not a per-row N+1.
  const caseIds = cases.map((c) => c.id);
  const documentCounts = caseIds.length
    ? await prisma.quotationDocument.groupBy({
        by: ["quotationCaseId"],
        where: { quotationCaseId: { in: caseIds }, deletedAt: null },
        _count: { id: true },
      })
    : [];
  const documentCountByCaseId = new Map(documentCounts.map((d) => [d.quotationCaseId, d._count.id]));

  const rows = cases
    .map((c) => {
      const rev = c.currentRevisionId ? revisionById.get(c.currentRevisionId) : undefined;
      if (!rev) return null; // case with no viable current revision (e.g. every revision cancelled)
      return {
        caseId: c.id,
        quotationNumber: c.quotationNumber,
        customerId: c.customerId,
        customerName: c.customer.companyName,
        projectId: c.projectId,
        projectName: c.project?.projectName ?? null,
        insuranceTypeNames: rev.sections.map((s) => s.insuranceTypeNameSnapshot),
        revisionCode: rev.revisionCode ?? "R01",
        revisionStatus: rev.revisionStatus ?? "DRAFT",
        subtotalPremium: rev.subtotalPremium.toString(),
        totalLevies: toDecimal(rev.totalPHCF).plus(toDecimal(rev.totalITL)).plus(toDecimal(rev.totalStampDuty)).toString(),
        grandTotal: rev.grandTotal.toString(),
        caseStatus: c.status,
        quotationDate: rev.quotationDate.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        createdByName: creatorNameById.get(c.createdById) ?? "—",
        documentCount: documentCountByCaseId.get(c.id) ?? 0,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return <QuotationsTable quotations={rows} />;
}
