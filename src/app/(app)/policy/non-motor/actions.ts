"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { toDecimal } from "@/lib/money";
import { generatePolicyRecordNumber } from "@/lib/policy/recordNumber";
import { computeBusinessStatus } from "@/lib/policy/status";
import { recordPolicyActivity } from "@/lib/policy/activity";
import { isNonMotorCoverType } from "@/lib/policy/nonMotorCoverTypes";
import type { NonMotorCoverType } from "@/generated/prisma/enums";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

// Phase 3A: intentionally re-declared here rather than imported from
// policy/motor/actions.ts — that file's helpers are private (unexported) and
// this project's existing convention (see that file itself) is for each
// Policy category's actions file to be self-contained rather than sharing a
// central util module. addCustomerReceiptAction/addProviderPaymentAction/
// updateCommissionAction ARE genuinely reused as-is from that file (they are
// already category-agnostic — see this file's imports below); only these
// small, single-purpose validators are duplicated.
async function requirePolicyPermission() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "policy")) return null;
  return session;
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

type CustomerProjectCheckResult = { error: string } | { ok: true };

async function validateCustomerAndProject(
  customerId: string,
  projectId?: string | null
): Promise<CustomerProjectCheckResult> {
  if (!customerId) return { error: "CUSTOMER_REQUIRED" };
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return { error: "CUSTOMER_NOT_FOUND" };
  if (projectId) {
    const project = await prisma.customerProject.findUnique({ where: { id: projectId } });
    if (!project || project.customerId !== customerId) return { error: "PROJECT_NOT_BELONG_TO_CUSTOMER" };
  }
  return { ok: true };
}

export type CreateNonMotorRecordInput = {
  processingDate: string;
  customerId: string;
  projectId?: string | null;
  insuranceType: string;
  insurerName?: string | null;
  effectiveDate: string;
  expiryDate: string;
  customerPremium: number | string;
  insurerCost: number | string;
  remarks?: string | null;
  // Phase 3A: set only when this record is created via the quotation detail
  // page's "Create Policy" action (see policy/non-motor/new/page.tsx's
  // "fromQuotationId" flow) — never required for manual creation.
  sourceQuotationId?: string | null;
  // Commission is deliberately not part of Non-Motor creation, same as
  // Motor (Phase 2B form cleanup) — every new record starts
  // commissionReceived=false with null amount/date; commission is only ever
  // set afterward via the Financial tab's Edit Commission action
  // (updateCommissionAction, reused unchanged from policy/motor/actions.ts).
};

