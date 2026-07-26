export type LedgerTransactionType = "INCOME" | "EXPENSE";

export type LedgerCategoryOption = {
  id: string;
  name: string;
  transactionType: LedgerTransactionType;
  isActive: boolean;
};

export type ManualEntryRow = {
  id: string;
  transactionDate: string;
  transactionType: LedgerTransactionType;
  categoryId: string;
  categoryName: string;
  categoryIsActive: boolean;
  amount: string;
  paymentMethod: string | null;
  referenceNumber: string | null;
  description: string | null;
  createdById: string;
  createdByName: string;
  createdAt: string;
};

export type SystemLedgerSourceType = "CUSTOMER_PREMIUM_RECEIPT" | "PROVIDER_PAYMENT" | "COMMISSION_INCOME";

export type SystemLedgerRow = {
  id: string;
  sourceType: SystemLedgerSourceType;
  transactionDate: string;
  direction: "INCOME" | "EXPENSE";
  customerId: string;
  customerName: string;
  policyRecordId: string;
  policyRecordNumber: string;
  policyCategory: "MOTOR" | "NON_MOTOR" | "BOND" | "WORK_PERMIT";
  counterparty: string | null;
  description: string | null;
  paymentMethod: string | null;
  referenceNumber: string | null;
  amount: string;
  sourceRoute: string;
  createdByName: string;
  createdAt: string;
};
