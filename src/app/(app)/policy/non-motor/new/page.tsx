import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit } from "@/lib/permissions";
import { CreateNonMotorRecordForm } from "@/components/policy/non-motor/create-non-motor-record-form";
import type { CreateNonMotorRecordPrefill } from "@/components/policy/non-motor/create-non-motor-record-form";
import { QUOTATION_SECTION_KIND_TO_NON_MOTOR_COVER_TYPE } from "@/lib/policy/nonMotorCoverTypes";

// Every QuotationSectionKind this page recognizes as a Non-Motor section —
// deliberately excludes every Motor kind (MOTOR_COMP_PRIVATE/COMMERCIAL,
// MOTOR_TPO_PRIVATE/COMMERCIAL), every Bond/Work-Permit-only kind
// (TENDER_SECURITY, PERFORMANCE_BOND, ADVANCE_PAYMENT_GUARANTEE,
// CUSTOMS_BOND), and GENERIC — see nonMotorCoverTypes.ts's doc comment.
const NON_MOTOR_SECTION_KINDS = [
  "CAR_PACKAGE",
  "WIBA",
  "EMPLOYERS_LIABILITY",
  "CPM_STANDALONE",
  "PUBLIC_LIABILITY",
  "FIRE_AND_PERILS",
  "BURGLARY",
  "GIT_SINGLE",
  "GIT_ANNUAL",
  "MARINE_COVER",
  "GROUP_PERSONAL_ACCIDENT",
  "GROUP_MEDICAL",
] as const;

export default async function NewNonMotorRecordPage({
  searchParams,
}: {
  searchParams: Promise<{ fromQuotationId?: string }>;
}) {
  const session = await auth();
  if (!session?.user || !canEdit(session.user, "policy.non_motor")) {
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

  let prefill: CreateNonMotorRecordPrefill | null = null;
  // Phase 3A: mirrors Motor's own ineligibleQuotation handling exactly — a
  // real quotation found but not in an eligible finalized state blocks the
  // form at the page level, in addition to (not instead of)
  // createNonMotorRecordAction's own server-side eligibility check.
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
          where: { sectionKind: { in: [...NON_MOTOR_SECTION_KINDS] } },
          select: { sectionKind: true, sectionTotal: true },
        },
      },
    });

    if (quotation) {
      const eligible = quotation.revisionStatus === "ISSUED" || quotation.revisionStatus === "ACCEPTED";
      if (!eligible) {
        ineligibleQuotation = { quotationId: quotation.id, quotationNumber: quotation.quotationNumber };
      } else {
        // Phase 3A: only prefill Type of Cover/Client Premium when exactly
        // one Non-Motor section matched — several matches means genuine
        // ambiguity (e.g. a quotation with both WIBA and Fire sections), so
        // both fields are left for the user to choose/confirm rather than
        // guessing which one this policy is for.
        const singleSection = quotation.sections.length === 1 ? quotation.sections[0] : null;
        prefill = {
          quotationId: quotation.id,
          quotationNumber: quotation.quotationNumber,
          customerId: quotation.customerId,
          projectId: quotation.projectId,
          insuranceType: singleSection
            ? QUOTATION_SECTION_KIND_TO_NON_MOTOR_COVER_TYPE[singleSection.sectionKind] ?? null
            : null,
          customerPremium: singleSection ? singleSection.sectionTotal.toString() : null,
        };
      }
    }
  }

  return <CreateNonMotorRecordForm customers={customers} prefill={prefill} ineligibleQuotation={ineligibleQuotation} />;
}
