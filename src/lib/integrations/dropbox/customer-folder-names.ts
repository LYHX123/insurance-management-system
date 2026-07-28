// Server-only. Pure functions — no Dropbox/Prisma calls — so folder-name
// derivation is fully unit-testable and reusable from both the sync service
// and any preview/backfill code that needs to compute a name without
// touching the network.

const INVALID_CHARS_PATTERN = /[\/\\:*?"<>|\x00-\x1f\x7f]/g;
const MAX_FOLDER_NAME_LENGTH = 100;

// customerNumber (e.g. "CUST-0001") is what makes this collision-proof and
// stable across renames — never build a folder name from companyName alone
// (see this module's callers / Part 3 of the Phase 2 spec: duplicate names,
// future renames, and Dropbox's case-insensitive paths all make a bare
// company name unsafe as a folder identity).
export function buildCustomerFolderName(customer: { customerNumber: string; companyName: string }): string {
  const sanitizedCompanyName = sanitizeNameSegment(customer.companyName);
  const prefix = customer.customerNumber.trim();

  if (!sanitizedCompanyName) {
    // Blank/fully-invalid company name after sanitization — never produce a
    // trailing "<number> - " with nothing after it.
    return prefix;
  }

  // " - " separator is 3 characters; only the company-name portion is ever
  // truncated, so the stable record-number prefix is always fully preserved.
  const maxCompanyNameLength = Math.max(0, MAX_FOLDER_NAME_LENGTH - prefix.length - 3);
  const truncatedCompanyName =
    sanitizedCompanyName.length > maxCompanyNameLength
      ? sanitizedCompanyName.slice(0, maxCompanyNameLength).trimEnd()
      : sanitizedCompanyName;

  return truncatedCompanyName ? `${prefix} - ${truncatedCompanyName}` : prefix;
}

function sanitizeNameSegment(input: string): string {
  return input
    .replace(INVALID_CHARS_PATTERN, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .trim();
}
