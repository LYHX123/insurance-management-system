"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { canEdit, POLICY_CATEGORY_PERMISSION } from "@/lib/permissions";
import { toDecimal } from "@/lib/money";
import { generatePolicyRecordNumber } from "@/lib/policy/recordNumber";
import { computeBusinessStatus } from "@/lib/policy/status";
import { recordPolicyActivity } from "@/lib/policy/activity";
import { RENEWAL_CATEGORY_ROUTE } from "@/lib/policy/renewal";
import { isMotorTaxClass, type MotorTaxClass } from "@/lib/policy/motorTaxClasses";
import { isNonMotorCoverType } from "@/lib/policy/nonMotorCoverTypes";
import { isBondType, bondTypeAllowsNoExpiry } from "@/lib/policy/bondTypes";
import { isWorkPermitType } from "@/lib/policy/workPermitTypes";
import type { PolicyCategory, NonMotorCoverType, BondType, WorkPermitType } from "@/generated/prisma/enums";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

// Permission is resolved from the source policy's REAL category — same
// convention as invoice/motor financial actions.
async function requireRenewalPermission(category: PolicyCategory) {
  const session = await auth();
  const key = POLICY_CATEGORY_PERMISSION[category];
  if (!session?.user || !key || !canEdit(session.user, key)) return null;
  return session;
}

// ---------------------------------------------------------------------------
// Renewal decision (Do Not Renew / Reopen)
// ---------------------------------------------------------------------------

