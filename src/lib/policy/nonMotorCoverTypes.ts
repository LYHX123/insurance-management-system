// Backs the required NonMotorPolicyDetail.insuranceType enum (see that
// field's schema comment) — mirrors the Prisma enum exactly, same pattern
// as motorTaxClasses.ts.
export const NON_MOTOR_COVER_TYPES = [
  "CONTRACTORS_ALL_RISKS",
  "WIBA",
  "EMPLOYERS_LIABILITY",
  "CONTRACTORS_PLANT_MACHINERY",
  "PUBLIC_LIABILITY",
  "FIRE_ALLIED_PERILS",
  "BURGLARY",
  "GOODS_IN_TRANSIT_SINGLE",
  "GOODS_IN_TRANSIT_ANNUAL",
  "MARINE",
  "GROUP_PERSONAL_ACCIDENT",
  "GROUP_MEDICAL",
] as const;

export type NonMotorCoverType = (typeof NON_MOTOR_COVER_TYPES)[number];

export function isNonMotorCoverType(value: string): value is NonMotorCoverType {
  return (NON_MOTOR_COVER_TYPES as readonly string[]).includes(value);
}

// Maps a quotation's structured QuotationInsuranceSection.sectionKind to the
// equivalent Non-Motor cover type, for the "Create Policy from quotation"
// prefill flow (see policy/non-motor/new/page.tsx and
// createNonMotorRecordAction). Deliberately a Partial record: every Motor
// (MOTOR_COMP_PRIVATE/COMMERCIAL, MOTOR_TPO_PRIVATE/COMMERCIAL) and every
// Bond/Work-Permit-only kind (TENDER_SECURITY, PERFORMANCE_BOND,
// ADVANCE_PAYMENT_GUARANTEE, CUSTOMS_BOND) and GENERIC are intentionally
// absent — those never match a Non-Motor section, so a quotation containing
// only Motor/Bond sections simply has zero matches here, never a guess.
export const QUOTATION_SECTION_KIND_TO_NON_MOTOR_COVER_TYPE: Partial<Record<string, NonMotorCoverType>> = {
  CAR_PACKAGE: "CONTRACTORS_ALL_RISKS",
  WIBA: "WIBA",
  EMPLOYERS_LIABILITY: "EMPLOYERS_LIABILITY",
  CPM_STANDALONE: "CONTRACTORS_PLANT_MACHINERY",
  PUBLIC_LIABILITY: "PUBLIC_LIABILITY",
  FIRE_AND_PERILS: "FIRE_ALLIED_PERILS",
  BURGLARY: "BURGLARY",
  GIT_SINGLE: "GOODS_IN_TRANSIT_SINGLE",
  GIT_ANNUAL: "GOODS_IN_TRANSIT_ANNUAL",
  MARINE_COVER: "MARINE",
  GROUP_PERSONAL_ACCIDENT: "GROUP_PERSONAL_ACCIDENT",
  GROUP_MEDICAL: "GROUP_MEDICAL",
};

// The section kinds this mapping recognizes — used to select() only the
// relevant sections when checking a quotation for Non-Motor matches.
export const NON_MOTOR_SECTION_KINDS = Object.keys(QUOTATION_SECTION_KIND_TO_NON_MOTOR_COVER_TYPE);
