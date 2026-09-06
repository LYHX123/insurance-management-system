import { prisma } from "@/lib/prisma";
import type { PolicyCategory } from "@/generated/prisma/enums";
import type { RenewSource } from "@/components/policy/renew-policy-form";

// Shared loader for the 4 category-specific /renew routes — builds the
// RenewSource prefill from the source policy. Returns a `blocked` reason
// string instead of the source when the policy cannot be renewed (deleted,
// already has a successor, or marked Do Not Renew) so the route can render a
// friendly message rather than a broken form.
export type LoadRenewSourceResult =
  | { ok: true; source: RenewSource }
  | { ok: false; reason: "NOT_FOUND" | "ALREADY_RENEWED" | "NOT_RENEWABLE"; recordNumber: string | null };

export async function loadRenewSource(id: string, category: PolicyCategory): Promise<LoadRenewSourceResult> {
  const record = await prisma.policyRecord.findUnique({
    where: { id, category, deletedAt: null },
    include: {
      customer: { select: { companyName: true } },
      motorDetail: true,
      nonMotorDetail: true,
      bondDetail: true,
      workPermitDetail: true,
      renewedBy: { select: { id: true } },
    },
  });
  if (!record) return { ok: false, reason: "NOT_FOUND", recordNumber: null };
  if (record.renewedBy) return { ok: false, reason: "ALREADY_RENEWED", recordNumber: record.recordNumber };
  if (record.renewalDecision === "NOT_RENEWED") return { ok: false, reason: "NOT_RENEWABLE", recordNumber: record.recordNumber };

  const source: RenewSource = {
    id: record.id,
    recordNumber: record.recordNumber,
    category: record.category,
    customerName: record.customer.companyName,
    insurerName: record.insurerName,
    currency: record.currency,
    customerPremium: record.customerPremium.toString(),
    insurerCost: record.insurerCost.toString(),
    remarks: record.remarks,
    contactPerson: record.customerContactPerson,
    motor: record.motorDetail
      ? {
          registrationNumber: record.motorDetail.registrationNumber,
          insuranceType: record.motorDetail.insuranceType,
          taxClass: record.motorDetail.taxClass,
          vehicleValue: record.motorDetail.vehicleValue?.toString() ?? null,
          vehicleMake: record.motorDetail.vehicleMake,
          vehicleModel: record.motorDetail.vehicleModel,
          policyNumber: record.motorDetail.policyNumber,
        }
      : undefined,
    nonMotor: record.nonMotorDetail
      ? { insuranceType: record.nonMotorDetail.insuranceType, policyNumber: record.nonMotorDetail.policyNumber }
      : undefined,
    bond: record.bondDetail
      ? {
          bondType: record.bondDetail.bondType,
          bondAmount: record.bondDetail.bondAmount.toString(),
          customBondType: record.bondDetail.customBondType,
          policyNumber: record.bondDetail.policyNumber,
        }
      : undefined,
    workPermit: record.workPermitDetail
      ? {
          permitType: record.workPermitDetail.permitType,
          agent: record.workPermitDetail.agent,
          otherPermitType: record.workPermitDetail.otherPermitType,
          permitNumber: record.workPermitDetail.permitNumber,
        }
      : undefined,
  };
  return { ok: true, source };
}
