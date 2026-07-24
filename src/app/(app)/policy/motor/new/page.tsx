import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { CreateMotorRecordForm } from "@/components/policy/motor/create-motor-record-form";
import type { CreateMotorRecordPrefill } from "@/components/policy/motor/create-motor-record-form";

// Phase 2A: sectionKind -> MOTOR_COVER_TYPES mapping used only to prefill
// the Insurance Type field "where applicable" (see the quotation detail
// page's "Create Policy" action). Deliberately narrow — a quotation section
// kind that isn't one of these four is simply not a Motor section, so no
// mapping applies and the form field is left for the user to fill in.
const MOTOR_SECTION_KIND_TO_COVER_TYPE: Record<string, string> = {
  MOTOR_COMP_PRIVATE: "COMPREHENSIVE",
  MOTOR_COMP_COMMERCIAL: "COMPREHENSIVE",
  MOTOR_TPO_PRIVATE: "THIRD PARTY",
  MOTOR_TPO_COMMERCIAL: "THIRD PARTY",
};

export default async function NewMotorRecordPage({
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

  let prefill: CreateMotorRecordPrefill | null = null;
  // Phase 2B: a quotation found but not in an eligible finalized state
  // (ISSUED/ACCEPTED) blocks the form entirely at the page level — this is
  // in addition to (not instead of) createMotorRecordAction's own server
  // action check, so a hand-typed/bookmarked URL for a DRAFT quotation can
  // never even reach the create form, let alone submit it.
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
          where: {
            sectionKind: {
              in: ["MOTOR_COMP_PRIVATE", "MOTOR_COMP_COMMERCIAL", "MOTOR_TPO_PRIVATE", "MOTOR_TPO_COMMERCIAL"],
            },
          },
          select: { sectionKind: true, sectionTotal: true },
        },
      },
    });

    if (quotation) {
      const eligible = quotation.revisionStatus === "ISSUED" || quotation.revisionStatus === "ACCEPTED";
      if (!eligible) {
        ineligibleQuotation = { quotationId: quotation.id, quotationNumber: quotation.quotationNumber };
      } else {
        const singleMotorSection = quotation.sections.length === 1 ? quotation.sections[0] : null;
        prefill = {
          quotationId: quotation.id,
          quotationNumber: quotation.quotationNumber,
          customerId: quotation.customerId,
          projectId: quotation.projectId,
          insuranceType: singleMotorSection ? MOTOR_SECTION_KIND_TO_COVER_TYPE[singleMotorSection.sectionKind] ?? null : null,
          customerPremium: singleMotorSection ? singleMotorSection.sectionTotal.toString() : null,
        };
      }
    }
  }

  return <CreateMotorRecordForm customers={customers} prefill={prefill} ineligibleQuotation={ineligibleQuotation} />;
}
