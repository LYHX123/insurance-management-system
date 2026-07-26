// Backs the required BondPolicyDetail.bondType enum (see that field's schema
// comment) — a real closed set, so this mirrors the Prisma enum exactly
// rather than being an open, app-validated string list (same convention as
// motorTaxClasses.ts).
export const BOND_TYPES = [
  "TENDER_BOND",
  "PERFORMANCE_BOND",
  "ADVANCE_PAYMENT_GUARANTEE",
  "CUSTOM_BOND",
] as const;

export type BondType = (typeof BOND_TYPES)[number];

export function isBondType(value: string): value is BondType {
  return (BOND_TYPES as readonly string[]).includes(value);
}

// Maps the four structured Bond QuotationSectionKind values onto BondType,
// for the fromQuotationId prefill path — same translation-layer precedent as
// createNonMotorRecordAction's section-kind-to-cover-type mapping (Policy
// and Quotation enums are allowed to diverge in naming/shape).
export const BOND_QUOTATION_SECTION_KINDS = [
  "TENDER_SECURITY",
  "PERFORMANCE_BOND",
  "ADVANCE_PAYMENT_GUARANTEE",
  "CUSTOMS_BOND",
] as const;

export const QUOTATION_SECTION_KIND_TO_BOND_TYPE: Record<(typeof BOND_QUOTATION_SECTION_KINDS)[number], BondType> = {
  TENDER_SECURITY: "TENDER_BOND",
  PERFORMANCE_BOND: "PERFORMANCE_BOND",
  ADVANCE_PAYMENT_GUARANTEE: "ADVANCE_PAYMENT_GUARANTEE",
  CUSTOMS_BOND: "CUSTOM_BOND",
};
