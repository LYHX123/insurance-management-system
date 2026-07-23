import type { ParsedMotorRow } from "./motorImportParser";
import { matchCustomerByName, type CustomerMatchCandidate } from "./customerMatch";
import { buildDuplicateKeys } from "./duplicateKeys";
import { coverTypeExpectsNoVehicleValue } from "./motorCoverTypes";
import { normalizeCustomerNameStrict, type BalanceWarningReason } from "./normalize";

export type PreviewRowStatus = "READY" | "WARNING" | "POSSIBLE_DUPLICATE" | "EXACT_DUPLICATE" | "ERROR";
export type CustomerMatchStatus = "MATCHED" | "POSSIBLE" | "MANUAL" | "UNMATCHED";
export type BalanceVerification = "VERIFIED" | "UNVERIFIED";

export type ImportPreviewRow = ParsedMotorRow & {
  matchedCustomerId: string | null;
  customerMatchStatus: CustomerMatchStatus;
  calculatedInsurerBalance: number;
  calculatedClientBalance: number;
  insurerBalanceVerification: BalanceVerification;
  clientBalanceVerification: BalanceVerification;
  duplicateOfRowNumbers: number[];
  duplicateOfPolicyRecordId: string | null;
  status: PreviewRowStatus;
  warnings: string[];
  includeInImport: boolean;
};

const BALANCE_TOLERANCE = 0.5;
const STATUS_ORDER: PreviewRowStatus[] = ["READY", "WARNING", "POSSIBLE_DUPLICATE", "EXACT_DUPLICATE", "ERROR"];

// The subset of fields the status/warning derivation actually needs — kept
// separate from ParsedMotorRow so the same logic can run either right after
// parsing (buildImportPreviewRows) or later, against already-persisted
// PolicyImportRow columns (e.g. after a manual customer mapping, a possible-
// match accept/reject, or a duplicate-group override — see
// src/app/(app)/policy/motor/import/actions.ts). commissionWasRateValue is
// only available at parse time; recomputing later without it just means
// that one specific (non-blocking) warning isn't resurfaced, which never
// changes the overall status outcome.
export type StatusDerivationInput = {
  customerNameRaw: string | null;
  customerMatchStatus: CustomerMatchStatus;
  registrationNumber: string | null;
  effectiveDate: Date | null;
  expiryDate: Date | null;
  insurerName: string | null;
  insuranceType: string | null;
  vehicleValue: number | null;
  commissionWasRateValue?: boolean;
  commissionReceivedDate: Date | null;
  commissionReceived: boolean;
  columnMReceiptFlag?: string | null;
  insurerCost: number | null;
  amountPaidToInsurer: number | null;
  originalInsurerBalance: number | null;
  insurerBalanceWarningReason?: BalanceWarningReason | null;
  clientPremium: number | null;
  amountReceivedFromClient: number | null;
  originalClientBalance: number | null;
  clientBalanceWarningReason?: BalanceWarningReason | null;
  duplicateOfRowNumbers: number[];
  duplicateOfPolicyRecordId?: string | null;
};