export async function createNonMotorRecordAction(
  data: CreateNonMotorRecordInput
): Promise<ActionResult<{ id: string; recordNumber: string }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const customerCheck = await validateCustomerAndProject(data.customerId, data.projectId);
  if ("error" in customerCheck) return { success: false, error: customerCheck.error };

  if (!data.insuranceType?.trim()) return { success: false, error: "INSURANCE_TYPE_REQUIRED" };
  if (!isNonMotorCoverType(data.insuranceType)) return { success: false, error: "INVALID_INSURANCE_TYPE" };
  if (!data.processingDate) return { success: false, error: "PROCESSING_DATE_REQUIRED" };
  if (!data.effectiveDate || !data.expiryDate) return { success: false, error: "DATES_REQUIRED" };
  if (isBlank(data.customerPremium) || Number(data.customerPremium) < 0) {
    return { success: false, error: "CLIENT_PREMIUM_INVALID" };
  }
  if (isBlank(data.insurerCost) || Number(data.insurerCost) < 0) {
    return { success: false, error: "INSURER_COST_INVALID" };
  }

  const effectiveDate = new Date(data.effectiveDate);
  const expiryDate = new Date(data.expiryDate);
  if (expiryDate < effectiveDate) return { success: false, error: "EXPIRY_BEFORE_EFFECTIVE" };

  // Phase 3A: resolve + validate the source quotation exactly like Motor's
  // createMotorRecordAction (see that function's doc comments) — eligible
  // (ISSUED/ACCEPTED) finalized state required, plus (new for this phase,
  // per its own spec) the submitted customer must match the quotation's
  // actual customer, so a form that was prefilled from one quotation can
  // never be resubmitted against a different customer while still claiming
  // that quotation's link.
  const sourceQuotation = data.sourceQuotationId
    ? await prisma.quotation.findUnique({
        where: { id: data.sourceQuotationId },
        select: {
          id: true,
          quotationNumber: true,
          quotationCaseId: true,
          revisionStatus: true,
          revisionCode: true,
          quotationDate: true,
          customerId: true,
        },
      })
    : null;

  if (sourceQuotation) {
    if (sourceQuotation.revisionStatus !== "ISSUED" && sourceQuotation.revisionStatus !== "ACCEPTED") {
      return { success: false, error: "QUOTATION_NOT_ELIGIBLE" };
    }
    if (sourceQuotation.customerId !== data.customerId) {
      return { success: false, error: "QUOTATION_CUSTOMER_MISMATCH" };
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const recordNumber = await generatePolicyRecordNumber(tx, "NON_MOTOR");
      const businessStatus = computeBusinessStatus(effectiveDate, expiryDate, "DRAFT");

      const created = await tx.policyRecord.create({
        data: {
          recordNumber,
          category: "NON_MOTOR",
          processingDate: new Date(data.processingDate),
          customerId: data.customerId,
          projectId: data.projectId || null,
          insurerName: data.insurerName?.trim() || null,
          effectiveDate,
          expiryDate,
          businessStatus,
          customerPremium: toDecimal(data.customerPremium),
          insurerCost: toDecimal(data.insurerCost),
          commissionReceived: false,
          commissionAmount: null,
          commissionReceivedDate: null,
          source: "MANUAL",
          remarks: data.remarks?.trim() || null,
          createdById: session.user.id,
          sourceQuotationId: sourceQuotation?.id ?? null,
          sourceQuotationNumberSnapshot: sourceQuotation?.quotationNumber ?? null,
          sourceQuotationRevisionSnapshot: sourceQuotation?.revisionCode ?? null,
          sourceQuotationDateSnapshot: sourceQuotation?.quotationDate ?? null,
          nonMotorDetail: {
            create: {
              insuranceType: data.insuranceType as NonMotorCoverType,
            },
          },
        },
      });

      await recordPolicyActivity(tx, {
        policyRecordId: created.id,
        actionType: "POLICY_CREATED",
        summary: sourceQuotation
          ? `Non-Motor policy ${recordNumber} created from quotation ${sourceQuotation.quotationNumber}`
          : `Non-Motor policy ${recordNumber} created`,
        performedById: session.user.id,
      });

      // Mirrors Motor's Phase 2B correction: never mutates
      // QuotationCase.status — only the observational activity entry.
      if (sourceQuotation?.quotationCaseId) {
        await tx.quotationCaseActivity.create({
          data: {
            quotationCaseId: sourceQuotation.quotationCaseId,
            actionType: "POLICY_CREATED",
            summary: `Policy ${recordNumber} created`,
            performedById: session.user.id,
          },
        });
      }

      return created;
    });

    revalidatePath("/policy/non-motor");
    if (sourceQuotation?.quotationCaseId) {
      revalidatePath(`/quotation/${sourceQuotation.id}`);
      revalidatePath(`/quotation/case/${sourceQuotation.quotationCaseId}`);
    }
    return { success: true, id: result.id, recordNumber: result.recordNumber };
  } catch (err) {
    console.error("Failed to create Non-Motor policy record:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

export type UpdateNonMotorOverviewInput = {
  processingDate: string;
  customerId: string;
  projectId?: string | null;
  insuranceType: string;
  insurerName?: string | null;
  policyNumber?: string | null;
  effectiveDate: string;
  expiryDate: string;
  customerPremium: number | string;
  insurerCost: number | string;
  remarks?: string | null;
  cancelled: boolean;
};

// Mirrors updateMotorOverviewAction exactly: recomputes businessStatus from
// the (possibly just-edited) dates unless explicitly cancelled; never
// touches customerReceipts/providerPayments/commission/documents/activity
// history/sourceQuotation* — those are edited only through their own
// dedicated actions.
export async function updateNonMotorOverviewAction(
  id: string,
  data: UpdateNonMotorOverviewInput
): Promise<ActionResult> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const existing = await prisma.policyRecord.findUnique({ where: { id, deletedAt: null, category: "NON_MOTOR" } });
  if (!existing) return { success: false, error: "RECORD_NOT_FOUND" };

  const customerCheck = await validateCustomerAndProject(data.customerId, data.projectId);
  if ("error" in customerCheck) return { success: false, error: customerCheck.error };

  if (!data.insuranceType?.trim()) return { success: false, error: "INSURANCE_TYPE_REQUIRED" };
  if (!isNonMotorCoverType(data.insuranceType)) return { success: false, error: "INVALID_INSURANCE_TYPE" };

  const effectiveDate = new Date(data.effectiveDate);
  const expiryDate = new Date(data.expiryDate);
  if (expiryDate < effectiveDate) return { success: false, error: "EXPIRY_BEFORE_EFFECTIVE" };

  const businessStatus = data.cancelled
    ? "CANCELLED"
    : computeBusinessStatus(effectiveDate, expiryDate, existing.businessStatus === "CANCELLED" ? "DRAFT" : existing.businessStatus);

  const isNewCancellation = existing.businessStatus !== "CANCELLED" && businessStatus === "CANCELLED";

  try {
    await prisma.$transaction(async (tx) => {
      await tx.policyRecord.update({
        where: { id },
        data: {
          processingDate: new Date(data.processingDate),
          customerId: data.customerId,
          projectId: data.projectId || null,
          insurerName: data.insurerName?.trim() || null,
          effectiveDate,
          expiryDate,
          businessStatus,
          customerPremium: toDecimal(data.customerPremium),
          insurerCost: toDecimal(data.insurerCost),
          remarks: data.remarks?.trim() || null,
          updatedById: session.user.id,
        },
      });
      await tx.nonMotorPolicyDetail.update({
        where: { policyRecordId: id },
        data: {
          insuranceType: data.insuranceType as NonMotorCoverType,
          policyNumber: data.policyNumber?.trim() || null,
        },
      });
      await recordPolicyActivity(tx, {
        policyRecordId: id,
        actionType: isNewCancellation ? "POLICY_CANCELLED" : "POLICY_UPDATED",
        summary: isNewCancellation ? "Non-Motor policy cancelled" : "Non-Motor policy details updated",
        performedById: session.user.id,
      });
    });

    revalidatePath("/policy/non-motor");
    revalidatePath(`/policy/non-motor/${id}`);
    return { success: true };
  } catch (err) {
    console.error("Failed to update Non-Motor policy record:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}
