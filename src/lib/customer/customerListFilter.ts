// Phase 13A — the single definition of the Customer list's search / status
// filter, shared by the client table (src/components/customers/customers-table.tsx)
// and the server-side Excel export route so the export always contains
// exactly the rows the list would show for the same filter state.

export type CustomerListFilterState = {
  /** Raw `?search=` value — matched against company name / PIN / customer number. */
  search?: string | null;
  /** Raw `?status=` value: "ALL" | "ACTIVE" | "INACTIVE". */
  status?: string | null;
};

// Structural subset of a customer row the predicate needs.
export type CustomerFilterableRow = {
  companyName: string;
  pinNumber: string;
  customerNumber: string;
  status: string;
};

export function matchesCustomerListFilters(row: CustomerFilterableRow, filters: CustomerListFilterState): boolean {
  const term = (filters.search ?? "").trim().toLowerCase();
  const matchesTerm =
    !term ||
    row.companyName.toLowerCase().includes(term) ||
    row.pinNumber.toLowerCase().includes(term) ||
    row.customerNumber.toLowerCase().includes(term);

  const status = filters.status ?? "ALL";
  const matchesStatus = status === "ALL" || row.status === status;

  return matchesTerm && matchesStatus;
}
