// Shared batch-summary computation (Phase 1A.2's "Reusable Policy import
// foundation") — a pure function over already-fetched PolicyImportRow rows,
// with no Motor-specific logic at all, so any future category's import
// action can reuse this unchanged; only the row-fetching query differs per
// category. See getImportBatchSummaryAction in
// src/app/(app)/policy/motor/import/actions.ts for the (category-specific)
// Prisma query that supplies its input.
export type ImportRowSummaryInput = {
  status: "READY" | "WARNING" | "POSSIBLE_DUPLICATE" | "EXACT_DUPLICATE" | "ERROR" | "IMPORTED" | "SKIPPED";
  includeInImport: boolean;
  isSelectedForImport: boolean;
  customerMatchStatus: "MATCHED" | "POSSIBLE" | "MANUAL" | "UNMATCHED";
  insurerBalanceVerification: "VERIFIED" | "UNVERIFIED";
  clientBalanceVerification: "VERIFIED" | "UNVERIFIED";
  warnings: string[];
};

export type ImportBatchSummary = {
  totalParsedRows: number;
  importedRows: number;
  selectedRows: number;
  readyButUnselected: number;
  skippedRows: number;
  errorRows: number;
  possibleDuplicatesAwaitingDecision: number;
  possibleDuplicatesOverridden: number;
  exactDuplicatesBlocked: number;
  unmatchedCustomers: number;
  possibleCustomerMatchesAwaitingAcceptance: number;
  newlyCreatedCustomers: number;
  rowsWithUnverifiedInsurerBalance: number;
  rowsWithUnverifiedClientBalance: number;
  rowsWithOtherWarnings: number;
  remainingAfterLatestSelectedImport: number;
  finalPoliciesToBeCreated: number;
};

const ELIGIBLE_STATUSES = new Set(["READY", "WARNING", "POSSIBLE_DUPLICATE"]);

function isEligible(row: ImportRowSummaryInput): boolean {
  return row.includeInImport && ELIGIBLE_STATUSES.has(row.status) && row.customerMatchStatus !== "POSSIBLE";
}

export function computeImportBatchSummary(rows: ImportRowSummaryInput[], newlyCreatedCustomers: number): ImportBatchSummary {
  const importedRows = rows.filter((r) => r.status === "IMPORTED").length;
  const selectedRows = rows.filter((r) => r.isSelectedForImport && r.status !== "IMPORTED").length;
  const eligibleUnimported = rows.filter((r) => r.status !== "IMPORTED" && isEligible(r));

  // "Other warnings" excludes rows whose only flagged concern is an
  // unverified balance or a possible-duplicate/possible-match — those are
  // already counted in their own dedicated buckets above; this bucket is
  // for everything else (blank insurer name, blank vehicle value, a
  // commission oddity, a historical balance mismatch, ...).
  const rowsWithOtherWarnings = rows.filter(
    (r) =>
      r.status !== "IMPORTED" &&
      r.warnings.length > 0 &&
      r.insurerBalanceVerification === "VERIFIED" &&
      r.clientBalanceVerification === "VERIFIED" &&
      r.status !== "POSSIBLE_DUPLICATE" &&
      r.customerMatchStatus !== "POSSIBLE"
  ).length;

  return {
    totalParsedRows: rows.length,
    importedRows,
    selectedRows,
    readyButUnselected: eligibleUnimported.filter((r) => !r.isSelectedForImport).length,
    skippedRows: rows.filter((r) => r.status === "SKIPPED" || (!r.includeInImport && r.status !== "ERROR" && r.status !== "EXACT_DUPLICATE" && r.status !== "IMPORTED")).length,
    errorRows: rows.filter((r) => r.status === "ERROR").length,
    possibleDuplicatesAwaitingDecision: rows.filter((r) => r.status === "POSSIBLE_DUPLICATE" && !r.includeInImport).length,
    possibleDuplicatesOverridden: rows.filter((r) => r.status === "POSSIBLE_DUPLICATE" && r.includeInImport).length,
    exactDuplicatesBlocked: rows.filter((r) => r.status === "EXACT_DUPLICATE").length,
    unmatchedCustomers: rows.filter((r) => r.customerMatchStatus === "UNMATCHED" && r.status !== "IMPORTED").length,
    possibleCustomerMatchesAwaitingAcceptance: rows.filter((r) => r.customerMatchStatus === "POSSIBLE").length,
    newlyCreatedCustomers,
    rowsWithUnverifiedInsurerBalance: rows.filter((r) => r.insurerBalanceVerification === "UNVERIFIED" && r.status !== "IMPORTED").length,
    rowsWithUnverifiedClientBalance: rows.filter((r) => r.clientBalanceVerification === "UNVERIFIED" && r.status !== "IMPORTED").length,
    rowsWithOtherWarnings,
    remainingAfterLatestSelectedImport: rows.length - importedRows,
    finalPoliciesToBeCreated: selectedRows,
  };
}
