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

export type QuotationSectionKind =
  | "GENERIC"
  | "CAR_PACKAGE"
  | "WIBA"
  | "EMPLOYERS_LIABILITY"
  | "CPM_STANDALONE"
  | "PUBLIC_LIABILITY"
  | "FIRE_AND_PERILS"
  | "BURGLARY"
  | "GIT_SINGLE"
  | "GIT_ANNUAL"
  | "MARINE_COVER"
  | "MOTOR_COMP_PRIVATE"
  | "MOTOR_COMP_COMMERCIAL"
  | "MOTOR_TPO_PRIVATE"
  | "MOTOR_TPO_COMMERCIAL"
  | "GROUP_PERSONAL_ACCIDENT"
  | "GROUP_MEDICAL"
  | "TENDER_SECURITY"
  | "PERFORMANCE_BOND"
  | "ADVANCE_PAYMENT_GUARANTEE"
  | "CUSTOMS_BOND";

export type MedicalFamilyCategory = "M" | "M_PLUS_1" | "M_PLUS_2" | "M_PLUS_3" | "M_PLUS_4" | "M_PLUS_5";

export type CarSectionDetailRow = {
  projectName: string | null;
  contractValue: string;
  carRate: string;
  contractPeriodFrom: string | null;
  contractPeriodTo: string | null;
  constructionPeriodMonths: number | null;
  maintenancePeriodMonths: number | null;
  cpmValue: string | null;
  cpmRate: string | null;
  tplAnyOneClaim: string | null;
  tplAnyOneEvent: string | null;
  tplAnyOnePeriod: string | null;
  tplRate: string | null;
  tplComplimentary: boolean;
  pvtLoadingEnabled: boolean;
  pvtLoadingRate: string | null;
  pvtLoadingAmount: string;
  pvtLoadingPremium: string;
};

export type WibaPayrollRowData = {
  occupation: string;
  employeeCount: number;
  annualWages: string;
  basicMonthlySalary: string | null;
  monthlyAllowance: string | null;
};

export type WibaSectionDetailRow = {
  wibaRate: string;
  payrollRows: WibaPayrollRowData[];
};

export type CpmEquipmentRowData = {
  equipmentName: string;
  quantity: number;
  unitValue: string;
  totalValue: string;
};

export type CpmSectionDetailRow = {
  cpmRate: string;
  pvtLoadingEnabled: boolean;
  pvtLoadingRate: string | null;
  pvtLoadingAmount: string;
  pvtLoadingPremium: string;
  equipmentRows: CpmEquipmentRowData[];
};

export type PublicLiabilitySectionDetailRow = {
  anyOnePersonLimit: string | null;
  anyOneOccurrenceLimit: string | null;
  anyOneYearLimit: string;
  rate: string;
};

export type FireSectionDetailRow = {
  propertyValue: string;
  rawMaterialValue: string;
  goodsInStockValue: string;
  rate: string;
  earthquakeLoadingRate: string;
  floodLoadingRate: string;
  earthquakeLoadingEnabled: boolean;
  floodLoadingEnabled: boolean;
  pvtLoadingEnabled: boolean;
  pvtLoadingRate: string | null;
  pvtLoadingAmount: string;
  pvtLoadingPremium: string;
};

export type BurglarySectionDetailRow = {
  equipmentValue: string;
  stockValue: string;
  firstLossPercentage: string;
  rate: string;
};

export type GitSingleSectionDetailRow = {
  cargoDescription: string;
  route: string | null;
  sumInsured: string;
  rate: string;
  pvtLoadingEnabled: boolean;
  pvtLoadingRate: string | null;
  pvtLoadingAmount: string;
  pvtLoadingPremium: string;
};

export type GitAnnualSectionDetailRow = {
  cargoDescription: string;
  singleLimit: string;
  yearLimit: string;
  singleLimitRate: string;
  yearLimitRate: string;
  pvtLoadingEnabled: boolean;
  pvtLoadingRate: string | null;
  pvtLoadingAmount: string;
  pvtLoadingPremium: string;
};

export type MarineShipmentRowData = {
  referenceNo: string | null;
  sumInsured: string;
  rate: string;
  linePremium: string;
};

export type MarineSectionDetailRow = {
  cargoDescription: string | null;
  origin: string | null;
  destination: string | null;
  marineStampDutyRate: string;
  shipmentRows: MarineShipmentRowData[];
};

export type MotorComprehensiveDetailRow = {
  plateNo: string;
  vehicleValue: string;
  periodFrom: string;
  periodTo: string;
  excessProtector: string | null;
  pvt: string | null;
  rate: string;
};

export type MotorTpoDetailRow = {
  plateNo: string;
  loadingCapacity: string | null;
  basePremium: string;
  periodFrom: string;
  periodTo: string;
};

export type GpaSectionDetailRow = {
  deathLimit: string;
  ptdLimit: string;
  ttdLimit: string;
  medicalLimit: string;
  funeralLimit: string;
  deathRate: string;
  ptdRate: string;
  ttdRate: string;
  medicalRate: string;
  funeralRate: string;
  numberOfPeople: number;
};

