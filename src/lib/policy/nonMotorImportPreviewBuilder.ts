import type { ParsedNonMotorRow } from "./nonMotorImportParser";
import { matchCustomerByName, type CustomerMatchCandidate } from "./customerMatch";
import { normalizeCustomerNameStrict } from "./normalize";
import { mapImportTextToNonMotorCoverType } from "./nonMotorImportTypeMapping";

export type NonMotorPreviewRowStatus = "READY" | "WARNING" | "POSSIBLE_DUPLICATE" | "EXACT_DUPLICATE" | "ERROR";
export type NonMotorCustomerMatchStatus = "MATCHED" | "POSSIBLE" | "MANUAL" | "UNMATCHED";

export type NonMotorImportPreviewRow = ParsedNonMotorRow & {
  matchedCustomerId: string | null;
  customerMatchStatus: NonMotorCustomerMatchStatus;
  matchedProjectId: string | null;
  resolvedInsuranceType: string | null;
  duplicateOfRowNumbers: number[];
  duplicateOfPolicyRecordId: string | null;
  status: NonMotorPreviewRowStatus;
  warnings: string[];
  includeInImport: boolean;
};

const STATUS_ORDER: NonMotorPreviewRowStatus[] = ["READY", "WARNING", "POSSIBLE_DUPLICATE", "EXACT_DUPLICATE", "ERROR"];

// Unlike Motor, Non-Motor's standard import format has no historical
// ACCOUNT PAYABLE / ACCOUNTS RECEIVABLE columns, no balance-verification
// concept, and no commission column at all (see the standard columns list —
// PROCESSING DATE/CUSTOMER/TYPE OF COVER/INSURER/POLICY NUMBER/EFFECTIVE
// DATE/EXPIRY DATE/CLIENT PREMIUM/INSURER COST/REMARKS/PROJECT only), so
// this validation is a much smaller subset of Motor's deriveStatusAndWarnings.
export type NonMotorStatusDerivationInput = {
  customerNameRaw: string | null;
  customerMatchStatus: NonMotorCustomerMatchStatus;
  insuranceTypeRaw: string | null;
  resolvedInsuranceType: string | null;
  effectiveDate: Date | null;
  expiryDate: Date | null;
  clientPremium: number | null;
  insurerCost: number | null;
  duplicateOfRowNumbers: number[];
  duplicateOfPolicyRecordId?: string | null;
};

