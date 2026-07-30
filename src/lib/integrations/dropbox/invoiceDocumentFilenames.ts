// Server-only, pure and deterministic. Dropbox Integration Phase 6 —
// standardized filename for an Invoice's generated document. Much simpler
// than policyDocumentFilenames.ts's builder: an Invoice has exactly ONE
// generated file for its whole lifetime (no siblings, no revision concept —
// see this phase's Part 1 inspection of Invoice.generatedFileName/
// generatedStoragePath), so there is no collision set to disambiguate
// against. Preferred rule (Part 4): "<INVOICE_NUMBER>.<ext>".
import path from "path";

const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/g;
const PATH_BREAKING_PATTERN = /[/\\]/g;
const MAX_STANDARDIZED_FILENAME_LENGTH = 150;

// Invoice numbers are always a generated, ASCII, filesystem-safe format
// (INV<yearMonth>-<seq>, see generateInvoiceNumber) — this sanitization is
// defense in depth, not something expected to ever actually change the
// value, so meaning is preserved rather than the input being rejected.
function sanitizeInvoiceNumber(raw: string): string {
  let s = raw.replace(CONTROL_CHAR_PATTERN, "").replace(PATH_BREAKING_PATTERN, "-");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^\.+/, "").replace(/\.+$/, "").trim();
  return s.slice(0, MAX_STANDARDIZED_FILENAME_LENGTH);
}

// Extension is always taken from the already-generated local file (Part 4,
// requirement 1: preserve the actual generated extension) — never
// hardcoded to ".xlsx", so this keeps working unchanged if a PDF (or any
// other format) generation path is ever added.
export function buildStandardizedInvoiceFilename(invoiceNumber: string, generatedFileName: string): string {
  const ext = path.extname(generatedFileName).toLowerCase() || ".xlsx";
  const base = sanitizeInvoiceNumber(invoiceNumber) || "Invoice";
  return `${base}${ext}`;
}

// Read-only check used by verification (mirrors
// isPlausibleStandardizedPolicyFilename) — does a given Dropbox filename
// look like something this module could have produced for this Invoice?
export function isPlausibleStandardizedInvoiceFilename(filename: string, invoiceNumber: string): boolean {
  const base = sanitizeInvoiceNumber(invoiceNumber);
  return base.length > 0 && filename.toLowerCase().startsWith(base.toLowerCase());
}
