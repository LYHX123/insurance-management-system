export type PolicyBusinessStatus = "DRAFT" | "ACTIVE" | "EXPIRED" | "CANCELLED" | "RENEWED";
export type PolicyPaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "FULLY_PAID" | "OVERPAID";
export type PolicyRecordSource = "MANUAL" | "HISTORICAL_IMPORT";
export type PolicyBalanceVerification = "VERIFIED" | "UNVERIFIED";
export type PolicyBalanceWarningReason = "BROKEN_SOURCE_FORMULA" | "BLANK_SOURCE_BALANCE" | "OTHER_UNREADABLE_BALANCE";
export type MotorTaxClass = "PRIVATE" | "COMMERCIAL" | "SPV" | "SPECIAL_USE";
export type BondType = "TENDER_BOND" | "PERFORMANCE_BOND" | "ADVANCE_PAYMENT_GUARANTEE" | "CUSTOM_BOND";
export type WorkPermitType = "CLASS_D" | "CLASS_G" | "SPECIAL_PASS" | "DEPENDANT_PASS" | "OTHER";

export type NonMotorCoverType =
  | "CONTRACTORS_ALL_RISKS"
  | "WIBA"
  | "EMPLOYERS_LIABILITY"
  | "CONTRACTORS_PLANT_MACHINERY"
  | "PUBLIC_LIABILITY"
  | "FIRE_ALLIED_PERILS"
  | "BURGLARY"
  | "GOODS_IN_TRANSIT_SINGLE"
  | "GOODS_IN_TRANSIT_ANNUAL"
  | "MARINE"
  | "GROUP_PERSONAL_ACCIDENT"
  | "GROUP_MEDICAL";

export type PolicyDocumentType =
  | "POLICY_SCHEDULE"
  | "CERTIFICATE"
  | "STICKER"
  | "DEBIT_NOTE"
  | "RECEIPT"
  | "ENDORSEMENT"
  | "CANCELLATION"
  | "OTHER";

export type PolicyActivityActionType =
  | "POLICY_CREATED"
  | "POLICY_UPDATED"
  | "POLICY_CANCELLED"
  | "CUSTOMER_RECEIPT_ADDED"
  | "INSURER_PAYMENT_ADDED"
  | "COMMISSION_UPDATED"
  | "DOCUMENT_UPLOADED"
  | "DOCUMENT_DELETED"
  | "BALANCE_VERIFIED"
  | "HISTORICAL_POLICY_IMPORTED";

export type CustomerOption = {
  id: string;
  companyName: string;
  customerNumber: string;
  projects: { id: string; projectName: string }[];
};

// One row per Motor PolicyRecord — the compact set of fields the list page
// actually renders (see MotorListTable), not every DB column.
export type MotorListRow = {
  id: string;
  recordNumber: string;
  processingDate: string;
  customerId: string;
  customerName: string;
  insuranceType: string;
  registrationNumber: string;
  insurerName: string | null;
  expiryDate: string;
  clientPremium: string;
  clientBalance: string;
  businessStatus: PolicyBusinessStatus;
  insurerBalance: string;
};

export type TransactionRow = {
  id: string;
  date: string;
  amount: string;
  paymentMethod: string | null;
  referenceNumber: string | null;
  notes: string | null;
  source: PolicyRecordSource;
};

