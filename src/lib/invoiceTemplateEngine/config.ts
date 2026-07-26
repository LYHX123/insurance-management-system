// The user placed exactly one .xlsx template here (verified: only
// "invoice templete.xlsx" exists under templates/inovice/ — both the
// directory and file name are the user's own naming, typos preserved
// verbatim since this is a literal filesystem path, not a display string).
// If a second .xlsx is ever added, validateInvoiceTemplate's loader throws
// rather than guessing which one to use — see loadTemplateWorkbook.
export const INVOICE_TEMPLATE_DIR = "templates/inovice";
export const INVOICE_TEMPLATE_RELATIVE_PATH = "templates/inovice/invoice templete.xlsx";

// Phase 4A.1: the Invoice item section must always show at least this many
// formatted rows, regardless of how few Policies are actually selected —
// displayRowCount = max(MIN_ITEM_ROWS, selectedItems.length). Unused rows
// beyond the real item count are left blank (styled, no values) rather than
// removed. This happens to equal the shipped template's own native reserved
// capacity (rows 5–14) today, but is enforced independently of that — see
// generate.ts.
export const MIN_ITEM_ROWS = 10;

export const SUPPORTED_ITEM_PLACEHOLDERS = ["ITEM_NO", "POLICY_CLASS", "POLICY_NUMBER", "PREMIUM"] as const;
export const SUPPORTED_HEADER_PLACEHOLDERS = ["CUSTOMER_NAME", "CUSTOMER_PIN", "INVOICE_DATE"] as const;
export const TOTAL_PLACEHOLDER = "TOTAL_PREMIUM" as const;

export const ALL_SUPPORTED_PLACEHOLDERS = [
  ...SUPPORTED_ITEM_PLACEHOLDERS,
  ...SUPPORTED_HEADER_PLACEHOLDERS,
  TOTAL_PLACEHOLDER,
] as const;

export function placeholderToken(name: string): string {
  return `{{${name}}}`;
}
