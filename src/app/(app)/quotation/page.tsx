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

  const quotations = await prisma.quotation.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { companyName: true } },
      project: { select: { projectName: true } },
      sections: { select: { insuranceTypeNameSnapshot: true } },
    },
  });

  const creatorIds = Array.from(new Set(quotations.map((q) => q.createdBy)));
  const creators = creatorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, fullName: true, username: true },
      })
    : [];
  const creatorNameById = new Map(creators.map((u) => [u.id, u.fullName || u.username]));

  const rows = quotations.map((q) => ({
    id: q.id,
    quotationNumber: q.quotationNumber,
    customerId: q.customerId,
    customerName: q.customer.companyName,
    projectId: q.projectId,
    projectName: q.project?.projectName ?? null,
    insuranceTypeNames: q.sections.map((s) => s.insuranceTypeNameSnapshot),
    subtotalPremium: q.subtotalPremium.toString(),
    totalLevies: toDecimal(q.totalPHCF).plus(toDecimal(q.totalITL)).plus(toDecimal(q.totalStampDuty)).toString(),
    grandTotal: q.grandTotal.toString(),
    status: q.status,
    quotationDate: q.quotationDate.toISOString(),
    createdByName: creatorNameById.get(q.createdBy) ?? "—",
  }));

  return <QuotationsTable quotations={rows} />;
}
