import type { Prisma } from "@/generated/prisma/client";
import type { PolicyCategory } from "@/generated/prisma/enums";
import { QUOTATION_SECTION_KIND_TO_NON_MOTOR_COVER_TYPE } from "@/lib/policy/nonMotorCoverTypes";
import { QUOTATION_SECTION_KIND_TO_BOND_TYPE } from "@/lib/policy/bondTypes";
import type { NonMotorCoverType } from "@/lib/policy/nonMotorCoverTypes";
import type { BondType } from "@/lib/policy/bondTypes";
import type { MotorTaxClass } from "@/lib/policy/motorTaxClasses";

// Phase 1+2 "Generate Policy Records" — the single place that decides which
// QuotationSectionKind values can be safely, automatically turned into a
// PolicyRecord, and (for the kinds that can) which existing per-category
// creation fields are reliably derivable from the quotation section itself.
// Deliberately conservative: every mapping here reuses data the quotation
// already computed/stored (never invents a value) — see each branch's own
// comment for its exact source field. A sectionKind that has no branch below
// is UNSUPPORTED and must never be guessed at (Part 6 of this phase's spec).

// Mirrors MOTOR_SECTION_KIND_TO_COVER_TYPE's existing precedent in
// policy/motor/new/page.tsx (this project's established "single quotation
// prefill" mapping) — duplicated here (not imported) because that constant
// lives in a page module, not a shared lib, matching this codebase's
// existing convention of small, self-contained per-flow mapping tables
// (see e.g. nonMotorCoverTypes.ts's own doc comment on QUOTATION_SECTION_
// KIND_TO_NON_MOTOR_COVER_TYPE).
const MOTOR_SECTION_KIND_TO_COVER_TYPE: Record<string, string> = {
  MOTOR_COMP_PRIVATE: "COMPREHENSIVE",
  MOTOR_COMP_COMMERCIAL: "COMPREHENSIVE",
  MOTOR_TPO_PRIVATE: "THIRD PARTY",
  MOTOR_TPO_COMMERCIAL: "THIRD PARTY",
};

// Private/Commercial is already encoded in the sectionKind name itself
// (same structural fact the cover-type mapping above already reads) — this
// is not a guess about business data, it is reading the one piece of
// quotation data that already distinguishes these four section kinds.
const MOTOR_SECTION_KIND_TO_TAX_CLASS: Record<string, MotorTaxClass> = {
  MOTOR_COMP_PRIVATE: "PRIVATE",
  MOTOR_COMP_COMMERCIAL: "COMMERCIAL",
  MOTOR_TPO_PRIVATE: "PRIVATE",
  MOTOR_TPO_COMMERCIAL: "COMMERCIAL",
};

export const MOTOR_SECTION_KINDS = Object.keys(MOTOR_SECTION_KIND_TO_COVER_TYPE);
export const NON_MOTOR_SECTION_KINDS = Object.keys(QUOTATION_SECTION_KIND_TO_NON_MOTOR_COVER_TYPE);
// Only the three Bond kinds with a single, section-level bondValue are
// supported — CUSTOMS_BOND is deliberately excluded (see
// resolveSectionPolicyPlan's CUSTOMS_BOND comment below).
export const BOND_SECTION_KINDS = ["TENDER_SECURITY", "PERFORMANCE_BOND", "ADVANCE_PAYMENT_GUARANTEE"];

// Minimal shape this module needs from a QuotationInsuranceSection — callers
// select() exactly this (see generatePolicyRecordsAction.ts).
export type SectionForPolicyPlan = {
  id: string;
  sectionKind: string;
  sectionTotal: Prisma.Decimal;
  motorCompPrivateDetail: { plateNo: string; vehicleValue: Prisma.Decimal } | null;
  motorCompCommercialDetail: { plateNo: string; vehicleValue: Prisma.Decimal } | null;
  motorTpoPrivateDetail: { plateNo: string } | null;
  motorTpoCommercialDetail: { plateNo: string } | null;
  tenderSecurityDetail: { bondValue: Prisma.Decimal } | null;
  performanceBondDetail: { bondValue: Prisma.Decimal } | null;
  advancePaymentGuaranteeDetail: { bondValue: Prisma.Decimal } | null;
};

export type SectionPolicyPlan =
  | { supported: false }
  | {
      supported: true;
      category: "NON_MOTOR";
      insuranceType: NonMotorCoverType;
    }
  | {
      supported: true;
      category: "MOTOR";
      insuranceType: string;
      taxClass: MotorTaxClass;
      registrationNumber: string;
      vehicleValue: Prisma.Decimal | null;
    }
  | {
      supported: true;
      category: "BOND";
      bondType: BondType;
      bondAmount: Prisma.Decimal;
    };

