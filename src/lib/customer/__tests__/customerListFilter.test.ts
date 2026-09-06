import { describe, it, expect } from "vitest";
import { matchesCustomerListFilters } from "@/lib/customer/customerListFilter";

const row = (o: Partial<{ companyName: string; pinNumber: string; customerNumber: string; status: string }> = {}) => ({
  companyName: "Alpha Ltd",
  pinNumber: "P051234567X",
  customerNumber: "CUST-0001",
  status: "ACTIVE",
  ...o,
});

describe("matchesCustomerListFilters", () => {
  it("no filter -> matches", () => {
    expect(matchesCustomerListFilters(row(), {})).toBe(true);
  });
  it("search matches company / PIN / customer number, case-insensitive, trimmed", () => {
    expect(matchesCustomerListFilters(row(), { search: "  alpha " })).toBe(true);
    expect(matchesCustomerListFilters(row(), { search: "p051234567x" })).toBe(true);
    expect(matchesCustomerListFilters(row(), { search: "cust-0001" })).toBe(true);
    expect(matchesCustomerListFilters(row(), { search: "omega" })).toBe(false);
  });
  it("status filter", () => {
    expect(matchesCustomerListFilters(row({ status: "INACTIVE" }), { status: "ACTIVE" })).toBe(false);
    expect(matchesCustomerListFilters(row({ status: "INACTIVE" }), { status: "INACTIVE" })).toBe(true);
    expect(matchesCustomerListFilters(row(), { status: "ALL" })).toBe(true);
  });
  it("search + status compose with AND", () => {
    expect(matchesCustomerListFilters(row(), { search: "alpha", status: "ACTIVE" })).toBe(true);
    expect(matchesCustomerListFilters(row(), { search: "alpha", status: "INACTIVE" })).toBe(false);
  });
});