export type MedicalFamilyCategoryRowData = {
  category: MedicalFamilyCategory;
  employeeCount: number;
  inpatientRate: string;
  outpatientRate: string;
};

export type MedicalSectionDetailRow = {
  inpatientLimit: string;
  outpatientLimit: string;
  categoryRows: MedicalFamilyCategoryRowData[];
};

export type GuaranteeSectionDetailRow = {
  projectName: string;
  bondValue: string;
  rate: string;
};

export type CustomsBondItemRowData = {
  bondType: string;
  bondValue: string;
  rate: string;
  premium: string;
};

export type CustomsBondSectionDetailRow = {
  itemRows: CustomsBondItemRowData[];
};

export type QuotationStatus =
  | "DRAFT"
  | "ISSUED"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED";

// --- Phase 1 quotation revision history ---------------------------------
export type RevisionStatus = "DRAFT" | "ISSUED" | "SUPERSEDED" | "ACCEPTED" | "CANCELLED";

export type QuotationCaseStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "QUOTED"
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED"
  | "CONVERTED_TO_POLICY";

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
  sectionKind: QuotationSectionKind;
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
  carDetail: CarSectionDetailRow | null;
  wibaDetail: WibaSectionDetailRow | null;
  cpmDetail: CpmSectionDetailRow | null;
  publicLiabilityDetail: PublicLiabilitySectionDetailRow | null;
  fireDetail: FireSectionDetailRow | null;
  burglaryDetail: BurglarySectionDetailRow | null;
  gitSingleDetail: GitSingleSectionDetailRow | null;
  gitAnnualDetail: GitAnnualSectionDetailRow | null;
  marineDetail: MarineSectionDetailRow | null;
  motorCompPrivateDetail: MotorComprehensiveDetailRow | null;
  motorCompCommercialDetail: MotorComprehensiveDetailRow | null;
  motorTpoPrivateDetail: MotorTpoDetailRow | null;
  motorTpoCommercialDetail: MotorTpoDetailRow | null;
  gpaDetail: GpaSectionDetailRow | null;
  medicalDetail: MedicalSectionDetailRow | null;
  tenderSecurityDetail: GuaranteeSectionDetailRow | null;
  performanceBondDetail: GuaranteeSectionDetailRow | null;
  advancePaymentGuaranteeDetail: GuaranteeSectionDetailRow | null;
  customsBondDetail: CustomsBondSectionDetailRow | null;
};

// One row per QuotationCase (never one row per revision) — the quotation
// list groups every historical revision under its permanent case.
export type QuotationListRow = {
  caseId: string;
  quotationNumber: string;
  customerId: string;
  customerName: string;
  projectId: string | null;
  projectName: string | null;
  insuranceTypeNames: string[];
  revisionCode: string;
  revisionStatus: RevisionStatus;
  subtotalPremium: string;
  totalLevies: string;
  grandTotal: string;
  caseStatus: QuotationCaseStatus;
  quotationDate: string;
  updatedAt: string;
  createdByName: string;
  documentCount: number;
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
  // Phase 1 revision fields — always populated for any Quotation created
  // after the revision backfill ran (i.e. every row in practice). Optional
  // in the type only so a not-yet-migrated row (should never occur) fails
  // safe rather than crashing the page.
  quotationCaseId?: string | null;
  revisionCode?: string | null;
  revisionNumber?: number | null;
  revisionStatus?: RevisionStatus | null;
  revisionReason?: string | null;
  isCurrentRevision?: boolean;
  sections: SectionRow[];
};

// --- Phase 2 underwriting documents ---------------------------------------
export type QuotationDocumentType =
  | "AWARD_LETTER"
  | "TENDER_DOCUMENT"
  | "BOQ"
  | "CONTRACT_DOCUMENT"
  | "EMPLOYEE_SCHEDULE"
  | "VEHICLE_SCHEDULE"
  | "EQUIPMENT_SCHEDULE"
  | "ASSET_SCHEDULE"
  | "STOCK_SCHEDULE"
  | "GOODS_SCHEDULE"
  | "MEDICAL_CENSUS"
  | "CLAIMS_HISTORY"
  | "PREVIOUS_POLICY"
  | "INSURER_QUOTATION"
  | "PIN_CERTIFICATE"
  | "REGISTRATION_CERTIFICATE"
  | "CR12"
  | "ID_DOCUMENT"
  | "APPLICATION_FORM"
  | "OTHER";

export type DocumentSyncStatus = "NOT_APPLICABLE" | "PENDING" | "SYNCED" | "FAILED";

// Shared by every revision of the case (see QuotationCase.documents) — never
// linked to an individual Quotation row.
export type QuotationDocumentRow = {
  id: string;
  documentType: QuotationDocumentType;
  customTypeName: string | null;
  originalFileName: string;
  mimeType: string;
  fileExtension: string | null;
  fileSize: number;
  description: string | null;
  documentDate: string | null;
  syncStatus: DocumentSyncStatus;
  uploadedByName: string;
  uploadedAt: string;
  updatedByName: string | null;
  updatedAt: string;
};

export type CustomerOption = {
  id: string;
  companyName: string;
  customerNumber: string;
  projects: { id: string; projectName: string }[];
};
