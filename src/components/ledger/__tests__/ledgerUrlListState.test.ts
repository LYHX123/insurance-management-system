import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 8.1 — Manual Record and System Record (Ledger) list state was moved
// from plain useState into the shared useUrlListState hook (see
// src/lib/navigation/useUrlListState.ts and invoice-list-table.tsx for the
// established pattern), so a returnTo/back-navigation restores filters and
// pagination via the URL. Ledger has no customerId server-filter / "View
// All" deep-link concept (unlike Policy/Invoice/Quotation), so these
// assertions only cover the filters that already existed in the UI.
//
// This project has no component-rendering test infrastructure (no React
// Testing Library/jsdom — vitest.config.ts uses the node environment), so,
// consistent with documentTableLayout.test.ts's established convention,
// these are source-structure guardrails via readFileSync rather than
// rendered-DOM assertions.

const manualSource = readFileSync(join(__dirname, "..", "manual-ledger-table.tsx"), "utf8");
const systemSource = readFileSync(join(__dirname, "..", "system-ledger-table.tsx"), "utf8");

describe("Manual Ledger table — URL-persisted list state", () => {
  it("imports and calls useUrlListState", () => {
    expect(manualSource).toMatch(/import\s*\{[^}]*useUrlListState[^}]*\}\s*from\s*"@\/lib\/navigation\/useUrlListState"/);
    expect(manualSource).toMatch(/useUrlListState\(MANUAL_LEDGER_LIST_DEFAULTS\)/);
  });

  it("declares a page default and parses it defensively against malformed/negative URL values", () => {
    expect(manualSource).toMatch(/page:\s*"1"/);
    expect(manualSource).toMatch(/Math\.max\(1,\s*Number\(listState\.page\)\s*\|\|\s*1\)/);
  });

  it("no longer uses plain useState for the filter/pagination fields", () => {
    expect(manualSource).not.toMatch(/useState\(""\)/);
    expect(manualSource).not.toMatch(/useState<"ALL"/);
    expect(manualSource).not.toMatch(/useState\(1\)/);
  });

  it("resets page to 1 alongside the type filter", () => {
    expect(manualSource).toMatch(/setListState\(\{\s*type:\s*e\.target\.value,\s*page:\s*"1"\s*\},\s*\{\s*immediate:\s*true\s*\}\)/);
  });

  it("resets page to 1 alongside the category filter", () => {
    expect(manualSource).toMatch(/setListState\(\{\s*categoryId:\s*e\.target\.value,\s*page:\s*"1"\s*\},\s*\{\s*immediate:\s*true\s*\}\)/);
  });

  it("resets page to 1 alongside the createdBy filter", () => {
    expect(manualSource).toMatch(/setListState\(\{\s*createdById:\s*e\.target\.value,\s*page:\s*"1"\s*\},\s*\{\s*immediate:\s*true\s*\}\)/);
  });

  it("resets page to 1 alongside the date range filters", () => {
    expect(manualSource).toMatch(/setListState\(\{\s*dateFrom:\s*e\.target\.value,\s*page:\s*"1"\s*\},\s*\{\s*immediate:\s*true\s*\}\)/);
    expect(manualSource).toMatch(/setListState\(\{\s*dateTo:\s*e\.target\.value,\s*page:\s*"1"\s*\},\s*\{\s*immediate:\s*true\s*\}\)/);
  });

  it("resets page to 1 on search, without forcing an immediate URL write (debounced text input)", () => {
    expect(manualSource).toMatch(/setListState\(\{\s*search:\s*value,\s*page:\s*"1"\s*\}\)/);
    // Search's onChange call must not itself carry { immediate: true } —
    // every other control does.
    const searchOnChange = manualSource.match(/onChange=\{\(value\) => setListState\(\{ search: value, page: "1" \}\)\}/);
    expect(searchOnChange).not.toBeNull();
  });

  it("pagination writes the page key immediately", () => {
    expect(manualSource).toMatch(/onPageChange=\{\(p\) => setListState\(\{\s*page:\s*String\(p\)\s*\},\s*\{\s*immediate:\s*true\s*\}\)\}/);
  });
});

describe("System Ledger table — URL-persisted list state", () => {
  it("imports and calls useUrlListState", () => {
    expect(systemSource).toMatch(/import\s*\{[^}]*useUrlListState[^}]*\}\s*from\s*"@\/lib\/navigation\/useUrlListState"/);
    expect(systemSource).toMatch(/useUrlListState\(SYSTEM_LEDGER_LIST_DEFAULTS\)/);
  });

  it("declares a page default and parses it defensively against malformed/negative URL values", () => {
    expect(systemSource).toMatch(/page:\s*"1"/);
    expect(systemSource).toMatch(/Math\.max\(1,\s*Number\(listState\.page\)\s*\|\|\s*1\)/);
  });

  it("no longer uses plain useState for the filter/pagination fields", () => {
    expect(systemSource).not.toMatch(/useState\(""\)/);
    expect(systemSource).not.toMatch(/useState<"ALL"/);
    expect(systemSource).not.toMatch(/useState\(1\)/);
  });

  it("resets page to 1 alongside the source type filter", () => {
    expect(systemSource).toMatch(/setListState\(\{\s*sourceType:\s*e\.target\.value,\s*page:\s*"1"\s*\},\s*\{\s*immediate:\s*true\s*\}\)/);
  });

  it("resets page to 1 alongside the direction filter", () => {
    expect(systemSource).toMatch(/setListState\(\{\s*direction:\s*e\.target\.value,\s*page:\s*"1"\s*\},\s*\{\s*immediate:\s*true\s*\}\)/);
  });

  it("resets page to 1 alongside the customer filter", () => {
    expect(systemSource).toMatch(/setListState\(\{\s*customer:\s*e\.target\.value,\s*page:\s*"1"\s*\},\s*\{\s*immediate:\s*true\s*\}\)/);
  });

  it("resets page to 1 alongside the policy category filter", () => {
    expect(systemSource).toMatch(/setListState\(\{\s*policyCategory:\s*e\.target\.value,\s*page:\s*"1"\s*\},\s*\{\s*immediate:\s*true\s*\}\)/);
  });

  it("resets page to 1 alongside the date range filters", () => {
    expect(systemSource).toMatch(/setListState\(\{\s*dateFrom:\s*e\.target\.value,\s*page:\s*"1"\s*\},\s*\{\s*immediate:\s*true\s*\}\)/);
    expect(systemSource).toMatch(/setListState\(\{\s*dateTo:\s*e\.target\.value,\s*page:\s*"1"\s*\},\s*\{\s*immediate:\s*true\s*\}\)/);
  });

  it("resets page to 1 on search, without forcing an immediate URL write (debounced text input)", () => {
    const searchOnChange = systemSource.match(/onChange=\{\(value\) => setListState\(\{ search: value, page: "1" \}\)\}/);
    expect(searchOnChange).not.toBeNull();
  });

  it("pagination writes the page key immediately", () => {
    expect(systemSource).toMatch(/onPageChange=\{\(p\) => setListState\(\{\s*page:\s*String\(p\)\s*\},\s*\{\s*immediate:\s*true\s*\}\)\}/);
  });

  it("Manual and System ledgers use independent defaults constants (no shared object reference)", () => {
    expect(manualSource).toMatch(/const MANUAL_LEDGER_LIST_DEFAULTS/);
    expect(systemSource).toMatch(/const SYSTEM_LEDGER_LIST_DEFAULTS/);
  });
});