export function deriveStatusAndWarnings(row: StatusDerivationInput): {
  status: PreviewRowStatus;
  warnings: string[];
  calculatedInsurerBalance: number;
  calculatedClientBalance: number;
  insurerBalanceVerification: BalanceVerification;
  clientBalanceVerification: BalanceVerification;
  includeInImport: boolean;
} {
  const warnings: string[] = [];
  let status: PreviewRowStatus = "READY";
  const maxStatus = (a: PreviewRowStatus, b: PreviewRowStatus): PreviewRowStatus =>
    STATUS_ORDER.indexOf(b) > STATUS_ORDER.indexOf(a) ? b : a;

  let hasError = false;

  if (!row.customerNameRaw) {
    warnings.push("Customer name is missing in the source row — create or map a customer before this row can be imported.");
    status = maxStatus(status, "ERROR");
    hasError = true;
  } else if (row.customerMatchStatus === "UNMATCHED") {
    warnings.push(`No matching customer found for "${row.customerNameRaw}" — create a new customer or map it to an existing one.`);
    status = maxStatus(status, "ERROR");
    hasError = true;
  } else if (row.customerMatchStatus === "POSSIBLE") {
    warnings.push(`Customer name "${row.customerNameRaw}" is a possible (not exact) match — review and accept or reject it before this row is imported.`);
    status = maxStatus(status, "WARNING");
  }

  if (!row.registrationNumber) {
    warnings.push("Registration number (NUMBER PLATE) is missing.");
    status = maxStatus(status, "ERROR");
    hasError = true;
  }
  if (!row.effectiveDate || !row.expiryDate) {
    warnings.push("Effective date or expiry date could not be parsed.");
    status = maxStatus(status, "ERROR");
    hasError = true;
  } else if (row.expiryDate < row.effectiveDate) {
    warnings.push("Expiry date is before the effective date.");
    status = maxStatus(status, "ERROR");
    hasError = true;
  }

  if (!row.insurerName) {
    warnings.push("Insurer name is blank in the source row.");
    status = maxStatus(status, "WARNING");
  }

  if (
    row.insuranceType &&
    !coverTypeExpectsNoVehicleValue(row.insuranceType) &&
    (row.vehicleValue === null || row.vehicleValue === undefined)
  ) {
    warnings.push(`Vehicle value is blank for a "${row.insuranceType}" cover, where a value is normally expected.`);
    status = maxStatus(status, "WARNING");
  }

  if (row.commissionWasRateValue) {
    warnings.push(
      "Commission column contained a rate value rather than Yes/No — normalized to \"received\", but the rate itself is not imported in Phase 1A."
    );
    status = maxStatus(status, "WARNING");
  }
  if (row.commissionReceivedDate && !row.commissionReceived) {
    warnings.push("A commission date is present but no commission indicator was found — please verify.");
    status = maxStatus(status, "WARNING");
  }

  if (row.columnMReceiptFlag) {
    warnings.push(`Receipt flag (source column M): ${row.columnMReceiptFlag}`);
  }

  const insurerCost = row.insurerCost ?? 0;
  const amountPaidToInsurer = row.amountPaidToInsurer ?? 0;
  const calculatedInsurerBalance = Math.round((insurerCost - amountPaidToInsurer) * 100) / 100;
  let insurerBalanceVerification: BalanceVerification = "VERIFIED";
  if (row.insurerBalanceWarningReason) {
    insurerBalanceVerification = "UNVERIFIED";
    warnings.push(
      `Unverified historical insurer balance — the source ACCOUNT PAYABLE value could not be read (${row.insurerBalanceWarningReason}). Do not assume this side is fully settled.`
    );
    status = maxStatus(status, "WARNING");
  } else if (
    row.originalInsurerBalance !== null &&
    Math.abs(calculatedInsurerBalance - row.originalInsurerBalance) > BALANCE_TOLERANCE
  ) {
    warnings.push(
      `Calculated insurer balance (${calculatedInsurerBalance}) differs from the historical ACCOUNT PAYABLE value (${row.originalInsurerBalance}).`
    );
    status = maxStatus(status, "WARNING");
  }

  const clientPremium = row.clientPremium ?? 0;
  const amountReceivedFromClient = row.amountReceivedFromClient ?? 0;
  const calculatedClientBalance = Math.round((clientPremium - amountReceivedFromClient) * 100) / 100;
  let clientBalanceVerification: BalanceVerification = "VERIFIED";
  if (row.clientBalanceWarningReason) {
    clientBalanceVerification = "UNVERIFIED";
    warnings.push(
      `Unverified historical client balance — the source ACCOUNTS RECEIVABLE value could not be read (${row.clientBalanceWarningReason}). Do not assume this side is fully settled.`
    );
    status = maxStatus(status, "WARNING");
  } else if (
    row.originalClientBalance !== null &&
    Math.abs(calculatedClientBalance - row.originalClientBalance) > BALANCE_TOLERANCE
  ) {
    warnings.push(
      `Calculated client balance (${calculatedClientBalance}) differs from the historical ACCOUNTS RECEIVABLE value (${row.originalClientBalance}).`
    );
    status = maxStatus(status, "WARNING");
  }

  // Duplicate handling is two-tier (see PolicyImportRowStatus's schema
  // comment): EXACT_DUPLICATE always wins over POSSIBLE_DUPLICATE, and both
  // are surfaced even when hasError is also true, so the user can see every
  // reason a row needs attention — but only hasError/EXACT_DUPLICATE affect
  // includeInImport below (POSSIBLE_DUPLICATE defaults to excluded but is
  // always overridable).
  const isExactDuplicate = !!row.duplicateOfPolicyRecordId;
  const isPossibleDuplicate = row.duplicateOfRowNumbers.length > 0;
  if (isExactDuplicate) {
    warnings.push(
      `An equivalent policy record already exists in the database (id ${row.duplicateOfPolicyRecordId}) — this row is blocked from import.`
    );
    status = maxStatus(status, "EXACT_DUPLICATE");
  } else if (isPossibleDuplicate) {
    warnings.push(`Possible duplicate of row(s): ${row.duplicateOfRowNumbers.join(", ")}. Excluded by default — include explicitly if this is a legitimate separate policy.`);
    status = maxStatus(status, "POSSIBLE_DUPLICATE");
  }

  // includeInImport is the actual authoritative "would this be imported"
  // signal — status is a single-dimension display label, but several of
  // these conditions are independent axes (a row can be a POSSIBLE_DUPLICATE
  // *and* have a POSSIBLE customer match at the same time). Every condition
  // here defaults a row OUT of the import until a specific, explicit action
  // resolves it:
  //   - hasError / isExactDuplicate: never overridable.
  //   - isPossibleDuplicate: overridable via the duplicate-group include toggle.
  //   - customerMatchStatus === "POSSIBLE": overridable via the accept-match action.
  const includeInImport = !hasError && !isExactDuplicate && !isPossibleDuplicate && row.customerMatchStatus !== "POSSIBLE";

  return {
    status,
    warnings,
    calculatedInsurerBalance,
    calculatedClientBalance,
    insurerBalanceVerification,
    clientBalanceVerification,
    includeInImport,
  };
}

