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

// Dropbox Integration Phase 6 — mirrors pathDisplay.ts's DropboxPathView
// shape, duplicated here (rather than importing the server module) so this
// client-safe types file has no dependency on server-only Dropbox code —
// same convention as src/components/policy/types.ts's DropboxPathViewPlain.
export type DropboxPathState = "synced" | "planned" | "pending" | "syncing" | "error" | "conflict" | "not_connected" | "unavailable";

export type DropboxPathViewPlain = {
  state: DropboxPathState;
  path: string | null;
  isPlanned: boolean;
  errorMessage: string | null;
};

// The Invoice detail page's Dropbox section view model (see
// invoicePathViewModel.ts's server-side builder). An Invoice has exactly
// one generated document, so — unlike Policy's per-document table — this
// combines business-folder-level and file-level info in one shape.
export type InvoiceDropboxSectionView = {
  dropboxConnected: boolean;
  source: "QUOTATION_CASE" | "POLICY_FALLBACK" | "INVOICE_FALLBACK";
  businessFolderName: string;
  businessFolder: DropboxPathViewPlain;
  invoiceFolder: DropboxPathViewPlain;
  invoiceFile: DropboxPathViewPlain;
  standardizedFileName: string | null;
  lastSyncedAt: string | null;
};