export type MotorDetail = {
  id: string;
  recordNumber: string;
  processingDate: string;
  customerId: string;
  customerName: string;
  projectId: string | null;
  projectName: string | null;
  insuranceType: string;
  registrationNumber: string;
  // Nullable only for legacy records created before this field existed (or
  // historical-import rows, which have no reliable source column for it) —
  // see MotorPolicyDetail.taxClass's schema comment. Every new manual or
  // quotation-linked record always has a real value.
  taxClass: MotorTaxClass | null;
  vehicleValue: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  insurerName: string | null;
  policyNumber: string | null;
  effectiveDate: string;
  expiryDate: string;
  businessStatus: PolicyBusinessStatus;
  source: PolicyRecordSource;
  sourceSheet: string | null;
  originalRowNumber: number | null;
  remarks: string | null;

  customerPremium: string;
  insurerCost: string;
  totalReceived: string;
  totalPaid: string;
  clientBalance: string;
  insurerBalance: string;
  customerPaymentStatus: PolicyPaymentStatus;
  insurerPaymentStatus: PolicyPaymentStatus;
  insurerBalanceVerification: PolicyBalanceVerification;
  insurerBalanceWarningReason: PolicyBalanceWarningReason | null;
  insurerBalanceRaw: string | null;
  insurerBalanceResolutionNote: string | null;
  insurerBalanceResolvedAt: string | null;
  insurerBalanceResolvedByName: string | null;
  clientBalanceVerification: PolicyBalanceVerification;
  clientBalanceWarningReason: PolicyBalanceWarningReason | null;
  clientBalanceRaw: string | null;
  clientBalanceResolutionNote: string | null;
  clientBalanceResolvedAt: string | null;
  clientBalanceResolvedByName: string | null;

  commissionReceived: boolean;
  commissionAmount: string | null;
  commissionReceivedDate: string | null;
  historicalNetProfit: string | null;
  systemCalculatedMargin: string;

  customerReceipts: TransactionRow[];
  providerPayments: TransactionRow[];
  documents: PolicyDocumentRow[];
  activities: PolicyActivityRow[];
  // Phase 2A: Quotation -> PolicyRecord relationship. Null for every
  // manually-created and every historical-import record — see
  // PolicyRecord.sourceQuotationId's schema comment. Populated only when the
  // live Quotation relation still resolves.
  sourceQuotation: SourceQuotationInfo | null;
  // Phase 2B: immutable audit snapshot (see
  // PolicyRecord.sourceQuotationNumberSnapshot's schema comment) — populated
  // whenever this policy was created from a quotation, independent of
  // whether the live relation above still resolves. Used as the display
  // fallback ("Source Quotation" card) if sourceQuotation above is null but
  // this isn't (i.e. the quotation existed at creation time but its relation
  // later went away).
  sourceQuotationSnapshot: SourceQuotationSnapshot | null;
};

// One row per Non-Motor PolicyRecord — mirrors MotorListRow's shape minus
// the Motor-only registrationNumber column (see NonMotorListTable).
// insurerBalance is included for the "outstanding insurer balance" list
// filter even though it is not rendered as a table column.
export type NonMotorListRow = {
  id: string;
  recordNumber: string;
  processingDate: string;
  customerId: string;
  customerName: string;
  insuranceType: NonMotorCoverType;
  insurerName: string | null;
  expiryDate: string;
  clientPremium: string;
  clientBalance: string;
  insurerBalance: string;
  businessStatus: PolicyBusinessStatus;
};

// Mirrors MotorDetail's shape, minus every Motor-specific field
// (registrationNumber, vehicleValue/Make/Model, taxClass) and minus the
// historical-import balance-verification fields (insurerBalanceVerification
// etc.) — Non-Motor has no historical import in this phase (Phase 3A), so
// nothing ever sets those to anything other than their schema defaults, and
// the Non-Motor UI never needs to display or resolve them.
export type NonMotorDetail = {
  id: string;
  recordNumber: string;
  processingDate: string;
  customerId: string;
  customerName: string;
  projectId: string | null;
  projectName: string | null;
  insuranceType: NonMotorCoverType;
  policyNumber: string | null;
  insurerName: string | null;
  effectiveDate: string;
  expiryDate: string;
  businessStatus: PolicyBusinessStatus;
  source: PolicyRecordSource;
  remarks: string | null;

  customerPremium: string;
  insurerCost: string;
  totalReceived: string;
  totalPaid: string;
  clientBalance: string;
  insurerBalance: string;
  customerPaymentStatus: PolicyPaymentStatus;
  insurerPaymentStatus: PolicyPaymentStatus;

  commissionReceived: boolean;
  commissionAmount: string | null;
  commissionReceivedDate: string | null;
  systemCalculatedMargin: string;

  customerReceipts: TransactionRow[];
  providerPayments: TransactionRow[];
  documents: PolicyDocumentRow[];
  activities: PolicyActivityRow[];
  sourceQuotation: SourceQuotationInfo | null;
  sourceQuotationSnapshot: SourceQuotationSnapshot | null;
};

// One row per Bond PolicyRecord — mirrors NonMotorListRow's shape with
// bondType in place of insuranceType. Bond Amount is deliberately NOT
// included here — it is never a list column or list filter, only shown on
// the Bond detail page.
export type BondListRow = {
  id: string;
  recordNumber: string;
  processingDate: string;
  customerId: string;
  customerName: string;
  bondType: BondType;
  customBondType: string | null;
  policyNumber: string | null;
  insurerName: string | null;
  expiryDate: string;
  clientPremium: string;
  clientBalance: string;
  insurerBalance: string;
  businessStatus: PolicyBusinessStatus;
};