// The one function every caller (UI section list + the batch generation
// action itself) uses to decide "is this section eligible, and if so what
// does it map to" — so the modal's display and the server action's actual
// creation logic can never silently disagree.
export function resolveSectionPolicyPlan(section: SectionForPolicyPlan): SectionPolicyPlan {
  const kind = section.sectionKind;

  if (NON_MOTOR_SECTION_KINDS.includes(kind)) {
    const insuranceType = QUOTATION_SECTION_KIND_TO_NON_MOTOR_COVER_TYPE[kind];
    if (!insuranceType) return { supported: false };
    return { supported: true, category: "NON_MOTOR", insuranceType };
  }

  if (MOTOR_SECTION_KINDS.includes(kind)) {
    const insuranceType = MOTOR_SECTION_KIND_TO_COVER_TYPE[kind];
    const taxClass = MOTOR_SECTION_KIND_TO_TAX_CLASS[kind];
    if (!insuranceType || !taxClass) return { supported: false };

    const detail =
      section.motorCompPrivateDetail ??
      section.motorCompCommercialDetail ??
      section.motorTpoPrivateDetail ??
      section.motorTpoCommercialDetail;
    // Every one of the four matched section kinds always carries its own
    // detail row with a required plateNo (see the *SectionDetail models'
    // schema) — a miss here means the section's structured detail is
    // genuinely missing (should not happen), never a value to guess.
    if (!detail?.plateNo?.trim()) return { supported: false };

    // Only the two Comprehensive detail models carry a vehicleValue at all
    // (Third Party cover has no insured vehicle value on the quotation side
    // — see MotorTpoPrivateSectionDetail/MotorTpoCommercialSectionDetail's
    // schema) — read explicitly from those two rather than a structural
    // "in" check, so this stays correct if a future detail model ever adds
    // an unrelated field that happens to share the name.
    const vehicleValue = section.motorCompPrivateDetail?.vehicleValue ?? section.motorCompCommercialDetail?.vehicleValue ?? null;

    return {
      supported: true,
      category: "MOTOR",
      insuranceType,
      taxClass,
      registrationNumber: detail.plateNo.trim().toUpperCase(),
      vehicleValue,
    };
  }

  // CUSTOMS_BOND is intentionally NOT in BOND_SECTION_KINDS: unlike the
  // other three Bond kinds, its bondValue/bondType live per-row on
  // CustomsBondItemRow (a section can legitimately carry several distinct
  // bond types/values at once) — there is no single, reliable "the"
  // bondAmount/bondType for the section as a whole, so picking one row would
  // be exactly the kind of guess Part 6 of this phase forbids. Marked
  // unsupported until a future phase adds a real "generate one Policy per
  // item row" flow.
  if (BOND_SECTION_KINDS.includes(kind)) {
    const bondType = QUOTATION_SECTION_KIND_TO_BOND_TYPE[kind as keyof typeof QUOTATION_SECTION_KIND_TO_BOND_TYPE];
    const detail = section.tenderSecurityDetail ?? section.performanceBondDetail ?? section.advancePaymentGuaranteeDetail;
    if (!bondType || !detail) return { supported: false };
    return { supported: true, category: "BOND", bondType, bondAmount: detail.bondValue };
  }

  return { supported: false };
}

export function policyCategoryForSectionKind(sectionKind: string): PolicyCategory | null {
  if (NON_MOTOR_SECTION_KINDS.includes(sectionKind)) return "NON_MOTOR";
  if (MOTOR_SECTION_KINDS.includes(sectionKind)) return "MOTOR";
  if (BOND_SECTION_KINDS.includes(sectionKind)) return "BOND";
  return null;
}

// Phase 6 "Customs Bond per-item generation" — unlike the section-level
// resolveSectionPolicyPlan above (which deliberately keeps CUSTOMS_BOND
// unsupported: there is no single, reliable section-level bondType/amount/
// premium), each CustomsBondItemRow individually DOES carry its own
// complete, reliable bondType/bondValue/premium — see that model's schema.
// This is the generation-unit-level counterpart used only by the
// CUSTOM_BOND_ITEM branch of generatePolicyRecordsAction, never by the
// SECTION branch. bondAmount/customerPremium are read from whatever row the
// caller passes in — callers must always pass a value freshly re-read from
// the database inside the generation transaction, never client-submitted
// data (see generatePolicyRecordsAction's own doc comment).
export type CustomsBondItemForPolicyPlan = {
  id: string;
  bondType: string;
  bondValue: Prisma.Decimal;
  premium: Prisma.Decimal;
};

export type CustomsBondItemPolicyPlan = {
  category: "BOND";
  bondType: "CUSTOM_BOND";
  // The item's own free-text bond type label (e.g. "CB1") — written into
  // BondPolicyDetail.customBondType so the resulting Policy/Invoice display
  // reads "Custom Bond – CB1" via getPolicyClassLabel, never a bare "Bond".
  customBondType: string;
  bondAmount: Prisma.Decimal;
  // This item's OWN premium — never the CUSTOMS_BOND section's sectionTotal
  // (which may be the sum of several items). See this phase's spec, Part 6.
  customerPremium: Prisma.Decimal;
};

export function resolveCustomsBondItemPolicyPlan(item: CustomsBondItemForPolicyPlan): CustomsBondItemPolicyPlan {
  return {
    category: "BOND",
    bondType: "CUSTOM_BOND",
    customBondType: item.bondType,
    bondAmount: item.bondValue,
    customerPremium: item.premium,
  };
}
