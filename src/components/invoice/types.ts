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
  // Phase 5 "Combined Invoice grouping" — PolicyRecord.sourceQuotationNumberSnapshot,
  // the same immutable snapshot the Policy Detail "Source Quotation" card
  // already reads (see that field's own schema comment). Null for every
  // manually-created/historical-import Policy — shown as "—", never an
  // error.
  sourceQuotationNumber: string | null;
};

export type InvoiceDetail = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  status: InvoiceStatus;
  // Bill-To customer (Invoice.customer). customerName/customerPin keep
  // meaning "the party billed" for every existing consumer.
  customerId: string;
  customerName: string;
  customerPin: string;
  // Phase 12B — the insured party. When it differs from Bill-To,
  // hasSeparateInsured is true and these hold the insured's name/PIN (from
  // the immutable snapshot, falling back to the live insuredCustomer, then
  // to Bill-To). For historical invoices and same-party invoices,
  // hasSeparateInsured is false and insuredName/insuredPin are null.
  hasSeparateInsured: boolean;
  insuredName: string | null;
  insuredPin: string | null;
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