// Builds the full preview row set for a freshly parsed workbook: customer
// matching, within-batch duplicate detection, balance recomputation vs the
// historical L/Q columns, and every warning found during the Phase 1A
// inspection. Pure function (no DB writes) so it can run once per upload and
// be persisted as PolicyImportRow rows by the calling action.
// exactDuplicates is precomputed by the caller (see
// src/lib/policy/exactDuplicateCheck.ts — it needs a DB round-trip, kept out
// of this otherwise-pure function) and defaults to empty (no rows found to be
// exact duplicates yet, which is the correct state before any customer
// resolution has happened).
export function buildImportPreviewRows(
  parsedRows: ParsedMotorRow[],
  customers: CustomerMatchCandidate[],
  exactDuplicates: Map<number, string> = new Map()
): ImportPreviewRow[] {
  // Duplicate keys are computed against the whole batch up front so every
  // row in a duplicate group can point at every other member.
  const keyToRows = new Map<string, number[]>();
  const rowKeys = new Map<number, string[]>();

  for (const row of parsedRows) {
    const match = row.customerNameRaw ? matchCustomerByName(row.customerNameRaw, customers) : { status: "UNMATCHED" as const };
    const customerKey =
      match.status === "MATCHED" || match.status === "POSSIBLE"
        ? match.customerId
        : normalizeCustomerNameStrict(row.customerNameRaw);
    const keys = buildDuplicateKeys({
      registrationNumber: row.registrationNumber,
      effectiveDate: row.effectiveDate,
      expiryDate: row.expiryDate,
      customerKey,
      insuranceType: row.insuranceType,
    });
    rowKeys.set(row.rowNumber, keys);
    for (const k of keys) {
      if (!keyToRows.has(k)) keyToRows.set(k, []);
      keyToRows.get(k)!.push(row.rowNumber);
    }
  }

  return parsedRows.map((row) => {
    const match = row.customerNameRaw
      ? matchCustomerByName(row.customerNameRaw, customers)
      : ({ status: "UNMATCHED" } as const);
    const customerMatchStatus: CustomerMatchStatus = match.status;
    const matchedCustomerId = match.status === "MATCHED" || match.status === "POSSIBLE" ? match.customerId : null;

    const duplicateOfRowNumbers = Array.from(
      new Set(
        (rowKeys.get(row.rowNumber) ?? [])
          .flatMap((k) => keyToRows.get(k) ?? [])
          .filter((r) => r !== row.rowNumber)
      )
    ).sort((a, b) => a - b);
    const duplicateOfPolicyRecordId = exactDuplicates.get(row.rowNumber) ?? null;

    const derived = deriveStatusAndWarnings({ ...row, customerMatchStatus, duplicateOfRowNumbers, duplicateOfPolicyRecordId });

    return {
      ...row,
      matchedCustomerId,
      customerMatchStatus,
      duplicateOfRowNumbers,
      duplicateOfPolicyRecordId,
      ...derived,
    };
  });
}
