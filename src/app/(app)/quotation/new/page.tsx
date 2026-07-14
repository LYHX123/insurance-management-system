import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { QuotationForm } from "@/components/quotations/quotation-form";

export default async function NewQuotationPage() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "quotation")) {
    redirect("/access-denied");
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

  return <QuotationForm customers={customerOptions} insuranceTypes={insuranceTypeOptions} quotation={null} />;
}
