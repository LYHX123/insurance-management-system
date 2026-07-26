export type InvoiceStatus = "ISSUED" | "CANCELLED";

export type InvoiceListRow = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerId: string;
  customerName: string;
  policyCount: number;
  totalPremium: string;
  status: InvoiceStatus;
  // Concatenated policy number/class snapshots — search-only, never
  // displayed as a column (see this phase's spec: search must cover policy
  // number/class snapshots even though they're not list columns).
  searchableItemText: string;
};

export type InvoiceItemRow = {
  id: string;
  itemNumber: number;
  policyRecordId: string;
  policyCategory: "MOTOR" | "NON_MOTOR" | "BOND" | "WORK_PERMIT";
  policyRecordNumber: string;
  policyClassSnapshot: string;
  policyNumberSnapshot: string;
  premiumSnapshot: string;
};

export type InvoiceDetail = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  status: InvoiceStatus;
  customerId: string;
  customerName: string;
  customerPin: string;
  totalPremium: string;
  createdByName: string;
  createdAt: string;
  cancelledAt: string | null;
  cancelledByName: string | null;
  items: InvoiceItemRow[];
};
