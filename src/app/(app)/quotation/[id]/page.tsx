import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { QuotationDetailView } from "@/components/quotations/quotation-detail";

export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "quotation")) {
    redirect("/access-denied");
  }

  const { id } = await params;

  const quotation = await prisma.quotation.findUnique({
    where: { id },
    include: {
      customer: { select: { companyName: true } },
      project: { select: { projectName: true } },
      sections: {
        orderBy: { sortOrder: "asc" },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });

  if (!quotation) notFound();

  const creator = await prisma.user.findUnique({
    where: { id: quotation.createdBy },
    select: { fullName: true, username: true },
  });

  const detail = {
    id: quotation.id,
    quotationNumber: quotation.quotationNumber,
    customerId: quotation.customerId,
    customerName: quotation.customer.companyName,
    projectId: quotation.projectId,
    projectName: quotation.project?.projectName ?? null,
    quotationDate: quotation.quotationDate.toISOString(),
    validUntil: quotation.validUntil ? quotation.validUntil.toISOString() : null,
    currency: quotation.currency,
    status: quotation.status,
    internalNotes: quotation.internalNotes,
    subtotalPremium: quotation.subtotalPremium.toString(),
    totalPHCF: quotation.totalPHCF.toString(),
    totalITL: quotation.totalITL.toString(),
    totalStampDuty: quotation.totalStampDuty.toString(),
    grandTotal: quotation.grandTotal.toString(),
    createdByName: creator ? creator.fullName || creator.username : "—",
    createdAt: quotation.createdAt.toISOString(),
    updatedAt: quotation.updatedAt.toISOString(),
    sections: quotation.sections.map((s) => ({
      id: s.id,
      insuranceTypeId: s.insuranceTypeId,
      insuranceTypeNameSnapshot: s.insuranceTypeNameSnapshot,
      description: s.description,
      phcfRate: s.phcfRate.toString(),
      itlRate: s.itlRate.toString(),
      stampDuty: s.stampDuty.toString(),
      applyPHCF: s.applyPHCF,
      applyITL: s.applyITL,
      applyStampDuty: s.applyStampDuty,
      basePremium: s.basePremium.toString(),
      phcfAmount: s.phcfAmount.toString(),
      itlAmount: s.itlAmount.toString(),
      sectionTotal: s.sectionTotal.toString(),
      clausesSnapshot: s.clausesSnapshot,
      exclusionsSnapshot: s.exclusionsSnapshot,
      conditionsSnapshot: s.conditionsSnapshot,
      sortOrder: s.sortOrder,
      items: s.items.map((i) => ({
        id: i.id,
        insuredContent: i.insuredContent,
        sumInsured: i.sumInsured ? i.sumInsured.toString() : null,
        rate: i.rate ? i.rate.toString() : null,
        calculationMethod: i.calculationMethod,
        premium: i.premium.toString(),
        notes: i.notes,
        sortOrder: i.sortOrder,
      })),
    })),
  };

  return <QuotationDetailView quotation={detail} />;
}
