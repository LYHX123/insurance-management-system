import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { InsuranceTypesTable } from "@/components/quotations/insurance-types-table";

export default async function InsuranceTypesPage() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "quotation")) {
    redirect("/access-denied");
  }

  const insuranceTypes = await prisma.insuranceType.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { sections: true } } },
  });

  const rows = insuranceTypes.map((t) => ({
    id: t.id,
    name: t.name,
    code: t.code,
    description: t.description,
    defaultPHCFRate: t.defaultPHCFRate.toString(),
    defaultITLRate: t.defaultITLRate.toString(),
    defaultStampDuty: t.defaultStampDuty.toString(),
    applyPHCF: t.applyPHCF,
    applyITL: t.applyITL,
    applyStampDuty: t.applyStampDuty,
    defaultClauses: t.defaultClauses,
    defaultExclusions: t.defaultExclusions,
    defaultConditions: t.defaultConditions,
    active: t.active,
    usageCount: t._count.sections,
  }));

  return <InsuranceTypesTable insuranceTypes={rows} />;
}
