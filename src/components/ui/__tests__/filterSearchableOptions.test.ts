import { describe, it, expect } from "vitest";
import { filterSearchableOptions, type SearchableSelectOption } from "../searchable-select";

// Customer search combobox (Quotation creation) — this pure function is the
// entire matching logic behind it. No React component-testing
// infrastructure exists in this codebase (no @testing-library/react
// anywhere), so the filter is exercised directly rather than through a
// rendered component.

const customers: SearchableSelectOption[] = [
  {
    id: "cust-1",
    label: "AVIC INTL BEIJING (E.A) COMPANY LIMITED (CUST-0007)",
    searchText: "avic intl beijing (e.a) company limited avic-bj cust-0007",
  },
  {
    id: "cust-2",
    label: "China Railway Seventh Group Co., Limited (CUST-0002)",
    searchText: "china railway seventh group co., limited crsg cust-0002",
  },
  {
    id: "cust-3",
    label: "Acme Ltd (CUST-0099)",
    searchText: "acme ltd  cust-0099",
  },
];

describe("filterSearchableOptions — Customer search combobox", () => {
  it("matches by a substring of the Company Name", () => {
    expect(filterSearchableOptions(customers, "railway").map((c) => c.id)).toEqual(["cust-2"]);
  });

  it("matches by Short Name", () => {
    expect(filterSearchableOptions(customers, "crsg").map((c) => c.id)).toEqual(["cust-2"]);
  });

  it("is case-insensitive — avic, AVIC, and Avic all return the same result", () => {
    const lower = filterSearchableOptions(customers, "avic").map((c) => c.id);
    const upper = filterSearchableOptions(customers, "AVIC").map((c) => c.id);
    const mixed = filterSearchableOptions(customers, "Avic").map((c) => c.id);
    expect(lower).toEqual(["cust-1"]);
    expect(upper).toEqual(lower);
    expect(mixed).toEqual(lower);
  });

  it("matches a partial substring found in the middle of the Company Name, not just a prefix", () => {
    expect(filterSearchableOptions(customers, "beij").map((c) => c.id)).toEqual(["cust-1"]);
  });

  it("returns an empty list when nothing matches (caller renders the 'No customers found' state)", () => {
    expect(filterSearchableOptions(customers, "nonexistent customer xyz")).toEqual([]);
  });

  it("returns every option, unfiltered, once the query is cleared", () => {
    expect(filterSearchableOptions(customers, "")).toEqual(customers);
    expect(filterSearchableOptions(customers, "   ")).toEqual(customers);
  });

  it("does not use the typed search text as the selected value — only ever hands back matching option objects with their own id", () => {
    const results = filterSearchableOptions(customers, "avic");
    expect(results[0].id).toBe("cust-1");
    expect(results[0].id).not.toBe("avic");
  });
});