export async function setPolicyRenewalDecisionAction(
  policyId: string,
  decision: "NOT_RENEWED" | "PENDING",
  note?: string | null
): Promise<ActionResult> {
  const record = await prisma.policyRecord.findUnique({
    where: { id: policyId, deletedAt: null },
    select: { id: true, category: true, recordNumber: true, renewalDecision: true, renewedBy: { select: { id: true } } },
  });
  if (!record) return { success: false, error: "RECORD_NOT_FOUND" };

  const session = await requireRenewalPermission(record.category);
  if (!session) return { success: false, error: "FORBIDDEN" };

  // Never touch a period that already has a successor renewal.
  if (record.renewedBy) return { success: false, error: "HAS_SUCCESSOR" };

  if (decision === "NOT_RENEWED") {
    if (record.renewalDecision === "NOT_RENEWED") return { success: false, error: "ALREADY_NOT_RENEWED" };
    if (record.renewalDecision === "RENEWED") return { success: false, error: "ALREADY_RENEWED" };
  } else {
    // Reopen: only valid from NOT_RENEWED.
    if (record.renewalDecision !== "NOT_RENEWED") return { success: false, error: "NOT_REOPENABLE" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.policyRecord.update({
        where: { id: policyId },
        data: { renewalDecision: decision, updatedById: session.user.id },
      });
      await recordPolicyActivity(tx, {
        policyRecordId: policyId,
        actionType: "POLICY_NOT_RENEWED",
        summary: decision === "NOT_RENEWED" ? "Renewal decision: Do Not Renew" : "Renewal decision reopened",
        details: note?.trim() || null,
        performedById: session.user.id,
      });
    });
    revalidatePath(`${RENEWAL_CATEGORY_ROUTE[record.category]}/${policyId}`);
    revalidatePath(RENEWAL_CATEGORY_ROUTE[record.category]);
    return { success: true };
  } catch (err) {
    console.error("Failed to update renewal decision:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

// ---------------------------------------------------------------------------
// Renew Policy
// ---------------------------------------------------------------------------

export type RenewPolicyInput = {
  processingDate: string;
  effectiveDate: string;
  // Phase 13C — "" / null accepted only when renewing a Security Bond
  // (category BOND + bond.bondType === SECURITY_BOND); required otherwise.
  expiryDate: string | null;
  insurerName?: string | null;
  currency: string;
  customerPremium: number | string;
  insurerCost: number | string;
  remarks?: string | null;
  // Category-specific new-period detail — exactly one is used, matching the
  // source policy's category.
  motor?: {
    registrationNumber: string;
    insuranceType: string;
    taxClass?: string | null;
    vehicleValue?: number | string | null;
    vehicleMake?: string | null;
    vehicleModel?: string | null;
    policyNumber?: string | null;
  };
  nonMotor?: { insuranceType: string; policyNumber?: string | null };
  bond?: { bondType: string; bondAmount: number | string; customBondType?: string | null; policyNumber?: string | null };
  workPermit?: { permitType: string; agent: string; otherPermitType?: string | null; permitNumber?: string | null };
};

const SOURCE_INCLUDE = {
  motorDetail: true,
  nonMotorDetail: true,
  bondDetail: true,
  workPermitDetail: true,
  renewedBy: { select: { id: true } },
} satisfies Prisma.PolicyRecordInclude;

export async function renewPolicyAction(
  sourcePolicyId: string,
  data: RenewPolicyInput
): Promise<ActionResult<{ id: string; recordNumber: string; category: PolicyCategory }>> {
  const source = await prisma.policyRecord.findUnique({
    where: { id: sourcePolicyId, deletedAt: null },
    include: SOURCE_INCLUDE,
  });
  if (!source) return { success: false, error: "RECORD_NOT_FOUND" };

  const session = await requireRenewalPermission(source.category);
  if (!session) return { success: false, error: "FORBIDDEN" };

  if (source.renewedBy) return { success: false, error: "POLICY_ALREADY_RENEWED" };
  if (source.renewalDecision === "NOT_RENEWED") return { success: false, error: "POLICY_NOT_RENEWABLE" };

  if (!data.processingDate || !data.effectiveDate) {
    return { success: false, error: "DATES_REQUIRED" };
  }
  const effectiveDate = new Date(data.effectiveDate);
  const processingDate = new Date(data.processingDate);
  if (Number.isNaN(effectiveDate.getTime()) || Number.isNaN(processingDate.getTime())) {
    return { success: false, error: "DATES_REQUIRED" };
  }

  // Phase 13C — expiry date is optional only when this renewal's new period
  // is a Security Bond; mandatory for every other category / Bond type. An
  // empty value is persisted as a genuine null, never a placeholder date.
  const renewalAllowsNoExpiry = source.category === "BOND" && bondTypeAllowsNoExpiry(data.bond?.bondType);
  const rawExpiry = typeof data.expiryDate === "string" ? data.expiryDate.trim() : "";
  let expiryDate: Date | null = null;
  if (rawExpiry) {
    expiryDate = new Date(rawExpiry);
    if (Number.isNaN(expiryDate.getTime())) return { success: false, error: "DATES_REQUIRED" };
    if (expiryDate < effectiveDate) return { success: false, error: "EXPIRY_BEFORE_EFFECTIVE" };
  } else if (!renewalAllowsNoExpiry) {
    return { success: false, error: "EXPIRY_DATE_REQUIRED" };
  }
  if (isBlank(data.customerPremium) || Number(data.customerPremium) < 0) return { success: false, error: "CLIENT_PREMIUM_INVALID" };
  if (isBlank(data.insurerCost) || Number(data.insurerCost) < 0) return { success: false, error: "INSURER_COST_INVALID" };

  // Validate the category-specific block and build the nested detail create.
  const detailResult = buildRenewalDetailCreate(source.category, source, data);
  if ("error" in detailResult) return { success: false, error: detailResult.error };

  const rootPolicyId = source.rootPolicyId ?? source.id;
  const renewalIndex = source.renewalIndex + 1;
  const businessStatus = computeBusinessStatus(effectiveDate, expiryDate, "DRAFT");

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Row-lock the source so two concurrent renewals serialise here; the
      // real guarantee is renewedFromId @unique (the loser's insert fails).
      await tx.$queryRaw`SELECT id FROM "PolicyRecord" WHERE id = ${sourcePolicyId} FOR UPDATE`;
      const fresh = await tx.policyRecord.findUnique({
        where: { id: sourcePolicyId },
        select: { renewalDecision: true, renewedBy: { select: { id: true } } },
      });
      if (!fresh) throw new RenewalConflict("RECORD_NOT_FOUND");
      if (fresh.renewedBy) throw new RenewalConflict("POLICY_ALREADY_RENEWED");
      if (fresh.renewalDecision === "NOT_RENEWED") throw new RenewalConflict("POLICY_NOT_RENEWABLE");

      const recordNumber = await generatePolicyRecordNumber(tx, source.category);

      const renewal = await tx.policyRecord.create({
        data: {
          recordNumber,
          category: source.category,
          processingDate,
          customer: { connect: { id: source.customerId } },
          project: source.projectId ? { connect: { id: source.projectId } } : undefined,
          insurerName: (data.insurerName ?? source.insurerName)?.trim() || null,
          effectiveDate,
          expiryDate,
          businessStatus,
          currency: data.currency?.trim() || source.currency,
          customerPremium: toDecimal(data.customerPremium),
          insurerCost: toDecimal(data.insurerCost),
          // Financials start fresh — commission is NEVER copied (spec §15).
          commissionReceived: false,
          commissionAmount: null,
          commissionReceivedDate: null,
          source: "MANUAL",
          remarks: data.remarks?.trim() || null,
          // Phase 12A — the customer-side contact person carries forward
          // (spec §5/§23); still editable later via the normal edit form.
          customerContactPerson: source.customerContactPerson,
          // Renewal chain wiring.
          renewedFrom: { connect: { id: source.id } },
          rootPolicy: { connect: { id: rootPolicyId } },
          renewalIndex,
          renewalDecision: "PENDING",
          createdById: session.user.id,
          ...detailResult.create,
        },
      });

      // Previous period: explicit RENEWED business status (sticky — see
      // computeBusinessStatus) + renewal decision.
      await tx.policyRecord.update({
        where: { id: sourcePolicyId },
        data: { renewalDecision: "RENEWED", businessStatus: "RENEWED", updatedById: session.user.id },
      });

      const details = `sourcePolicyRecordId=${source.id}; renewedPolicyRecordId=${renewal.id}; renewalIndex=${renewalIndex}`;
      await recordPolicyActivity(tx, {
        policyRecordId: source.id,
        actionType: "POLICY_RENEWED",
        summary: `Policy renewed to ${recordNumber}`,
        details,
        performedById: session.user.id,
      });
      await recordPolicyActivity(tx, {
        policyRecordId: renewal.id,
        actionType: "POLICY_RENEWED",
        summary: `Renewed from ${source.recordNumber}`,
        details,
        performedById: session.user.id,
      });

      return renewal;
    });

    const route = RENEWAL_CATEGORY_ROUTE[source.category];
    revalidatePath(route);
    revalidatePath(`${route}/${sourcePolicyId}`);
    revalidatePath(`${route}/${created.id}`);
    return { success: true, id: created.id, recordNumber: created.recordNumber, category: source.category };
  } catch (err) {
    if (err instanceof RenewalConflict) return { success: false, error: err.code };
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { success: false, error: "POLICY_ALREADY_RENEWED" };
    }
    console.error("Failed to renew policy:", err);
    return { success: false, error: "RENEW_FAILED" };
  }
}

