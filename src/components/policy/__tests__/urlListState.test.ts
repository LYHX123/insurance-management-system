import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 8.1 Part 4 — URL-persisted list state for the 4 Policy category list
// pages, plus a server-side customerId filter for the "View All {Category}
// Policies" deep-link from Customer Detail. Mirrors the source-text
// assertion convention established by documentTableLayout.test.ts: this
// project has no component-rendering test infrastructure (no React Testing
// Library/jsdom — vitest.config.ts uses the node environment), so these
// assert on source text rather than rendered DOM output.

const categories = [
  {
    name: "Motor",
    tableFile: join(__dirname, "..", "motor", "motor-list-table.tsx"),
    pageFile: join(__dirname, "..", "..", "..", "app", "(app)", "policy", "motor", "page.tsx"),
    prismaWhereCategory: "MOTOR",
  },
  {
    name: "Non-Motor",
    tableFile: join(__dirname, "..", "non-motor", "non-motor-list-table.tsx"),
    pageFile: join(__dirname, "..", "..", "..", "app", "(app)", "policy", "non-motor", "page.tsx"),
    prismaWhereCategory: "NON_MOTOR",
  },
  {
    name: "Bond",
    tableFile: join(__dirname, "..", "bond", "bond-list-table.tsx"),
    pageFile: join(__dirname, "..", "..", "..", "app", "(app)", "policy", "bond", "page.tsx"),
    prismaWhereCategory: "BOND",
  },
  {
    name: "Work Permit",
    tableFile: join(__dirname, "..", "work-permit", "work-permit-list-table.tsx"),
    pageFile: join(__dirname, "..", "..", "..", "app", "(app)", "policy", "work-permit", "page.tsx"),
    prismaWhereCategory: "WORK_PERMIT",
  },
];

describe.each(categories)("$name policy list — URL-persisted state (Phase 8.1 Part 4)", ({ tableFile, pageFile, prismaWhereCategory }) => {
  const tableSource = readFileSync(tableFile, "utf8");
  const pageSource = readFileSync(pageFile, "utf8");

  it("imports and calls useUrlListState", () => {
    expect(tableSource).toMatch(/import\s*\{\s*useUrlListState\s*\}\s*from\s*"@\/lib\/navigation\/useUrlListState"/);
    expect(tableSource).toMatch(/useUrlListState\(/);
  });

  it("no longer uses plain useState for search/filter/pagination state", () => {
    expect(tableSource).not.toMatch(/import\s*\{\s*useMemo,\s*useState\s*\}/);
  });

  it("tracks a customerId key in its useUrlListState defaults object", () => {
    const defaultsMatch = tableSource.match(/const \w+_LIST_DEFAULTS = \{[\s\S]*?\};/);
    expect(defaultsMatch).not.toBeNull();
    expect(defaultsMatch![0]).toMatch(/customerId:\s*""/);
  });

  it("clamps page to a positive integer when reading it back out of the URL", () => {
    expect(tableSource).toMatch(/Math\.max\(1,\s*Number\(listState\.page\)\s*\|\|\s*1\)/);
  });

  it("resets page to \"1\" on every filter change (not on pagination itself)", () => {
    // Every setListState call that changes a filter also carries page: "1".
    const filterCalls = tableSource.match(/setListState\(\{[^}]*(search|customer|type|insurer|status|expiryDate|outstandingClientOnly|outstandingInsurerOnly):[^}]*\}/g) ?? [];
    expect(filterCalls.length).toBeGreaterThan(0);
    for (const call of filterCalls) {
      expect(call).toMatch(/page:\s*"1"/);
    }
  });

  it("renders a 'filtered by customer' chip with a Clear button gated on customerId", () => {
    expect(tableSource).toMatch(/\{customerId\s*&&/);
    expect(tableSource).toMatch(/t\.common\.filteredByCustomer/);
    expect(tableSource).toMatch(/t\.common\.clearFilter/);
    expect(tableSource).toMatch(/setListState\(\{\s*customerId:\s*""\s*\},\s*\{\s*immediate:\s*true\s*\}\)/);
  });

  it("page.tsx accepts a customerId searchParams and merges it into the Prisma where clause", () => {
    expect(pageSource).toMatch(/searchParams:\s*Promise<\{\s*customerId\?:\s*string\s*\}>/);
    expect(pageSource).toMatch(/const \{ customerId \} = await searchParams;/);
    expect(pageSource).toMatch(new RegExp(`category:\\s*"${prismaWhereCategory}"[\\s\\S]{0,40}customerId`));
  });
});
