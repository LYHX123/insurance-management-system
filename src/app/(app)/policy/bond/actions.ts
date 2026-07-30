"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { toDecimal } from "@/lib/money";
import { generatePolicyRecordNumber } from "@/lib/policy/recordNumber";
import { computeBusinessStatus } from "@/lib/policy/status";
import { recordPolicyActivity } from "@/lib/policy/activity";
import { isBondType } from "@/lib/policy/bondTypes";
import type { BondType } from "@/generated/prisma/enums";
import { deletePolicyRecord, type DeletePolicyResult } from "@/lib/policy/deletePolicyRecord";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

// Phase 3B: intentionally self-contained, same convention as
// policy/non-motor/actions.ts (see that file's own doc comment) —
// addCustomerReceiptAction/addProviderPaymentAction/updateCommissionAction
// ARE genuinely reused as-is from policy/motor/actions.ts (already
// category-agnostic); only these small, single-purpose validators are
// duplicated per category.
async function requirePolicyPermission() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "policy.bond")) return null;
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

// Never trusts client-side conditional rendering for the Custom Bond field:
// customBondType is required only when bondType === CUSTOM_BOND, and is
// force-cleared (never persisted) for every other bondType regardless of
// what the client sent — see BondPolicyDetail.customBondType's schema
// comment.
function resolveCustomBondType(bondType: BondType, customBondType?: string | null): { error: string } | { value: string | null } {
  if (bondType === "CUSTOM_BOND") {
    const trimmed = customBondType?.trim();
    if (!trimmed) return { error: "CUSTOM_BOND_TYPE_REQUIRED" };
    return { value: trimmed };
  }
  return { value: null };
}

export type CreateBondRecordInput = {
  processingDate: string;
  customerId: string;
  projectId?: string | null;
  bondType: string;
  customBondType?: string | null;
  bondAmount: number | string;
  insurerName?: string | null;
  policyNumber?: string | null;
  effectiveDate: string;
  expiryDate: string;
  customerPremium: number | string;
  insurerCost: number | string;
  remarks?: string | null;
  // Phase 3B: set only via the quotation detail page's "Create Policy"
  // action (see policy/bond/new/page.tsx's "fromQuotationId" flow) — never
  // required for manual creation. Same pattern as Motor/Non-Motor.
  sourceQuotationId?: string | null;
  // Commission is deliberately not part of Bond creation, same as
  // Motor/Non-Motor — every new record starts commissionReceived=false with
  // null amount/date; commission is only ever set afterward via the
  // Financial tab's Edit Commission action (updateCommissionAction, reused
  // unchanged from policy/motor/actions.ts).
};

