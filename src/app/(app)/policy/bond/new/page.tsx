import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit } from "@/lib/permissions";
import { CreateBondRecordForm } from "@/components/policy/bond/create-bond-record-form";
import type { CreateBondRecordPrefill } from "@/components/policy/bond/create-bond-record-form";
import { BOND_QUOTATION_SECTION_KINDS, QUOTATION_SECTION_KIND_TO_BOND_TYPE } from "@/lib/policy/bondTypes";

export default async function NewBondRecordPage({
  searchParams,
}: {
  searchParams: Promise<{ fromQuotationId?: string }>;
}) {
  const session = await auth();
  if (!session?.user || !canEdit(session.user, "policy.bond")) {
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

  let prefill: CreateBondRecordPrefill | null = null;
  // Mirrors Motor/Non-Motor's own ineligibleQuotation handling exactly — a
  // real quotation found but not in an eligible finalized state blocks the
  // form at the page level, in addition to (not instead of)
  // createBondRecordAction's own server-side eligibility check.
  let ineligibleQuotation: { quotationId: string; quotationNumber: string } | null = null;
  if (fromQuotationId) {
    const quotation = await prisma.quotation.findUnique({
      where: { id: fromQuotationId },
      select: {
        id: true,
        quotationNumber: true,
        customerId: true,
        projectId: true,
        revisionStatus: true,
        sections: {
          where: { sectionKind: { in: [...BOND_QUOTATION_SECTION_KINDS] } },
          select: { sectionKind: true, sectionTotal: true },
        },
      },
    });

    if (quotation) {
      const eligible = quotation.revisionStatus === "ISSUED" || quotation.revisionStatus === "ACCEPTED";
      if (!eligible) {
        ineligibleQuotation = { quotationId: quotation.id, quotationNumber: quotation.quotationNumber };
      } else {
        // Only prefill Type of Bond/Client Premium when exactly one
        // structured Bond section matched — several matches means genuine
        // ambiguity, so both fields are left for the user to choose/confirm
        // rather than guessing which one this policy is for. Same rule as
        // Non-Motor's own single-section prefill (see that page's comment).
        const singleSection = quotation.sections.length === 1 ? quotation.sections[0] : null;
        prefill = {
          quotationId: quotation.id,
          quotationNumber: quotation.quotationNumber,
          customerId: quotation.customerId,
          projectId: quotation.projectId,
          bondType: singleSection
            ? QUOTATION_SECTION_KIND_TO_BOND_TYPE[
                singleSection.sectionKind as keyof typeof QUOTATION_SECTION_KIND_TO_BOND_TYPE
              ] ?? null
            : null,
          customerPremium: singleSection ? singleSection.sectionTotal.toString() : null,
        };
      }
    }
  }

  return <CreateBondRecordForm customers={customers} prefill={prefill} ineligibleQuotation={ineligibleQuotation} />;
}
