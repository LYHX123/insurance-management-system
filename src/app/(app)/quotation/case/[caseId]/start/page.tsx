import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { QuotationForm } from "@/components/quotations/quotation-form";

// Phase 2B: "Start First Quotation" — opens the full section-by-section
// editor to create R01 for a case that already exists (and already fixed
// its customer/project). Redirects away if a revision already exists, since
// "Start First Quotation" is only ever offered once per case — after that,
// the existing "Create Revision" workflow on the case page takes over.
export default async function StartFirstQuotationPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "quotation")) {
    redirect("/access-denied");
  }

  const { caseId } = await params;

  const quotationCase = await prisma.quotationCase.findUnique({ where: { id: caseId } });
  if (!quotationCase) notFound();
  if (quotationCase.currentRevisionId) {
    redirect(`/quotation/case/${caseId}`);
  }

  const [customers, insuranceTypes] = await Promise.all([
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

  return (
    <QuotationForm
      customers={customerOptions}
      insuranceTypes={insuranceTypeOptions}
      quotation={null}
      startFirstQuotationFor={{
        quotationCaseId: quotationCase.id,
        customerId: quotationCase.customerId,
        projectId: quotationCase.projectId,
      }}
    />
  );
}