class RenewalConflict extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

type SourceRecord = Prisma.PolicyRecordGetPayload<{ include: typeof SOURCE_INCLUDE }>;

type RenewalDetailCreate = Pick<
  Prisma.PolicyRecordCreateInput,
  "motorDetail" | "nonMotorDetail" | "bondDetail" | "workPermitDetail"
>;

// Builds the nested `{ motorDetail: { create: {...} } }` (etc.) for the
// renewal, validating the category-specific block. Copies the fields that
// normally carry between periods; everything is still editable in the form.
function buildRenewalDetailCreate(
  category: PolicyCategory,
  source: SourceRecord,
  data: RenewPolicyInput
): { error: string } | { create: RenewalDetailCreate } {
  if (category === "MOTOR") {
    const m = data.motor;
    if (!m) return { error: "MOTOR_DETAIL_REQUIRED" };
    if (!m.registrationNumber?.trim()) return { error: "REGISTRATION_NUMBER_REQUIRED" };
    if (!m.insuranceType?.trim()) return { error: "INSURANCE_TYPE_REQUIRED" };
    if (m.taxClass && !isMotorTaxClass(m.taxClass)) return { error: "INVALID_TAX_CLASS" };
    return {
      create: {
        motorDetail: {
          create: {
            insuranceType: m.insuranceType.trim(),
            registrationNumber: m.registrationNumber.trim().toUpperCase(),
            taxClass: m.taxClass ? (m.taxClass as MotorTaxClass) : source.motorDetail?.taxClass ?? null,
            vehicleValue: isBlank(m.vehicleValue) ? null : toDecimal(m.vehicleValue as number | string),
            vehicleMake: m.vehicleMake?.trim() || null,
            vehicleModel: m.vehicleModel?.trim() || null,
            policyNumber: m.policyNumber?.trim() || null,
            // Phase 12C — a renewal NEVER inherits the previous period's
            // valuation state. Starts untracked (null); the user can begin a
            // fresh valuation workflow on the renewal via the normal edit.
            valuationStatus: null,
            assessedVehicleValue: null,
          },
        },
      },
    };
  }

  if (category === "NON_MOTOR") {
    const n = data.nonMotor;
    if (!n) return { error: "NON_MOTOR_DETAIL_REQUIRED" };
    if (!n.insuranceType?.trim() || !isNonMotorCoverType(n.insuranceType)) return { error: "INVALID_INSURANCE_TYPE" };
    return {
      create: {
        nonMotorDetail: {
          create: { insuranceType: n.insuranceType as NonMotorCoverType, policyNumber: n.policyNumber?.trim() || null },
        },
      },
    };
  }

  if (category === "BOND") {
    const b = data.bond;
    if (!b) return { error: "BOND_DETAIL_REQUIRED" };
    if (!b.bondType?.trim() || !isBondType(b.bondType)) return { error: "INVALID_BOND_TYPE" };
    if (isBlank(b.bondAmount) || Number(b.bondAmount) < 0) return { error: "BOND_AMOUNT_INVALID" };
    const isCustom = b.bondType === "CUSTOM_BOND";
    if (isCustom && !b.customBondType?.trim()) return { error: "CUSTOM_BOND_TYPE_REQUIRED" };
    return {
      create: {
        bondDetail: {
          create: {
            bondType: b.bondType as BondType,
            bondAmount: toDecimal(b.bondAmount),
            customBondType: isCustom ? b.customBondType!.trim() : null,
            policyNumber: b.policyNumber?.trim() || null,
          },
        },
      },
    };
  }

  // WORK_PERMIT
  const w = data.workPermit;
  if (!w) return { error: "WORK_PERMIT_DETAIL_REQUIRED" };
  if (!w.permitType?.trim() || !isWorkPermitType(w.permitType)) return { error: "INVALID_PERMIT_TYPE" };
  if (!w.agent?.trim()) return { error: "AGENT_REQUIRED" };
  const isOther = w.permitType === "OTHER";
  if (isOther && !w.otherPermitType?.trim()) return { error: "OTHER_PERMIT_TYPE_REQUIRED" };
  return {
    create: {
      workPermitDetail: {
        create: {
          permitType: w.permitType as WorkPermitType,
          agent: w.agent.trim(),
          otherPermitType: isOther ? w.otherPermitType!.trim() : null,
          permitNumber: w.permitNumber?.trim() || null,
        },
      },
    },
  };
}
