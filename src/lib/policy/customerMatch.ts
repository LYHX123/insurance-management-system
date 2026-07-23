import { normalizeCustomerNameStrict, normalizeCustomerNameLoose } from "./normalize";

export type CustomerMatchCandidate = { id: string; companyName: string };
export type CustomerMatchResult =
  | { status: "MATCHED"; customerId: string }
  | { status: "POSSIBLE"; customerId: string }
  | { status: "UNMATCHED" };

// Matching order per the Phase 1A spec: (1) exact name, (2) trimmed/
// normalized case+spacing, (3) a looser "possible" pass tolerant of common
// company-suffix abbreviations (LTD/LIMITED, CO/COMPANY, ...) — anything
// past that is left UNMATCHED for a manual mapping, never auto-created.
export function matchCustomerByName(
  historicalName: string,
  customers: CustomerMatchCandidate[]
): CustomerMatchResult {
  const exact = customers.find((c) => c.companyName === historicalName);
  if (exact) return { status: "MATCHED", customerId: exact.id };

  const strict = normalizeCustomerNameStrict(historicalName);
  const strictMatch = customers.find((c) => normalizeCustomerNameStrict(c.companyName) === strict);
  if (strictMatch) return { status: "MATCHED", customerId: strictMatch.id };

  const loose = normalizeCustomerNameLoose(historicalName);
  if (loose) {
    const looseMatch = customers.find((c) => normalizeCustomerNameLoose(c.companyName) === loose);
    if (looseMatch) return { status: "POSSIBLE", customerId: looseMatch.id };
  }

  return { status: "UNMATCHED" };
}
