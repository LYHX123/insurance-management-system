import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 8.1 Part 4 — Daily Task's search/status filters move from local
// useState into URL-persisted state (useUrlListState), so a returnTo
// captured from this page restores them, and a delete-then-back round trip
// doesn't silently reset the list. This project has no component-rendering
// test infrastructure (no React Testing Library/jsdom — see
// vitest.config.ts's node environment), so, consistent with
// documentTableLayout.test.ts's existing convention, this asserts on source
// text rather than rendered DOM output.

const workspaceSource = readFileSync(join(__dirname, "..", "task-workspace.tsx"), "utf8");
const detailPanelSource = readFileSync(join(__dirname, "..", "task-detail-panel.tsx"), "utf8");

describe("Daily Task workspace — URL-persisted search/status", () => {
  it("uses the shared useUrlListState hook, not local useState, for search + status", () => {
    expect(workspaceSource).toMatch(/import\s*\{[^}]*useUrlListState[^}]*\}\s*from\s*"@\/lib\/navigation\/useUrlListState"/);
    expect(workspaceSource).toMatch(/useUrlListState\(TASK_LIST_DEFAULTS\)/);
    expect(workspaceSource).toMatch(/const\s*\{\s*search,\s*status:\s*statusFilter\s*\}\s*=\s*listState/);
  });

  it("defaults cover only search + status — no fabricated pagination/date/customer controls", () => {
    const defaultsMatch = workspaceSource.match(/const TASK_LIST_DEFAULTS = (\{[^}]*\});/);
    expect(defaultsMatch).not.toBeNull();
    const defaultsLiteral = defaultsMatch![1];
    expect(defaultsLiteral).toMatch(/search:\s*""/);
    expect(defaultsLiteral).toMatch(/status:\s*"ALL"/);
    // Daily Task's UI has no pagination, date range, or customer/participant
    // filter today — do not fabricate URL fields for controls that don't
    // exist in the rendered UI.
    expect(defaultsLiteral).not.toMatch(/page/);
    expect(defaultsLiteral).not.toMatch(/customerId/);
    expect(defaultsLiteral).not.toMatch(/date/i);
  });

  it("search is debounced (no immediate flag); status select writes immediately", () => {
    expect(workspaceSource).toMatch(/setListState\(\{\s*search:\s*value\s*\}\)/);
    expect(workspaceSource).not.toMatch(/setListState\(\{\s*search:\s*value\s*\},\s*\{\s*immediate:\s*true\s*\}\)/);
    expect(workspaceSource).toMatch(/setListState\(\{\s*status:\s*e\.target\.value\s*\},\s*\{\s*immediate:\s*true\s*\}\)/);
  });

  it("does not introduce a Pagination control (Daily Task is a scrollable list, not a paginated table)", () => {
    expect(workspaceSource).not.toMatch(/Pagination/);
  });
});

describe("Daily Task detail panel — delete-then-back preserves list filters", () => {
  it("reads the current search params before navigating back after a delete", () => {
    expect(detailPanelSource).toMatch(/import\s*\{[^}]*useSearchParams[^}]*\}\s*from\s*"next\/navigation"/);
    expect(detailPanelSource).toMatch(/const searchParams = useSearchParams\(\);/);
  });

  it("replaces to the category route WITH the existing query string, not a bare unfiltered URL", () => {
    expect(detailPanelSource).toMatch(/const qs = searchParams\.toString\(\);/);
    expect(detailPanelSource).toMatch(/router\.replace\(`\/task\/\$\{categorySlug\}\$\{qs \? `\?\$\{qs\}` : ""\}`\)/);
    // The old bare-URL replace (stripping search/status) must be gone.
    expect(detailPanelSource).not.toMatch(/router\.replace\(`\/task\/\$\{categorySlug\}`\);/);
  });

  it("still uses replace (never push) so a deleted task isn't reachable again via Back", () => {
    const deleteBranch = detailPanelSource.slice(
      detailPanelSource.indexOf('confirmKind === "delete"'),
      detailPanelSource.indexOf('confirmTitle: Record<ConfirmKind, string>')
    );
    expect(deleteBranch).toMatch(/router\.replace/);
    expect(deleteBranch).not.toMatch(/router\.push/);
  });
});
