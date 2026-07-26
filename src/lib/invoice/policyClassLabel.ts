import type { NonMotorCoverType } from "@/lib/policy/nonMotorCoverTypes";
import type { BondType } from "@/lib/policy/bondTypes";
import type { WorkPermitType } from "@/lib/policy/workPermitTypes";

// Server-side (no React/i18n-hook context) English business labels for the
// {{POLICY_CLASS}} Invoice placeholder and InvoiceItem.policyClassSnapshot.
// Deliberately English-only and independent of the viewer's UI locale — an
// issued Invoice is a fixed business document (the user's Excel template
// itself is English-only), not a live-translated UI surface, so the
// snapshot must not change if the app's locale setting changes later.
// Values mirror the existing display text in src/i18n/dictionaries/en.ts
// exactly, so this reads the same as everywhere else in the app.

// Motor's insuranceType has no dictionary label map anywhere in this
// codebase (see src/lib/policy/motorCoverTypes.ts's doc comment — it is
// free text, not an enum, shown as-is on every Motor list/detail screen
// already) — reused unchanged here, never re-cased or reformatted.

const NON_MOTOR_COVER_LABELS: Record<NonMotorCoverType, string> = {
  CONTRACTORS_ALL_RISKS: "Contractor's All Risks (CAR)",
  WIBA: "WIBA",
  EMPLOYERS_LIABILITY: "Employer's Liability (EL)",
  CONTRACTORS_PLANT_MACHINERY: "Contractors Plant & Machinery (CPM)",
  PUBLIC_LIABILITY: "Public Liability (PL)",
  FIRE_ALLIED_PERILS: "Fire & Allied Perils",
  BURGLARY: "Burglary",
  GOODS_IN_TRANSIT_SINGLE: "Goods in Transit – Single",
  GOODS_IN_TRANSIT_ANNUAL: "Goods in Transit – Annual",
  MARINE: "Marine",
  GROUP_PERSONAL_ACCIDENT: "Group Personal Accident (GPA)",
  GROUP_MEDICAL: "Group Medical",
};

const BOND_TYPE_LABELS: Record<BondType, string> = {
  TENDER_BOND: "Tender Bond",
  PERFORMANCE_BOND: "Performance Bond",
  ADVANCE_PAYMENT_GUARANTEE: "Advance Payment Guarantee",
  CUSTOM_BOND: "Custom Bond",
};

const WORK_PERMIT_TYPE_LABELS: Record<WorkPermitType, string> = {
  CLASS_D: "Class D Work Permit",
  CLASS_G: "Class G Work Permit",
  SPECIAL_PASS: "Special Pass",
  DEPENDANT_PASS: "Dependant Pass",
  OTHER: "Other",
};

export type PolicyClassSource =
  | { category: "MOTOR"; insuranceType: string }
  | { category: "NON_MOTOR"; insuranceType: NonMotorCoverType }
  | { category: "BOND"; bondType: BondType; customBondType: string | null }
  | { category: "WORK_PERMIT"; permitType: WorkPermitType; otherPermitType: string | null };

// Bond's "Custom Bond – <customBondType>" format is spelled out explicitly
// in this phase's spec (as distinct from the Bond list table's swap-in-only
// convention) — an Invoice line item needs to stay unambiguous even without
// the surrounding "Type of Bond" field for context. Work Permit's OTHER
// case mirrors the same "<generic label> – <entered text>" shape for the
// same reason.
export function getPolicyClassLabel(source: PolicyClassSource): string {
  switch (source.category) {
    case "MOTOR":
      return source.insuranceType;
    case "NON_MOTOR":
      return NON_MOTOR_COVER_LABELS[source.insuranceType];
    case "BOND":
      if (source.bondType === "CUSTOM_BOND" && source.customBondType?.trim()) {
        return `${BOND_TYPE_LABELS.CUSTOM_BOND} – ${source.customBondType.trim()}`;
      }
      return BOND_TYPE_LABELS[source.bondType];
    case "WORK_PERMIT":
      if (source.permitType === "OTHER" && source.otherPermitType?.trim()) {
        return `${WORK_PERMIT_TYPE_LABELS.OTHER} – ${source.otherPermitType.trim()}`;
      }
      return WORK_PERMIT_TYPE_LABELS[source.permitType];
  }
}