// Mirrors NonMotorDetail's shape, minus insuranceType/policyNumber (moved to
// bondType/customBondType/policyNumber) and plus bondAmount.
export type BondDetail = {
  id: string;
  recordNumber: string;
  processingDate: string;
  customerId: string;
  customerName: string;
  projectId: string | null;
  projectName: string | null;
  bondType: BondType;
  customBondType: string | null;
  bondAmount: string;
  policyNumber: string | null;
  insurerName: string | null;
  effectiveDate: string;
  expiryDate: string;
  businessStatus: PolicyBusinessStatus;
  source: PolicyRecordSource;
  remarks: string | null;

  customerPremium: string;
  insurerCost: string;
  totalReceived: string;
  totalPaid: string;
  clientBalance: string;
  insurerBalance: string;
  customerPaymentStatus: PolicyPaymentStatus;
  insurerPaymentStatus: PolicyPaymentStatus;

  commissionReceived: boolean;
  commissionAmount: string | null;
  commissionReceivedDate: string | null;
  systemCalculatedMargin: string;

  customerReceipts: TransactionRow[];
  providerPayments: TransactionRow[];
  documents: PolicyDocumentRow[];
  activities: PolicyActivityRow[];
  sourceQuotation: SourceQuotationInfo | null;
  sourceQuotationSnapshot: SourceQuotationSnapshot | null;
};

// One row per Work Permit PolicyRecord. Deliberately omits insurerName,
// agent, and insurerBalance (Agent Balance) as DISPLAYED columns per the
// user's spec — insurerBalance is still carried on the row purely so the
// "outstanding agent balance" filter can work without being a visible
// column (same pattern as NonMotorListRow.insurerBalance).
export type WorkPermitListRow = {
  id: string;
  recordNumber: string;
  processingDate: string;
  customerId: string;
  customerName: string;
  permitType: WorkPermitType;
  otherPermitType: string | null;
  expiryDate: string;
  clientPremium: string;
  clientBalance: string;
  insurerBalance: string;
  businessStatus: PolicyBusinessStatus;
};

// Mirrors NonMotorDetail's shape with permitType/agent/permitNumber in place
// of insuranceType/policyNumber, and no insurerName field (Work Permit has
// no insurer concept — see WorkPermitPolicyDetail's schema comment).
// insurerCost/insurerBalance/insurerPaymentStatus/providerPayments field
// names are kept as-is (same underlying PolicyRecord/PolicyProviderPayment
// columns as every other category) — only their on-screen labels become
// "Agent Cost"/"Agent Balance"/"Agent Payment Status"/"Agent Payments" in
// work-permit-financial-tab.tsx.
export type WorkPermitDetail = {
  id: string;
  recordNumber: string;
  processingDate: string;
  customerId: string;
  customerName: string;
  projectId: string | null;
  projectName: string | null;
  permitType: WorkPermitType;
  otherPermitType: string | null;
  agent: string;
  permitNumber: string | null;
  effectiveDate: string;
  expiryDate: string;
  businessStatus: PolicyBusinessStatus;
  source: PolicyRecordSource;
  remarks: string | null;

  customerPremium: string;
  insurerCost: string;
  totalReceived: string;
  totalPaid: string;
  clientBalance: string;
  insurerBalance: string;
  customerPaymentStatus: PolicyPaymentStatus;
  insurerPaymentStatus: PolicyPaymentStatus;

  commissionReceived: boolean;
  commissionAmount: string | null;
  commissionReceivedDate: string | null;
  systemCalculatedMargin: string;

  customerReceipts: TransactionRow[];
  providerPayments: TransactionRow[];
  documents: PolicyDocumentRow[];
  activities: PolicyActivityRow[];
  sourceQuotation: SourceQuotationInfo | null;
  sourceQuotationSnapshot: SourceQuotationSnapshot | null;
};

export type SourceQuotationInfo = {
  id: string;
  quotationNumber: string;
  revisionCode: string | null;
  customerName: string;
  projectName: string | null;
  quotationDate: string;
  grandTotal: string;
};

export type SourceQuotationSnapshot = {
  quotationNumber: string;
  revisionCode: string | null;
  quotationDate: string;
};

export type PolicyDocumentRow = {
  id: string;
  documentType: PolicyDocumentType;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  issueDate: string | null;
  expiryDate: string | null;
  notes: string | null;
  uploadedByName: string;
  createdAt: string;
};

export type PolicyActivityRow = {
  id: string;
  actionType: PolicyActivityActionType;
  summary: string;
  details: string | null;
  performedByName: string | null;
  createdAt: string;
};
