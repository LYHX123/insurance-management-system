import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 8.1 Part 4 — Non-Motor Claim list, mirroring Motor Claim's
// conversion: search/customer/insurer/type/progress/status/dateFrom/dateTo/
// page move from local useState into URL-persisted state, plus a
// server-filtered customerId arriving only via a "View All Non-Motor
// Claims" deep-link (never a dropdown). No component-rendering test
// infrastructure in this project (no RTL/jsdom — see vitest.config.ts's
// node environment), so — consistent with documentTableLayout.test.ts's
// existing convention — this asserts on source text rather than rendered
// DOM output.

const tableSource = readFileSync(join(__dirname, "..", "non-motor-claim-table.tsx"), "utf8");
const detailSource = readFileSync(join(__dirname, "..", "non-motor-claim-detail.tsx"), "utf8");

describe("Non-Motor Claim table — URL-persisted list state", () => {
  it("uses the shared useUrlListState hook for every filter + page, not local useState", () => {
    expect(tableSource).toMatch(/import\s*\{[^}]*useUrlListState[^}]*\}\s*from\s*"@\/lib\/navigation\/useUrlListState"/);
    expect(tableSource).toMatch(/useUrlListState\(NON_MOTOR_CLAIM_LIST_DEFAULTS\)/);
    expect(tableSource).not.toMatch(/const \[search, setSearch\] = useState/);
    expect(tableSource).not.toMatch(/const \[page, setPage\] = useState/);
  });

  it("defaults cover every existing filter field plus page and customerId", () => {
    const defaultsMatch = tableSource.match(/const NON_MOTOR_CLAIM_LIST_DEFAULTS = (\{[\s\S]*?\});/);
    expect(defaultsMatch).not.toBeNull();
    const defaultsLiteral = defaultsMatch![1];
    for (const field of ["search", "customer", "insurer", "type", "progress", "status", "dateFrom", "dateTo", "page", "customerId"]) {
      expect(defaultsLiteral).toMatch(new RegExp(`${field}:`));
    }
  });

  it("search is debounced (no immediate flag) but resets page; every other control writes immediately and resets page", () => {
    expect(tableSource).toMatch(/setListState\(\{\s*search:\s*value,\s*page:\s*"1"\s*\}\)/);
    expect(tableSource).not.toMatch(/setListState\(\{\s*search:\s*value,\s*page:\s*"1"\s*\},\s*\{\s*immediate:\s*true\s*\}\)/);
    for (const field of ["customer", "insurer", "type", "progress", "status", "dateFrom", "dateTo"]) {
      const re = new RegExp(`setListState\\(\\{\\s*${field}:\\s*e\\.target\\.value,\\s*page:\\s*"1"\\s*\\},\\s*\\{\\s*immediate:\\s*true\\s*\\}\\)`);
      expect(tableSource).toMatch(re);
    }
  });

  it("page resolves to a positive integer, guarded against malformed values", () => {
    expect(tableSource).toMatch(/Math\.max\(1, Number\(listState\.page\) \|\| 1\)/);
  });

  it("pagination writes the page immediately via setListState, not local setPage", () => {
    expect(tableSource).toMatch(/onPageChange=\{\(p\) => setListState\(\{ page: String\(p\) \}, \{ immediate: true \}\)\}/);
  });

  it("renders the customerId chip with Clear, wired to the shared translation keys — customerId is never a dropdown", () => {
    expect(tableSource).toMatch(/\{customerId && \(/);
    expect(tableSource).toMatch(/t\.common\.filteredByCustomer/);
    expect(tableSource).toMatch(/t\.common\.clearFilter/);
    expect(tableSource).toMatch(/setListState\(\{ customerId: "" \}, \{ immediate: true \}\)/);
    // No <Select> bound to customerId anywhere.
    expect(tableSource).not.toMatch(/value=\{customerId\}/);
  });

  it("the View link carries returnTo so the current filtered URL survives navigating into the detail page", () => {
    expect(tableSource).toMatch(/buildReturnTo\(pathname, searchParams\.toString\(\)\)/);
    expect(tableSource).toMatch(/\/task\/non-motor-claim\/\$\{c\.id\}\?returnTo=\$\{encodeURIComponent\(returnTo\)\}/);
  });
});

describe("Non-Motor Claim detail — delete preserves the filtered return URL", () => {
  it("resolves the same smart-back href used by SmartBackLink instead of a hardcoded bare URL", () => {
    expect(detailSource).toMatch(/import\s*\{\s*useSmartBackHref\s*\}\s*from\s*"@\/lib\/navigation\/useSmartBack"/);
    expect(detailSource).toMatch(/const backHref = useSmartBackHref\("\/task\/non-motor-claim"\);/);
    expect(detailSource).toMatch(/router\.replace\(backHref\);/);
    // The old hardcoded, filter-stripping replace must be gone.
    expect(detailSource).not.toMatch(/router\.replace\("\/task\/non-motor-claim"\);/);
  });

  it("still uses replace (never push) so a deleted claim isn't reachable again via Back", () => {
    const deleteBranch = detailSource.slice(
      detailSource.indexOf('confirmKind === "delete"'),
      detailSource.indexOf("confirmTitle: Record<ConfirmKind, string>")
    );
    expect(deleteBranch).toMatch(/router\.replace/);
    expect(deleteBranch).not.toMatch(/router\.push/);
  });
});
