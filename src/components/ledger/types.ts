export type LedgerTransactionType = "INCOME" | "EXPENSE";

// Phase 12E — a category node plus the derived tree facts the UI needs
// (path/depth/leaf) so components never re-walk the tree themselves.
export type LedgerCategoryOption = {
  id: string;
  name: string;
  transactionType: LedgerTransactionType;
  isActive: boolean;
  parentId: string | null;
  sortOrder: number;
  // Depth 1 = root, 2 = child, 3 = grandchild.
  depth: number;
  // "Premium Income › Motor Premium" (leaf-inclusive, transactionType-free).
  path: string;
  // No children — the only categories selectable for a new manual entry.
  isLeaf: boolean;
  // True when this category or any ancestor is inactive — the whole subtree
  // is then hidden from the new-entry picker.
  effectivelyInactive: boolean;
};

export type ManualEntryRow = {
  id: string;
  transactionDate: string;
  transactionType: LedgerTransactionType;
  categoryId: string;
  categoryName: string;
  categoryPath: string;
  categoryIsActive: boolean;
  amount: string;
  paymentMethod: string | null;
  counterpartyName: string | null;
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
