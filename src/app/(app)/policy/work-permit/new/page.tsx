import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { CreateWorkPermitRecordForm } from "@/components/policy/work-permit/create-work-permit-record-form";
import type { CreateWorkPermitRecordPrefill } from "@/components/policy/work-permit/create-work-permit-record-form";

export default async function NewWorkPermitRecordPage({
  searchParams,
}: {
  searchParams: Promise<{ fromQuotationId?: string }>;
}) {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "policy")) {
    redirect("/access-denied");
  }

  const { fromQuotationId } = await searchParams;

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

  let prefill: CreateWorkPermitRecordPrefill | null = null;
  let ineligibleQuotation: { quotationId: string; quotationNumber: string } | null = null;
  if (fromQuotationId) {
    // Work Permit has no QuotationSectionKind equivalent at all (see
    // bondTypes.ts's Bond mapping for contrast) — no quotation data source
    // exists for Type of Permit or Client Premium, so only customer/project
    // (unambiguous, inherent to the quotation itself) and the source
    // snapshot are ever prefilled; every Work Permit-specific field always
    // requires manual entry.
    const quotation = await prisma.quotation.findUnique({
      where: { id: fromQuotationId },
      select: { id: true, quotationNumber: true, customerId: true, projectId: true, revisionStatus: true },
    });

    if (quotation) {
      const eligible = quotation.revisionStatus === "ISSUED" || quotation.revisionStatus === "ACCEPTED";
      if (!eligible) {
        ineligibleQuotation = { quotationId: quotation.id, quotationNumber: quotation.quotationNumber };
      } else {
        prefill = {
          quotationId: quotation.id,
          quotationNumber: quotation.quotationNumber,
          customerId: quotation.customerId,
          projectId: quotation.projectId,
        };
      }
    }
  }

  return <CreateWorkPermitRecordForm customers={customers} prefill={prefill} ineligibleQuotation={ineligibleQuotation} />;
}
