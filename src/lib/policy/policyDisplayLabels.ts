// Phase 13A — enum -> user-facing label helpers for the Policy list column
// values (status, valuation, cover / bond / permit type, renewal period).
// One definition, so the on-screen list tables and the Excel export routes
// show identical text in both EN and 中文.

import type { Dictionary } from "@/i18n/dictionaries/en";
import type {
  NonMotorCoverType,
  BondType,
  WorkPermitType,
  PolicyRenewalDecision,
} from "@/generated/prisma/enums";
import type { PolicyBusinessStatus } from "@/components/policy/types";
import type { MotorValuationStatus } from "@/lib/policy/motorValuation";

export function policyBusinessStatusLabel(t: Dictionary, status: PolicyBusinessStatus): string {
  const map: Record<PolicyBusinessStatus, string> = {
    DRAFT: t.policy.statusDraft,
    ACTIVE: t.policy.statusActive,
    EXPIRED: t.policy.statusExpired,
    CANCELLED: t.policy.statusCancelled,
    RENEWED: t.policy.statusRenewed,
  };
  return map[status];
}

export function motorValuationBadgeLabel(t: Dictionary, status: MotorValuationStatus): string {
  const map: Record<MotorValuationStatus, string> = {
    NOT_ARRANGED: t.policy.valuationBadgeNotArranged,
    IN_PROGRESS: t.policy.valuationBadgeInProgress,
    COMPLETED: t.policy.valuationBadgeCompleted,
  };
  return map[status];
}

export function nonMotorCoverTypeLabel(t: Dictionary, type: NonMotorCoverType): string {
  const map: Record<NonMotorCoverType, string> = {
    CONTRACTORS_ALL_RISKS: t.policy.coverContractorsAllRisks,
    WIBA: t.policy.coverWiba,
    EMPLOYERS_LIABILITY: t.policy.coverEmployersLiability,
    CONTRACTORS_PLANT_MACHINERY: t.policy.coverContractorsPlantMachinery,
    PUBLIC_LIABILITY: t.policy.coverPublicLiability,
    FIRE_ALLIED_PERILS: t.policy.coverFireAlliedPerils,
    BURGLARY: t.policy.coverBurglary,
    GOODS_IN_TRANSIT_SINGLE: t.policy.coverGoodsInTransitSingle,
    GOODS_IN_TRANSIT_ANNUAL: t.policy.coverGoodsInTransitAnnual,
    MARINE: t.policy.coverMarine,
    GROUP_PERSONAL_ACCIDENT: t.policy.coverGroupPersonalAccident,
    GROUP_MEDICAL: t.policy.coverGroupMedical,
  };
  return map[type];
}

export function bondTypeLabel(t: Dictionary, type: BondType, customBondType?: string | null): string {
  if (type === "CUSTOM_BOND" && customBondType) return customBondType;
  const map: Record<BondType, string> = {
    TENDER_BOND: t.policy.bondTenderBond,
    PERFORMANCE_BOND: t.policy.bondPerformanceBond,
    ADVANCE_PAYMENT_GUARANTEE: t.policy.bondAdvancePaymentGuarantee,
    CUSTOM_BOND: t.policy.bondCustomBond,
  };
  return map[type];
}

export function workPermitTypeLabel(t: Dictionary, type: WorkPermitType, otherPermitType?: string | null): string {
  if (type === "OTHER" && otherPermitType) return otherPermitType;
  const map: Record<WorkPermitType, string> = {
    CLASS_D: t.policy.permitClassD,
    CLASS_G: t.policy.permitClassG,
    SPECIAL_PASS: t.policy.permitSpecialPass,
    DEPENDANT_PASS: t.policy.permitDependantPass,
    OTHER: t.policy.permitOther,
  };
  return map[type];
}

// The "Period / Renewal" indicator that the list shows as a compact badge
// next to the record number (see RenewalBadge). For the export it is always
// a concrete word: Original / Renewal N / Renewed / Not Renewed.
export function policyRenewalPeriodLabel(
  t: Dictionary,
  renewalIndex: number,
  renewalDecision: PolicyRenewalDecision | null
): string {
  if (renewalIndex >= 1) return t.policy.renewalNumbered.replace("{n}", String(renewalIndex));
  if (renewalDecision === "RENEWED") return t.policy.renewalRenewed;
  if (renewalDecision === "NOT_RENEWED") return t.policy.renewalNotRenewed;
  return t.policy.renewalOriginal;
}
