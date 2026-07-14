export type InsuranceTypeRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  defaultPHCFRate: string;
  defaultITLRate: string;
  defaultStampDuty: string;
  applyPHCF: boolean;
  applyITL: boolean;
  applyStampDuty: boolean;
  defaultClauses: string | null;
  defaultExclusions: string | null;
  defaultConditions: string | null;
  active: boolean;
  usageCount: number;
};

export type InsuranceTypeOption = {
  id: string;
  name: string;
  code: string;
  defaultPHCFRate: string;
  defaultITLRate: string;
  defaultStampDuty: string;
  applyPHCF: boolean;
  applyITL: boolean;
  applyStampDuty: boolean;
  defaultClauses: string | null;
  defaultExclusions: string | null;
  defaultConditions: string | null;
};

export type CalculationMethod = "PERCENTAGE" | "FIXED_PREMIUM" | "MANUAL_PREMIUM";

export type QuotationStatus =
  | "DRAFT"
  | "ISSUED"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED";

export type CoverageItemRow = {
  id: string;
  insuredContent: string;
  sumInsured: string | null;
  rate: string | null;
  calculationMethod: CalculationMethod;
  premium: string;
  notes: string | null;
  sortOrder: number;
};

export type SectionRow = {
  id: string;
  insuranceTypeId: string;
  insuranceTypeNameSnapshot: string;
  description: string | null;
  phcfRate: string;
  itlRate: string;
  stampDuty: string;
  applyPHCF: boolean;
  applyITL: boolean;
  applyStampDuty: boolean;
  basePremium: string;
  phcfAmount: string;
  itlAmount: string;
  sectionTotal: string;
  clausesSnapshot: string | null;
  exclusionsSnapshot: string | null;
  conditionsSnapshot: string | null;
  sortOrder: number;
  items: CoverageItemRow[];
};

export type QuotationListRow = {
  id: string;
  quotationNumber: string;
  customerId: string;
  customerName: string;
  projectId: string | null;
  projectName: string | null;
  insuranceTypeNames: string[];
  subtotalPremium: string;
  totalLevies: string;
  grandTotal: string;
  status: QuotationStatus;
  quotationDate: string;
  createdByName: string;
};

export type QuotationDetail = {
  id: string;
  quotationNumber: string;
  customerId: string;
  customerName: string;
  projectId: string | null;
  projectName: string | null;
  quotationDate: string;
  validUntil: string | null;
  currency: string;
  status: QuotationStatus;
  internalNotes: string | null;
  subtotalPremium: string;
  totalPHCF: string;
  totalITL: string;
  totalStampDuty: string;
  grandTotal: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  sections: SectionRow[];
};

export type CustomerOption = {
  id: string;
  companyName: string;
  customerNumber: string;
  projects: { id: string; projectName: string }[];
};
