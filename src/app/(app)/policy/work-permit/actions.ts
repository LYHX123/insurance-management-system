"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { toDecimal } from "@/lib/money";
import { generatePolicyRecordNumber } from "@/lib/policy/recordNumber";
import { computeBusinessStatus } from "@/lib/policy/status";
import { recordPolicyActivity } from "@/lib/policy/activity";
import { isWorkPermitType } from "@/lib/policy/workPermitTypes";
import type { WorkPermitType } from "@/generated/prisma/enums";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

// Phase 3B: intentionally self-contained, same convention as
// policy/non-motor/actions.ts and policy/bond/actions.ts.
async function requirePolicyPermission() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "policy.work_permit")) return null;
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

// Never trusts client-side conditional rendering: otherPermitType is
// required only when permitType === OTHER, and is force-cleared (never
// persisted) for every other permitType regardless of what the client sent
// — same conditional pattern as Bond's resolveCustomBondType.
function resolveOtherPermitType(permitType: WorkPermitType, otherPermitType?: string | null): { error: string } | { value: string | null } {
  if (permitType === "OTHER") {
    const trimmed = otherPermitType?.trim();
    if (!trimmed) return { error: "OTHER_PERMIT_TYPE_REQUIRED" };
    return { value: trimmed };
  }
  return { value: null };
}

export type CreateWorkPermitRecordInput = {
  processingDate: string;
  customerId: string;
  projectId?: string | null;
  permitType: string;
  otherPermitType?: string | null;
  agent: string;
  permitNumber?: string | null;
  effectiveDate: string;
  expiryDate: string;
  customerPremium: number | string;
  // Labelled "Agent Cost" in every Work Permit UI — stored on the shared
  // PolicyRecord.insurerCost column so the existing PolicyProviderPayment
  // architecture (Add Payment / balance / status) works unchanged. See
  // WorkPermitPolicyDetail's schema comment.
  agentCost: number | string;
  remarks?: string | null;
  sourceQuotationId?: string | null;
};

