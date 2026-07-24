export type PolicyBusinessStatus = "DRAFT" | "ACTIVE" | "EXPIRED" | "CANCELLED" | "RENEWED";
export type PolicyPaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "FULLY_PAID" | "OVERPAID";
export type PolicyRecordSource = "MANUAL" | "HISTORICAL_IMPORT";
export type PolicyBalanceVerification = "VERIFIED" | "UNVERIFIED";
export type PolicyBalanceWarningReason = "BROKEN_SOURCE_FORMULA" | "BLANK_SOURCE_BALANCE" | "OTHER_UNREADABLE_BALANCE";

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