export function deriveNonMotorStatusAndWarnings(row: NonMotorStatusDerivationInput): {
  status: NonMotorPreviewRowStatus;
  warnings: string[];
  includeInImport: boolean;
} {
  const warnings: string[] = [];
  let status: NonMotorPreviewRowStatus = "READY";
  const maxStatus = (a: NonMotorPreviewRowStatus, b: NonMotorPreviewRowStatus): NonMotorPreviewRowStatus =>
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

  if (!row.insuranceTypeRaw) {
    warnings.push("Type of Cover is missing in the source row.");
    status = maxStatus(status, "ERROR");
    hasError = true;
  } else if (!row.resolvedInsuranceType) {
    // Covers Motor/Bond/Work Permit type text and any genuinely unknown
    // value alike — mapImportTextToNonMotorCoverType never guesses, so any
    // unresolved text lands here, never silently converted.
    warnings.push(`"${row.insuranceTypeRaw}" is not a supported Non-Motor type of cover.`);
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

  if (row.clientPremium === null || row.clientPremium < 0) {
    warnings.push("Client Premium is missing or invalid.");
    status = maxStatus(status, "ERROR");
    hasError = true;
  }
  if (row.insurerCost === null || row.insurerCost < 0) {
    warnings.push("Insurer Cost is missing or invalid.");
    status = maxStatus(status, "ERROR");
    hasError = true;
  }

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

  const includeInImport = !hasError && !isExactDuplicate && !isPossibleDuplicate && row.customerMatchStatus !== "POSSIBLE";

  return { status, warnings, includeInImport };
}

// Non-Motor's within-batch duplicate key: customer + type + effective date,
// plus a policy-number key when present — deliberately NOT Motor's
// registration-based logic (Non-Motor has no registration number). See
// duplicateKeys.ts's buildDuplicateKeys for the POLICY_NO key convention
// this mirrors.
function buildNonMotorDuplicateKeys(input: {
  customerKey: string | null;
  resolvedInsuranceType: string | null;
  effectiveDate: Date | null;
  policyNumber: string | null;
}): string[] {
  const keys: string[] = [];
  const eff = input.effectiveDate ? input.effectiveDate.toISOString().slice(0, 10) : null;
  if (input.customerKey && input.resolvedInsuranceType && eff) {
    keys.push(`CUST_TYPE_EFF:${input.customerKey}:${input.resolvedInsuranceType}:${eff}`);
  }
  if (input.policyNumber?.trim()) {
    keys.push(`POLICY_NO:${input.policyNumber.trim().toUpperCase()}`);
  }
  return keys;
}

export type CustomerProjectCandidate = { id: string; projects: { id: string; projectName: string }[] };

// Best-effort, never-guessing project match: only resolves when the raw
// PROJECT cell text exactly (case-insensitive, trimmed) matches exactly one
// of the matched customer's real projects. Ambiguous or no match both leave
// matchedProjectId null — the row still imports with no project set, same
// "never guess" principle as customer matching's UNMATCHED tier.
function matchProject(
  projectNameRaw: string | null,
  customerId: string | null,
  customersWithProjects: CustomerProjectCandidate[]
): string | null {
  if (!projectNameRaw || !customerId) return null;
  const customer = customersWithProjects.find((c) => c.id === customerId);
  if (!customer) return null;
  const norm = projectNameRaw.trim().toLowerCase();
  const matches = customer.projects.filter((p) => p.projectName.trim().toLowerCase() === norm);
  return matches.length === 1 ? matches[0].id : null;
}

// Mirrors buildImportPreviewRows (Motor) — pure function (no DB writes),
// customer matching + within-batch duplicate detection + type resolution.
// exactDuplicates is precomputed by the caller via detectExactDuplicates
// (same as Motor). customersWithProjects is optional — omitted, PROJECT
// cells are simply never resolved to a matchedProjectId (still parsed and
// shown raw, per the spec's "best-effort" wording).
export function buildNonMotorImportPreviewRows(
  parsedRows: ParsedNonMotorRow[],
  customers: CustomerMatchCandidate[],
  exactDuplicates: Map<number, string> = new Map(),
  customersWithProjects: CustomerProjectCandidate[] = []
): NonMotorImportPreviewRow[] {
  const keyToRows = new Map<string, number[]>();
  const rowKeys = new Map<number, string[]>();

  for (const row of parsedRows) {
    const match = row.customerNameRaw ? matchCustomerByName(row.customerNameRaw, customers) : { status: "UNMATCHED" as const };
    const customerKey =
      match.status === "MATCHED" || match.status === "POSSIBLE"
        ? match.customerId
        : normalizeCustomerNameStrict(row.customerNameRaw);
    const resolvedInsuranceType = mapImportTextToNonMotorCoverType(row.insuranceTypeRaw);
    const keys = buildNonMotorDuplicateKeys({
      customerKey,
      resolvedInsuranceType,
      effectiveDate: row.effectiveDate,
      policyNumber: row.policyNumber,
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
    const customerMatchStatus: NonMotorCustomerMatchStatus = match.status;
    const matchedCustomerId = match.status === "MATCHED" || match.status === "POSSIBLE" ? match.customerId : null;
    const resolvedInsuranceType = mapImportTextToNonMotorCoverType(row.insuranceTypeRaw);

    const duplicateOfRowNumbers = Array.from(
      new Set(
        (rowKeys.get(row.rowNumber) ?? [])
          .flatMap((k) => keyToRows.get(k) ?? [])
          .filter((r) => r !== row.rowNumber)
      )
    ).sort((a, b) => a - b);
    const duplicateOfPolicyRecordId = exactDuplicates.get(row.rowNumber) ?? null;

    const derived = deriveNonMotorStatusAndWarnings({
      customerNameRaw: row.customerNameRaw,
      customerMatchStatus,
      insuranceTypeRaw: row.insuranceTypeRaw,
      resolvedInsuranceType,
      effectiveDate: row.effectiveDate,
      expiryDate: row.expiryDate,
      clientPremium: row.clientPremium,
      insurerCost: row.insurerCost,
      duplicateOfRowNumbers,
      duplicateOfPolicyRecordId,
    });

    return {
      ...row,
      matchedCustomerId,
      customerMatchStatus,
      matchedProjectId: matchProject(row.projectNameRaw, matchedCustomerId, customersWithProjects),
      resolvedInsuranceType,
      duplicateOfRowNumbers,
      duplicateOfPolicyRecordId,
      ...derived,
    };
  });
}