export async function createWorkPermitRecordAction(
  data: CreateWorkPermitRecordInput
): Promise<ActionResult<{ id: string; recordNumber: string }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const customerCheck = await validateCustomerAndProject(data.customerId, data.projectId);
  if ("error" in customerCheck) return { success: false, error: customerCheck.error };

  if (!data.permitType?.trim()) return { success: false, error: "PERMIT_TYPE_REQUIRED" };
  if (!isWorkPermitType(data.permitType)) return { success: false, error: "INVALID_PERMIT_TYPE" };

  const otherPermitTypeResult = resolveOtherPermitType(data.permitType, data.otherPermitType);
  if ("error" in otherPermitTypeResult) return { success: false, error: otherPermitTypeResult.error };

  if (!data.agent?.trim()) return { success: false, error: "AGENT_REQUIRED" };
  if (!data.processingDate) return { success: false, error: "PROCESSING_DATE_REQUIRED" };
  if (!data.effectiveDate || !data.expiryDate) return { success: false, error: "DATES_REQUIRED" };
  if (isBlank(data.customerPremium) || Number(data.customerPremium) < 0) {
    return { success: false, error: "CLIENT_PREMIUM_INVALID" };
  }
  if (isBlank(data.agentCost) || Number(data.agentCost) < 0) {
    return { success: false, error: "AGENT_COST_INVALID" };
  }

  const effectiveDate = new Date(data.effectiveDate);
  const expiryDate = new Date(data.expiryDate);
  if (expiryDate < effectiveDate) return { success: false, error: "EXPIRY_BEFORE_EFFECTIVE" };

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
      const recordNumber = await generatePolicyRecordNumber(tx, "WORK_PERMIT");
      const businessStatus = computeBusinessStatus(effectiveDate, expiryDate, "DRAFT");

      const created = await tx.policyRecord.create({
        data: {
          recordNumber,
          category: "WORK_PERMIT",
          processingDate: new Date(data.processingDate),
          customerId: data.customerId,
          projectId: data.projectId || null,
          // Work Permit has no insurer concept — see
          // WorkPermitPolicyDetail's schema comment. Never set from any
          // Work Permit form field.
          insurerName: null,
          effectiveDate,
          expiryDate,
          businessStatus,
          customerPremium: toDecimal(data.customerPremium),
          insurerCost: toDecimal(data.agentCost),
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
          workPermitDetail: {
            create: {
              permitType: data.permitType as WorkPermitType,
              otherPermitType: otherPermitTypeResult.value,
              agent: data.agent.trim(),
              permitNumber: data.permitNumber?.trim() || null,
            },
          },
        },
      });

      await recordPolicyActivity(tx, {
        policyRecordId: created.id,
        actionType: "POLICY_CREATED",
        summary: sourceQuotation
          ? `Work Permit policy ${recordNumber} created from quotation ${sourceQuotation.quotationNumber}`
          : `Work Permit policy ${recordNumber} created`,
        performedById: session.user.id,
      });

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

    revalidatePath("/policy/work-permit");
    if (sourceQuotation?.quotationCaseId) {
      revalidatePath(`/quotation/${sourceQuotation.id}`);
      revalidatePath(`/quotation/case/${sourceQuotation.quotationCaseId}`);
    }
    return { success: true, id: result.id, recordNumber: result.recordNumber };
  } catch (err) {
    console.error("Failed to create Work Permit policy record:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

export type UpdateWorkPermitOverviewInput = {
  processingDate: string;
  customerId: string;
  projectId?: string | null;
  permitType: string;
  otherPermitType?: string | null;
  agent: string;
  permitNumber?: string | null;
  effectiveDate: string;
  expiryDate: string;
  customerPremium: number | string;
  agentCost: number | string;
  remarks?: string | null;
  cancelled: boolean;
};

export async function updateWorkPermitOverviewAction(
  id: string,
  data: UpdateWorkPermitOverviewInput
): Promise<ActionResult> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const existing = await prisma.policyRecord.findUnique({ where: { id, deletedAt: null, category: "WORK_PERMIT" } });
  if (!existing) return { success: false, error: "RECORD_NOT_FOUND" };

  const customerCheck = await validateCustomerAndProject(data.customerId, data.projectId);
  if ("error" in customerCheck) return { success: false, error: customerCheck.error };

  if (!data.permitType?.trim()) return { success: false, error: "PERMIT_TYPE_REQUIRED" };
  if (!isWorkPermitType(data.permitType)) return { success: false, error: "INVALID_PERMIT_TYPE" };

  const otherPermitTypeResult = resolveOtherPermitType(data.permitType, data.otherPermitType);
  if ("error" in otherPermitTypeResult) return { success: false, error: otherPermitTypeResult.error };

  if (!data.agent?.trim()) return { success: false, error: "AGENT_REQUIRED" };
  if (isBlank(data.customerPremium) || Number(data.customerPremium) < 0) {
    return { success: false, error: "CLIENT_PREMIUM_INVALID" };
  }
  if (isBlank(data.agentCost) || Number(data.agentCost) < 0) {
    return { success: false, error: "AGENT_COST_INVALID" };
  }

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
          effectiveDate,
          expiryDate,
          businessStatus,
          customerPremium: toDecimal(data.customerPremium),
          insurerCost: toDecimal(data.agentCost),
          remarks: data.remarks?.trim() || null,
          updatedById: session.user.id,
        },
      });
      await tx.workPermitPolicyDetail.update({
        where: { policyRecordId: id },
        data: {
          permitType: data.permitType as WorkPermitType,
          otherPermitType: otherPermitTypeResult.value,
          agent: data.agent.trim(),
          permitNumber: data.permitNumber?.trim() || null,
        },
      });
      await recordPolicyActivity(tx, {
        policyRecordId: id,
        actionType: isNewCancellation ? "POLICY_CANCELLED" : "POLICY_UPDATED",
        summary: isNewCancellation ? "Work Permit policy cancelled" : "Work Permit policy details updated",
        performedById: session.user.id,
      });
    });

    revalidatePath("/policy/work-permit");
    revalidatePath(`/policy/work-permit/${id}`);
    return { success: true };
  } catch (err) {
    console.error("Failed to update Work Permit policy record:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}