export async function createBondRecordAction(
  data: CreateBondRecordInput
): Promise<ActionResult<{ id: string; recordNumber: string }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const customerCheck = await validateCustomerAndProject(data.customerId, data.projectId);
  if ("error" in customerCheck) return { success: false, error: customerCheck.error };

  if (!data.bondType?.trim()) return { success: false, error: "BOND_TYPE_REQUIRED" };
  if (!isBondType(data.bondType)) return { success: false, error: "INVALID_BOND_TYPE" };

  const customBondTypeResult = resolveCustomBondType(data.bondType, data.customBondType);
  if ("error" in customBondTypeResult) return { success: false, error: customBondTypeResult.error };

  if (isBlank(data.bondAmount) || Number(data.bondAmount) <= 0) {
    return { success: false, error: "BOND_AMOUNT_INVALID" };
  }
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

  // Resolve + validate the source quotation exactly like Motor/Non-Motor's
  // create actions (see those functions' doc comments).
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
      const recordNumber = await generatePolicyRecordNumber(tx, "BOND");
      const businessStatus = computeBusinessStatus(effectiveDate, expiryDate, "DRAFT");

      const created = await tx.policyRecord.create({
        data: {
          recordNumber,
          category: "BOND",
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
          bondDetail: {
            create: {
              bondType: data.bondType as BondType,
              customBondType: customBondTypeResult.value,
              bondAmount: toDecimal(data.bondAmount),
              policyNumber: data.policyNumber?.trim() || null,
            },
          },
        },
      });

      await recordPolicyActivity(tx, {
        policyRecordId: created.id,
        actionType: "POLICY_CREATED",
        summary: sourceQuotation
          ? `Bond policy ${recordNumber} created from quotation ${sourceQuotation.quotationNumber}`
          : `Bond policy ${recordNumber} created`,
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

    revalidatePath("/policy/bond");
    if (sourceQuotation?.quotationCaseId) {
      revalidatePath(`/quotation/${sourceQuotation.id}`);
      revalidatePath(`/quotation/case/${sourceQuotation.quotationCaseId}`);
    }
    return { success: true, id: result.id, recordNumber: result.recordNumber };
  } catch (err) {
    console.error("Failed to create Bond policy record:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

export type UpdateBondOverviewInput = {
  processingDate: string;
  customerId: string;
  projectId?: string | null;
  bondType: string;
  customBondType?: string | null;
  bondAmount: number | string;
  insurerName?: string | null;
  policyNumber?: string | null;
  effectiveDate: string;
  expiryDate: string;
  customerPremium: number | string;
  insurerCost: number | string;
  remarks?: string | null;
  cancelled: boolean;
};

// Mirrors updateNonMotorOverviewAction exactly: recomputes businessStatus
// from the (possibly just-edited) dates unless explicitly cancelled; never
// touches customerReceipts/providerPayments/commission/documents/activity
// history/sourceQuotation* — those are edited only through their own
// dedicated actions.
export async function updateBondOverviewAction(
  id: string,
  data: UpdateBondOverviewInput
): Promise<ActionResult> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const existing = await prisma.policyRecord.findUnique({ where: { id, deletedAt: null, category: "BOND" } });
  if (!existing) return { success: false, error: "RECORD_NOT_FOUND" };

  const customerCheck = await validateCustomerAndProject(data.customerId, data.projectId);
  if ("error" in customerCheck) return { success: false, error: customerCheck.error };

  if (!data.bondType?.trim()) return { success: false, error: "BOND_TYPE_REQUIRED" };
  if (!isBondType(data.bondType)) return { success: false, error: "INVALID_BOND_TYPE" };

  const customBondTypeResult = resolveCustomBondType(data.bondType, data.customBondType);
  if ("error" in customBondTypeResult) return { success: false, error: customBondTypeResult.error };

  if (isBlank(data.bondAmount) || Number(data.bondAmount) <= 0) {
    return { success: false, error: "BOND_AMOUNT_INVALID" };
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
      await tx.bondPolicyDetail.update({
        where: { policyRecordId: id },
        data: {
          bondType: data.bondType as BondType,
          customBondType: customBondTypeResult.value,
          bondAmount: toDecimal(data.bondAmount),
          policyNumber: data.policyNumber?.trim() || null,
        },
      });
      await recordPolicyActivity(tx, {
        policyRecordId: id,
        actionType: isNewCancellation ? "POLICY_CANCELLED" : "POLICY_UPDATED",
        summary: isNewCancellation ? "Bond policy cancelled" : "Bond policy details updated",
        performedById: session.user.id,
      });
    });

    revalidatePath("/policy/bond");
    revalidatePath(`/policy/bond/${id}`);
    return { success: true };
  } catch (err) {
    console.error("Failed to update Bond policy record:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

// Permanent, admin-only delete — see deletePolicyRecord's own doc comment
// for the full relation/transaction breakdown.
export async function deleteBondPolicyAction(id: string, confirmedRecordNumber: string): Promise<DeletePolicyResult> {
  const result = await deletePolicyRecord(id, "BOND", confirmedRecordNumber);
  if (result.success) revalidatePath("/policy/bond");
  return result;
}
