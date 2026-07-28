// Server-only, pure and deterministic. Dropbox Integration Phase 4 —
// resolves the customer short name used to build Quotation business-file/
// version filenames. Fallback order (Part 2, requirement 12):
//   A. Customer.shortName if present
//   B. Initials derived from the company name
//   C. Customer number, if initials cannot be derived safely
// Never writes back to the Customer row — callers snapshot the result onto
// the business-file record instead (Part 2, requirement 13).

// Legal-entity suffix tokens stripped when deriving initials — pure
// boilerplate that adds no distinguishing value. Deliberately NOT a
// generic stopword list: descriptive words like "Company"/"Group"/
// "Services"/"International" are kept because they often do distinguish
// one company from another in practice.
const LEGAL_SUFFIX_STOPLIST = new Set([
  "LIMITED",
  "LTD",
  "CO",
  "INC",
  "CORP",
  "CORPORATION",
  "PLC",
  "GMBH",
  "LLC",
  "LLP",
]);

// A run of letters/digits in any script, per token, after stripping
// leading/trailing punctuation (parentheses, ampersands, periods, ...).
function significantWords(companyName: string): string[] {
  return companyName
    .split(/[\s,]+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => word.length > 0)
    .filter((word) => !LEGAL_SUFFIX_STOPLIST.has(word.replace(/\.+$/, "").toUpperCase()));
}

export function deriveInitialsFromCompanyName(companyName: string): string | null {
  const words = significantWords(companyName);
  const initials = words.map((word) => word[0]!.toUpperCase()).join("");
  // A single-letter (or empty) result isn't useful as a distinguishing
  // short name — e.g. an all-CJK company name with no spaces yields one
  // token, hence one character. Let the caller fall through to the
  // customer number in that case.
  return initials.length >= 2 ? initials : null;
}

export function deriveCustomerShortName(customer: {
  shortName: string | null;
  companyName: string;
  customerNumber: string;
}): string {
  if (customer.shortName && customer.shortName.trim()) return customer.shortName.trim();
  return deriveInitialsFromCompanyName(customer.companyName) ?? customer.customerNumber;
}

// Part 12 — optional ADMIN review tooling: classifies which fallback tier
// each Customer would currently resolve to, without ever writing anything
// back to the Customer row (Part 12, requirement 3). Read-only, pure
// classification over already-fetched rows.
export type CustomerShortNameReviewStats = {
  withShortName: number;
  usingDerivedInitials: number;
  usingCustomerNumberFallback: number;
};

export function classifyCustomerShortNames(
  customers: { shortName: string | null; companyName: string }[]
): CustomerShortNameReviewStats {
  let withShortName = 0;
  let usingDerivedInitials = 0;
  let usingCustomerNumberFallback = 0;
  for (const customer of customers) {
    if (customer.shortName && customer.shortName.trim()) {
      withShortName += 1;
    } else if (deriveInitialsFromCompanyName(customer.companyName)) {
      usingDerivedInitials += 1;
    } else {
      usingCustomerNumberFallback += 1;
    }
  }
  return { withShortName, usingDerivedInitials, usingCustomerNumberFallback };
}
