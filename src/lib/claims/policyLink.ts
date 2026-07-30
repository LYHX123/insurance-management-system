// Dropbox Integration Phase 7, Part 2 — Claim <-> Policy linkage. The
// "Linked Policy" selector's option lists (customer + category filtered,
// re-derived server-side on every page load) and the server-side
// validator every create/update action must call before persisting a
// policyRecordId (never trusts a client-supplied id on its own — Part 15.I5/
// I6: "Client Policy ID validated" / "Cross-customer Policy link rejected").
import { prisma } from "@/lib/prisma";
import type { ClaimPolicyOption } from "@/components/claims/types";
import type { PolicyCategory } from "@/generated/prisma/enums";

export async function getMotorPolicyLinkOptions(customerId: string): Promise<ClaimPolicyOption[]> {
  const policies = await prisma.policyRecord.findMany({
    where: { customerId, category: "MOTOR", deletedAt: null },
    select: {
      id: true,
      recordNumber: true,
      insurerName: true,
      effectiveDate: true,
      expiryDate: true,
      businessStatus: true,
      motorDetail: { select: { registrationNumber: true } },
    },
    orderBy: { processingDate: "desc" },
  });
  return policies.map((p) => ({
    id: p.id,
    recordNumber: p.recordNumber,
    numberPlate: p.motorDetail?.registrationNumber ?? null,
    insuranceTypeLabel: null,
    insurerName: p.insurerName,
    effectiveDate: p.effectiveDate.toISOString(),
    expiryDate: p.expiryDate.toISOString(),
    businessStatus: p.businessStatus,
  }));
}

export async function getNonMotorPolicyLinkOptions(customerId: string): Promise<ClaimPolicyOption[]> {
  const policies = await prisma.policyRecord.findMany({
    where: { customerId, category: "NON_MOTOR", deletedAt: null },
    select: {
      id: true,
      recordNumber: true,
      insurerName: true,
      effectiveDate: true,
      expiryDate: true,
      businessStatus: true,
      nonMotorDetail: { select: { insuranceType: true } },
    },
    orderBy: { processingDate: "desc" },
  });
  return policies.map((p) => ({
    id: p.id,
    recordNumber: p.recordNumber,
    numberPlate: null,
    insuranceTypeLabel: p.nonMotorDetail?.insuranceType ?? null,
    insurerName: p.insurerName,
    effectiveDate: p.effectiveDate.toISOString(),
    expiryDate: p.expiryDate.toISOString(),
    businessStatus: p.businessStatus,
  }));
}

export type PolicyLinkValidationResult = { ok: true } | { ok: false; error: "POLICY_NOT_FOUND" | "POLICY_CUSTOMER_MISMATCH" | "POLICY_CATEGORY_MISMATCH" };

// Re-resolves the Policy from the database and checks it against the
// Claim's OWN customerId/category — a selected policyRecordId is never
// trusted on its own (Part 7, requirement 7 / Part 15.I5-I6).
export async function validatePolicyLink(policyRecordId: string, customerId: string, category: PolicyCategory): Promise<PolicyLinkValidationResult> {
  const policy = await prisma.policyRecord.findUnique({ where: { id: policyRecordId, deletedAt: null }, select: { customerId: true, category: true } });
  if (!policy) return { ok: false, error: "POLICY_NOT_FOUND" };
  if (policy.customerId !== customerId) return { ok: false, error: "POLICY_CUSTOMER_MISMATCH" };
  if (policy.category !== category) return { ok: false, error: "POLICY_CATEGORY_MISMATCH" };
  return { ok: true };
}
