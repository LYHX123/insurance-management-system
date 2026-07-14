import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { QuotationForm } from "@/components/quotations/quotation-form";

export default async function EditQuotationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "quotation")) {
    redirect("/access-denied");
  }

  const { id } = await params;

  const [quotation, customers, insuranceTypes] = await Promise.all([
    prisma.quotation.findUnique({
      where: { id },
      include: {
        sections: {
          orderBy: { sortOrder: "asc" },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        },
      },
    }),
    prisma.customer.findMany({
      where: { status: "ACTIVE" },
      orderBy: { companyName: "asc" },
      select: {
        id: true,
        companyName: true,
        customerNumber: true,
        projects: { select: { id: true, projectName: true }, orderBy: { projectName: "asc" } },
      },
    }),
    prisma.insuranceType.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!quotation) notFound();

  const customerOptions = customers.map((c) => ({
    id: c.id,
    companyName: c.companyName,
    customerNumber: c.customerNumber,
    projects: c.projects,
  }));

  const insuranceTypeOptions = insuranceTypes.map((it) => ({
    id: it.id,
    name: it.name,
    code: it.code,
    defaultPHCFRate: it.defaultPHCFRate.toString(),
    defaultITLRate: it.defaultITLRate.toString(),
    defaultStampDuty: it.defaultStampDuty.toString(),
    applyPHCF: it.applyPHCF,
    applyITL: it.applyITL,
    applyStampDuty: it.applyStampDuty,
    defaultClauses: it.defaultClauses,
    defaultExclusions: it.defaultExclusions,
    defaultConditions: it.defaultConditions,
  }));

  const quotationForForm = {
    id: quotation.id,
    quotationNumber: quotation.quotationNumber,
    customerId: quotation.customerId,
    projectId: quotation.projectId,
    quotationDate: quotation.quotationDate.toISOString().slice(0, 10),
    validUntil: quotation.validUntil ? quotation.validUntil.toISOString().slice(0, 10) : "",
    currency: quotation.currency,
    internalNotes: quotation.internalNotes ?? "",
    sections: quotation.sections.map((s) => ({
      id: s.id,
      insuranceTypeId: s.insuranceTypeId,
      insuranceTypeNameSnapshot: s.insuranceTypeNameSnapshot,
      description: s.description ?? "",
      phcfRate: s.phcfRate.toString(),
      itlRate: s.itlRate.toString(),
      stampDuty: s.stampDuty.toString(),
      applyPHCF: s.applyPHCF,
      applyITL: s.applyITL,
      applyStampDuty: s.applyStampDuty,
      clausesSnapshot: s.clausesSnapshot ?? "",
      exclusionsSnapshot: s.exclusionsSnapshot ?? "",
      conditionsSnapshot: s.conditionsSnapshot ?? "",
      items: s.items.map((i) => ({
        id: i.id,
        insuredContent: i.insuredContent,
        sumInsured: i.sumInsured ? i.sumInsured.toString() : "",
        rate: i.rate ? i.rate.toString() : "",
        calculationMethod: i.calculationMethod,
        premium: i.premium.toString(),
        notes: i.notes ?? "",
      })),
    })),
  };

  return (
    <QuotationForm
      customers={customerOptions}
      insuranceTypes={insuranceTypeOptions}
      quotation={quotationForForm}
    />
  );
}
