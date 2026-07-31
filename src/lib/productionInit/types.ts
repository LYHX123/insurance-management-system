// Production Initialization — shared response shapes for the preview and
// execute API routes, and for the deletion/verification logic in
// execute.ts. Field names here are the authoritative "what counts as what"
// contract between the server and the Settings UI.

export type ProductionInitDeleteCounts = {
  customers: number;
  customerProjects: number;
  customerDocuments: number;
  quotationCases: number;
  quotationRevisions: number;
  policies: number;
  invoices: number;
  tasks: number;
  motorClaims: number;
  nonMotorClaims: number;
  manualLedgerEntries: number;
  policyImportBatches: number;
  policyImportRows: number;
  // Breakdown behind the single "Business Document Records" line the UI
  // shows — CustomerDocument is already its own top-level line above, so
  // the breakdown/total here only covers the other four document tables to
  // avoid double-counting; see preview.ts's doc comment.
  quotationDocuments: number;
  policyDocuments: number;
  motorClaimDocuments: number;
  nonMotorClaimDocuments: number;
  businessDocumentRecordsTotal: number;
  dropboxMappingRecords: number;
  numberCounterRows: number;
};

export type ProductionInitPreservedCounts = {
  users: number;
  systemSettingsExists: boolean;
  dropboxIntegrationExists: boolean;
  dropboxNamespaceConfigExists: boolean;
  insuranceTypes: number;
  ledgerCategories: number;
  dropboxMigrationJobs: number;
  dropboxMigrationObjectLedgers: number;
};

export type ProductionInitPreview = {
  toDelete: ProductionInitDeleteCounts;
  toPreserve: ProductionInitPreservedCounts;
};

export type ProductionInitLastRun = {
  id: string;
  status: "RUNNING" | "SUCCESS" | "FAILED";
  executedByName: string;
  startedAt: string;
  completedAt: string | null;
  deletedCounts: ProductionInitDeleteCounts | null;
  errorSummary: string | null;
  // Null for rows created before this field existed, or (in principle) an
  // old row from before reason became required — the UI shows "Not
  // recorded" for null, never a blank space (this feature's spec, Part
  // 2.10).
  reason: string | null;
};

export type ProductionInitStatusInfo = {
  lastRun: ProductionInitLastRun | null;
  // Present only when a completed SUCCESS run means Execute is currently
  // blocked by the 24h cooldown.
  cooldownUntil: string | null;
  // True when a RUNNING row currently holds the mutex (excluding stale rows
  // this call itself just auto-failed).
  currentlyRunning: boolean;
};
