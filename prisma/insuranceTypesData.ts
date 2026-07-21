// Single authoritative source of InsuranceType master data — every code here
// MUST exactly match a `insuranceTypeByCode.get("...")` lookup in
// quotation-form.tsx (verified 1:1 against that file; see the production
// incident this file was added to fix: the production InsuranceType table
// was completely empty, and separately "CAR" was missing from every seed
// block, so even a freshly-seeded database would never have been able to
// save a CAR Package quotation). Used by both prisma/seed.ts (full dev
// bootstrap) and scripts/init-insurance-types.ts (production-safe,
// InsuranceType-only initializer) so the two can never drift apart again.
//
// defaultPHCFRate/defaultITLRate/defaultStampDuty/applyPHCF/applyITL/
// applyStampDuty are intentionally omitted from every entry — every type
// relies on the Prisma schema's own defaults (0.25 / 0.20 / 40 / true /
// true / true), same as before this file existed.
export type InsuranceTypeSeed = {
  name: string;
  code: string;
  description: string;
};

export const ALL_INSURANCE_TYPES: InsuranceTypeSeed[] = [
  { name: "CAR Package", code: "CAR", description: "Contractors All Risks Package" },
  { name: "WIBA", code: "WIBA", description: "Work Injury Benefits Act" },
  { name: "Employer's Liability", code: "EL", description: "Employer's Liability" },
  { name: "CPM", code: "CPM", description: "Standalone Contractor's Plant & Machinery" },
  { name: "Public Liability", code: "PL", description: "Public Liability" },
  { name: "Fire & Perils", code: "FIRE", description: "Fire & Perils" },
  { name: "Burglary", code: "BURGLARY", description: "Burglary" },
  { name: "Goods in Transit - Single", code: "GIT_SINGLE", description: "Goods in Transit - Single" },
  { name: "Goods in Transit - Annual", code: "GIT_ANNUAL", description: "Goods in Transit - Annual" },
  { name: "Marine Cover", code: "MARINE", description: "Marine Cover" },
  { name: "Motor Comprehensive - Private", code: "MOTOR_COMP_PRIVATE", description: "Motor Comprehensive - Private" },
  { name: "Motor Comprehensive - Commercial", code: "MOTOR_COMP_COMMERCIAL", description: "Motor Comprehensive - Commercial" },
  { name: "Motor TPO - Private", code: "MOTOR_TPO_PRIVATE", description: "Motor Third Party Only - Private" },
  { name: "Motor TPO - Commercial", code: "MOTOR_TPO_COMMERCIAL", description: "Motor Third Party Only - Commercial" },
  { name: "Group Personal Accident", code: "GPA", description: "Group Personal Accident" },
  { name: "Group Medical Insurance", code: "MEDICAL", description: "Group Medical Insurance" },
  { name: "Tender Security", code: "TENDER_SECURITY", description: "Tender Security Bond" },
  { name: "Performance Bond", code: "PERFORMANCE_BOND", description: "Performance Bond" },
  { name: "Advance Payment Guarantee", code: "APG", description: "Advance Payment Guarantee" },
  { name: "Customs Bond", code: "CUSTOMS_BOND", description: "Customs Bond" },
];
