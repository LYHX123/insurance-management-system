import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { CreateQuotationCaseForm } from "@/components/quotations/create-quotation-case-form";

// Phase 2B: "New Quotation" creates a lightweight QuotationCase first (no
// revision yet) — the full section-by-section editor
// (components/quotations/quotation-form.tsx) is only reached afterward, via
// the case page's "Start First Quotation" button. See
// src/app/(app)/quotation/case/[caseId]/start/page.tsx.
export default async function NewQuotationPage() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "quotation")) {
    redirect("/access-denied");
  }

  const customers = await prisma.customer.findMany({
    where: { status: "ACTIVE" },
    orderBy: { companyName: "asc" },
    select: {
      id: true,
      companyName: true,
      customerNumber: true,
      projects: { select: { id: true, projectName: true }, orderBy: { projectName: "asc" } },
    },
  });

  const customerOptions = customers.map((c) => ({
    id: c.id,
    companyName: c.companyName,
    customerNumber: c.customerNumber,
    projects: c.projects,
  }));

  return <CreateQuotationCaseForm customers={customerOptions} />;
}
