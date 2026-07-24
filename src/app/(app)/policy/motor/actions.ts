"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { toDecimal, type DecimalInput } from "@/lib/money";
import { generatePolicyRecordNumber } from "@/lib/policy/recordNumber";
import { computeBusinessStatus } from "@/lib/policy/status";
import { recordPolicyActivity } from "@/lib/policy/activity";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

async function requirePolicyPermission() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "policy")) return null;
  return session;
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

// Activity summaries are plain formatted strings (PolicyActivity.details is
// never Json — see that model's schema comment), so amounts are formatted
// once here rather than importing money-input.tsx's formatMoney, which is a
// "use client" module not meant to be pulled into server action code.
function formatKes(amount: DecimalInput): string {
  return Number(amount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

export type CreateMotorRecordInput = {
  processingDate: string;
  customerId: string;
  projectId?: string | null;
  insuranceType: string;
  registrationNumber: string;
  vehicleValue?: number | string | null;
  insurerName?: string | null;
  policyNumber?: string | null;
  effectiveDate: string;
  expiryDate: string;
  customerPremium: number | string;
  insurerCost: number | string;
  commissionReceived: boolean;
  commissionAmount?: number | string | null;
  commissionReceivedDate?: string | null;
  remarks?: string | null;
  // Phase 2A: set only when this record is created via the quotation
  // detail page's "Create Policy" action (see
  // src/app/(app)/quotation/[id]/page.tsx's "fromQuotationId" flow). Never
  // required — every other creation path (manual, historical import)
  // leaves this null forever.
  sourceQuotationId?: string | null;
};

export async function createMotorRecordAction(
  data: CreateMotorRecordInput
): Promise<ActionResult<{ id: string; recordNumber: string }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const customerCheck = await validateCustomerAndProject(data.customerId, data.projectId);
  if ("error" in customerCheck) return { success: false, error: customerCheck.error };

  if (!data.insuranceType?.trim()) return { success: false, error: "INSURANCE_TYPE_REQUIRED" };
  if (!data.registrationNumber?.trim()) return { success: false, error: "REGISTRATION_NUMBER_REQUIRED" };
  if (!data.processingDate) return { success: false, error: "PROCESSING_DATE_REQUIRED" };
  if (!data.effectiveDate || !data.expiryDate) return { success: false, error: "DATES_REQUIRED" };
  if (isBlank(data.customerPremium) || Number(data.customerPremium) < 0) {
    return { success: false, error: "CLIENT_PREMIUM_INVALID" };
  }
  if (isBlank(data.insurerCost) || Number(data.insurerCost) < 0) {
    return { success: false, error: "INSURER_COST_INVALID" };
  }
  // Commission business rule (Phase 1B, Section 1): received=false must never
  // carry an amount/date; received=true must always carry both, amount >= 0.
  // Enforced here (creation) and in updateCommissionAction — never at the DB
  // level (see PolicyRecord.commissionAmount's schema comment).
  if (data.commissionReceived) {
    if (isBlank(data.commissionAmount) || Number(data.commissionAmount) < 0) {
      return { success: false, error: "COMMISSION_AMOUNT_INVALID" };
    }
    if (!data.commissionReceivedDate) {
      return { success: false, error: "COMMISSION_DATE_REQUIRED" };
    }
  }

  const effectiveDate = new Date(data.effectiveDate);
  const expiryDate = new Date(data.expiryDate);
  if (expiryDate < effectiveDate) return { success: false, error: "EXPIRY_BEFORE_EFFECTIVE" };

  // Phase 2A: resolve the source quotation (if any) before the transaction —
  // a broken/unknown reference is never fatal to record creation, it's just
  // silently treated as "no quotation link" (this field is never
  // user-typed; it only ever arrives via the server-rendered "Create
  // Policy" flow, so a miss here means the link is stale, not a user error).
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
        },
      })
    : null;

  // Phase 2B: a real (found) source quotation must be in an eligible
  // finalized state (ISSUED or ACCEPTED) — DRAFT/SUPERSEDED/CANCELLED
  // revisions can never become a policy's source. Checked here (not just in
  // the UI/page layer) so directly posting a stale or manually-edited
  // fromQuotationId can never bypass the rule. A quotation that simply
  // wasn't found is left to the lenient "no link" fallback above/below —
  // this check only fires for a real quotation in the wrong status.
  if (sourceQuotation && sourceQuotation.revisionStatus !== "ISSUED" && sourceQuotation.revisionStatus !== "ACCEPTED") {
    return { success: false, error: "QUOTATION_NOT_ELIGIBLE" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const recordNumber = await generatePolicyRecordNumber(tx, "MOTOR");
      const businessStatus = computeBusinessStatus(effectiveDate, expiryDate, "DRAFT");

      const created = await tx.policyRecord.create({
        data: {
          recordNumber,
          category: "MOTOR",
          processingDate: new Date(data.processingDate),
          customerId: data.customerId,
          projectId: data.projectId || null,
          insurerName: data.insurerName?.trim() || null,
          effectiveDate,
          expiryDate,
          businessStatus,
          customerPremium: toDecimal(data.customerPremium),
          insurerCost: toDecimal(data.insurerCost),
          commissionReceived: data.commissionReceived,
          commissionAmount: data.commissionReceived ? toDecimal(data.commissionAmount as number | string) : null,
          commissionReceivedDate:
            data.commissionReceived && data.commissionReceivedDate ? new Date(data.commissionReceivedDate) : null,
          source: "MANUAL",
          remarks: data.remarks?.trim() || null,
          createdById: session.user.id,
          sourceQuotationId: sourceQuotation?.id ?? null,
          // Phase 2B: immutable audit snapshot, written only alongside a
          // real sourceQuotationId — never for manual/historical-import
          // creation (see PolicyRecord.sourceQuotationNumberSnapshot's
          // schema comment). Never refreshed after this point, even if the
          // quotation is later edited/superseded — that's the point: this
          // reflects what the quotation looked like at the moment this
          // specific policy was created from it.
          sourceQuotationNumberSnapshot: sourceQuotation?.quotationNumber ?? null,
          sourceQuotationRevisionSnapshot: sourceQuotation?.revisionCode ?? null,
          sourceQuotationDateSnapshot: sourceQuotation?.quotationDate ?? null,
          motorDetail: {
            create: {
              insuranceType: data.insuranceType.trim(),
              registrationNumber: data.registrationNumber.trim().toUpperCase(),
              vehicleValue: isBlank(data.vehicleValue) ? null : toDecimal(data.vehicleValue as number | string),
              policyNumber: data.policyNumber?.trim() || null,
            },
          },
        },
      });

      await recordPolicyActivity(tx, {
        policyRecordId: created.id,
        actionType: "POLICY_CREATED",
        summary: sourceQuotation
          ? `Motor policy ${recordNumber} created from quotation ${sourceQuotation.quotationNumber}`
          : `Motor policy ${recordNumber} created`,
        performedById: session.user.id,
      });

      // Phase 2B: mirror the event onto the quotation side only — this never
      // deletes/archives the quotation, and (per Phase 2B correction) it no
      // longer mutates QuotationCase.status to CONVERTED_TO_POLICY either.
      // A quotation/case can have several sections or vehicles and only
      // partial conversion; the case's own ACCEPTED/ISSUED status is left
      // exactly as the user set it. See "Policies Created" derived display
      // on the quotation detail page for a non-authoritative, purely
      // observational progress indicator instead.
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

    revalidatePath("/policy/motor");
    if (sourceQuotation?.quotationCaseId) {
      revalidatePath(`/quotation/${sourceQuotation.id}`);
      revalidatePath(`/quotation/case/${sourceQuotation.quotationCaseId}`);
    }
    return { success: true, id: result.id, recordNumber: result.recordNumber };
  } catch (err) {
    console.error("Failed to create Motor policy record:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

export type UpdateMotorOverviewInput = {
  processingDate: string;
  customerId: string;
  projectId?: string | null;
  insuranceType: string;
  registrationNumber: string;
  vehicleValue?: number | string | null;
  insurerName?: string | null;
  policyNumber?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  effectiveDate: string;
  expiryDate: string;
  customerPremium: number | string;
  insurerCost: number | string;
  remarks?: string | null;
  cancelled: boolean;
};

// Overview edits recompute businessStatus from the (possibly just-edited)
// effective/expiry dates unless the user explicitly cancels the record —
// cancellation is the only sticky, non-date-derived transition Phase 1A
// exposes (see computeBusinessStatus's doc comment; no renewal workflow yet).
export async function updateMotorOverviewAction(
  id: string,
  data: UpdateMotorOverviewInput
): Promise<ActionResult> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const existing = await prisma.policyRecord.findUnique({ where: { id, deletedAt: null } });
  if (!existing) return { success: false, error: "RECORD_NOT_FOUND" };

  const customerCheck = await validateCustomerAndProject(data.customerId, data.projectId);
  if ("error" in customerCheck) return { success: false, error: customerCheck.error };

  if (!data.insuranceType?.trim()) return { success: false, error: "INSURANCE_TYPE_REQUIRED" };
  if (!data.registrationNumber?.trim()) return { success: false, error: "REGISTRATION_NUMBER_REQUIRED" };

  const effectiveDate = new Date(data.effectiveDate);
  const expiryDate = new Date(data.expiryDate);
  if (expiryDate < effectiveDate) return { success: false, error: "EXPIRY_BEFORE_EFFECTIVE" };

  const businessStatus = data.cancelled
    ? "CANCELLED"
    : computeBusinessStatus(effectiveDate, expiryDate, existing.businessStatus === "CANCELLED" ? "DRAFT" : existing.businessStatus);

  // Only a genuine not-cancelled -> cancelled transition is logged as
  // POLICY_CANCELLED; every other edit (including re-saving an
  // already-cancelled record) is POLICY_UPDATED, so cancelling doesn't
  // produce a fresh "cancelled" entry on every subsequent edit.
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
      await tx.motorPolicyDetail.update({
        where: { policyRecordId: id },
        data: {
          insuranceType: data.insuranceType.trim(),
          registrationNumber: data.registrationNumber.trim().toUpperCase(),
          vehicleValue: isBlank(data.vehicleValue) ? null : toDecimal(data.vehicleValue as number | string),
          policyNumber: data.policyNumber?.trim() || null,
          vehicleMake: data.vehicleMake?.trim() || null,
          vehicleModel: data.vehicleModel?.trim() || null,
        },
      });
      await recordPolicyActivity(tx, {
        policyRecordId: id,
        actionType: isNewCancellation ? "POLICY_CANCELLED" : "POLICY_UPDATED",
        summary: isNewCancellation ? "Motor policy cancelled" : "Motor policy details updated",
        performedById: session.user.id,
      });
    });

    revalidatePath("/policy/motor");
    revalidatePath(`/policy/motor/${id}`);
    return { success: true };
  } catch (err) {
    console.error("Failed to update Motor policy record:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

export type AddCustomerReceiptInput = {
  receiptDate: string;
  amount: number | string;
  paymentMethod?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
};

export async function addCustomerReceiptAction(
  policyRecordId: string,
  data: AddCustomerReceiptInput
): Promise<ActionResult<{ id: string }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const record = await prisma.policyRecord.findUnique({ where: { id: policyRecordId, deletedAt: null } });
  if (!record) return { success: false, error: "RECORD_NOT_FOUND" };
  if (!data.receiptDate) return { success: false, error: "RECEIPT_DATE_REQUIRED" };
  if (isBlank(data.amount) || Number(data.amount) <= 0) return { success: false, error: "AMOUNT_INVALID" };

  try {
    const created = await prisma.$transaction(async (tx) => {
      const receipt = await tx.policyCustomerReceipt.create({
        data: {
          policyRecordId,
          receiptDate: new Date(data.receiptDate),
          amount: toDecimal(data.amount),
          paymentMethod: data.paymentMethod?.trim() || null,
          referenceNumber: data.referenceNumber?.trim() || null,
          notes: data.notes?.trim() || null,
          source: "MANUAL",
          createdById: session.user.id,
        },
      });
      await recordPolicyActivity(tx, {
        policyRecordId,
        actionType: "CUSTOMER_RECEIPT_ADDED",
        summary: `Customer receipt of KES ${formatKes(receipt.amount)} recorded`,
        performedById: session.user.id,
      });
      return receipt;
    });
    revalidatePath(`/policy/motor/${policyRecordId}`);
    return { success: true, id: created.id };
  } catch (err) {
    console.error("Failed to add customer receipt:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

export type AddProviderPaymentInput = {
  paymentDate: string;
  amount: number | string;
  paymentMethod?: string | null;
  referenceNumber?: string | null;
  notes?: string | null;
};

export async function addProviderPaymentAction(
  policyRecordId: string,
  data: AddProviderPaymentInput
): Promise<ActionResult<{ id: string }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const record = await prisma.policyRecord.findUnique({ where: { id: policyRecordId, deletedAt: null } });
  if (!record) return { success: false, error: "RECORD_NOT_FOUND" };
  if (!data.paymentDate) return { success: false, error: "PAYMENT_DATE_REQUIRED" };
  if (isBlank(data.amount) || Number(data.amount) <= 0) return { success: false, error: "AMOUNT_INVALID" };

  try {
    const created = await prisma.$transaction(async (tx) => {
      const payment = await tx.policyProviderPayment.create({
        data: {
          policyRecordId,
          paymentDate: new Date(data.paymentDate),
          amount: toDecimal(data.amount),
          paymentMethod: data.paymentMethod?.trim() || null,
          referenceNumber: data.referenceNumber?.trim() || null,
          notes: data.notes?.trim() || null,
          source: "MANUAL",
          createdById: session.user.id,
        },
      });
      await recordPolicyActivity(tx, {
        policyRecordId,
        actionType: "INSURER_PAYMENT_ADDED",
        summary: `Insurer payment of KES ${formatKes(payment.amount)} recorded`,
        performedById: session.user.id,
      });
      return payment;
    });
    revalidatePath(`/policy/motor/${policyRecordId}`);
    return { success: true, id: created.id };
  } catch (err) {
    console.error("Failed to add provider payment:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

export type ResolveBalanceVerificationInput = {
  side: "insurer" | "client";
  correctedAmount?: number | string | null;
  note: string;
};

// Phase 1A.2: manually resolves an UNVERIFIED historical balance from the
// Financial tab. Never invents a receipt/payment and never marks the policy
// "settled" — it only (a) optionally corrects the underlying insurerCost/
// customerPremium figure if the user says the imported one was wrong, and
// (b) flips *BalanceVerification to VERIFIED with an audit trail (note,
// resolvedAt, resolvedBy). Actual settlement/outstanding status is always
// computed live from customerPremium/insurerCost minus real receipts and
// payments (see computePaymentStatus) — nothing here shortcuts that.
// insurerBalanceWarningReason/clientBalanceWarningReason are deliberately
// left untouched so "originally BLANK_SOURCE_BALANCE, manually verified on
// <date> by <user>" both remain visible for audit.
export async function resolveBalanceVerificationAction(
  policyRecordId: string,
  data: ResolveBalanceVerificationInput
): Promise<ActionResult> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const record = await prisma.policyRecord.findUnique({ where: { id: policyRecordId, deletedAt: null } });
  if (!record) return { success: false, error: "RECORD_NOT_FOUND" };
  if (!data.note?.trim()) return { success: false, error: "RESOLUTION_NOTE_REQUIRED" };

  const verification = data.side === "insurer" ? record.insurerBalanceVerification : record.clientBalanceVerification;
  if (verification === "VERIFIED") return { success: false, error: "ALREADY_VERIFIED" };

  if (!isBlank(data.correctedAmount) && Number(data.correctedAmount) < 0) {
    return { success: false, error: "AMOUNT_INVALID" };
  }

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.policyRecord.update({
        where: { id: policyRecordId },
        data:
          data.side === "insurer"
            ? {
                insurerCost: isBlank(data.correctedAmount) ? undefined : toDecimal(data.correctedAmount as number | string),
                insurerBalanceVerification: "VERIFIED",
                insurerBalanceResolutionNote: data.note.trim(),
                insurerBalanceResolvedAt: now,
                insurerBalanceResolvedById: session.user.id,
              }
            : {
                customerPremium: isBlank(data.correctedAmount) ? undefined : toDecimal(data.correctedAmount as number | string),
                clientBalanceVerification: "VERIFIED",
                clientBalanceResolutionNote: data.note.trim(),
                clientBalanceResolvedAt: now,
                clientBalanceResolvedById: session.user.id,
              },
      });
      await recordPolicyActivity(tx, {
        policyRecordId,
        actionType: "BALANCE_VERIFIED",
        summary: data.side === "insurer" ? "Insurer balance verified" : "Client balance verified",
        performedById: session.user.id,
      });
    });
    revalidatePath(`/policy/motor/${policyRecordId}`);
    return { success: true };
  } catch (err) {
    console.error("Failed to resolve balance verification:", err);
    return { success: false, error: "RESOLVE_FAILED" };
  }
}

export type UpdateCommissionInput = {
  commissionReceived: boolean;
  commissionAmount?: number | string | null;
  commissionReceivedDate?: string | null;
};

// Phase 1B: the only way commission fields are edited after creation.
// Deliberately narrow (see this phase's spec) — never touches customer/
// insurer receipts or payments, never changes balances, never marks the
// policy "settled". Business rule mirrors createMotorRecordAction's:
// received=false forces amount/date to null; received=true requires both.
export async function updateCommissionAction(
  policyRecordId: string,
  data: UpdateCommissionInput
): Promise<ActionResult> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const record = await prisma.policyRecord.findUnique({ where: { id: policyRecordId, deletedAt: null } });
  if (!record) return { success: false, error: "RECORD_NOT_FOUND" };

  if (data.commissionReceived) {
    if (isBlank(data.commissionAmount) || Number(data.commissionAmount) < 0) {
      return { success: false, error: "COMMISSION_AMOUNT_INVALID" };
    }
    if (!data.commissionReceivedDate) {
      return { success: false, error: "COMMISSION_DATE_REQUIRED" };
    }
  }

  const commissionAmount = data.commissionReceived ? toDecimal(data.commissionAmount as number | string) : null;
  const commissionReceivedDate =
    data.commissionReceived && data.commissionReceivedDate ? new Date(data.commissionReceivedDate) : null;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.policyRecord.update({
        where: { id: policyRecordId },
        data: {
          commissionReceived: data.commissionReceived,
          commissionAmount,
          commissionReceivedDate,
          updatedById: session.user.id,
        },
      });
      await recordPolicyActivity(tx, {
        policyRecordId,
        actionType: "COMMISSION_UPDATED",
        summary: data.commissionReceived
          ? `Commission marked as received: KES ${formatKes(commissionAmount)}`
          : "Commission marked as not received",
        performedById: session.user.id,
      });
    });
    revalidatePath(`/policy/motor/${policyRecordId}`);
    return { success: true };
  } catch (err) {
    console.error("Failed to update commission:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}
