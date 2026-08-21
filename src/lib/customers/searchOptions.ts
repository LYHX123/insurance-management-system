import type { SearchableSelectOption } from "@/components/ui/searchable-select";

// Shared "Customer, searchable by Company Name / Short Name / Customer
// Number" option builder. The exact same three-line shape was already
// duplicated inline in CreateQuotationCaseForm and the two Claim form modals
// (customerSearchOptions useMemo) before this Policy phase — factored out
// here so the four Policy create forms this phase adds don't add a fourth
// through seventh copy. Case-insensitive matching itself lives in
// SearchableSelect's own filterSearchableOptions; this only builds the
// per-option searchText.
export type CustomerSearchSource = {
  id: string;
  companyName: string;
  customerNumber: string;
  shortName?: string | null;
};

export function buildCustomerSearchOptions(customers: CustomerSearchSource[]): SearchableSelectOption[] {
  return customers.map((c) => ({
    id: c.id,
    label: `${c.companyName} (${c.customerNumber})`,
    searchText: `${c.companyName} ${c.shortName ?? ""} ${c.customerNumber}`.toLowerCase(),
  }));
}
