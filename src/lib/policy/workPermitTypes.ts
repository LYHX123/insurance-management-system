// Backs the required WorkPermitPolicyDetail.permitType enum (see that
// field's schema comment). Greenfield category (Phase 3B) — no existing
// Kenyan work-permit terminology or QuotationSectionKind equivalent was
// found in this repository, so this is the minimal practical set requested
// for this phase; confirm with the business before extending.
export const WORK_PERMIT_TYPES = ["CLASS_D", "CLASS_G", "SPECIAL_PASS", "DEPENDANT_PASS", "OTHER"] as const;

export type WorkPermitType = (typeof WORK_PERMIT_TYPES)[number];

export function isWorkPermitType(value: string): value is WorkPermitType {
  return (WORK_PERMIT_TYPES as readonly string[]).includes(value);
}
