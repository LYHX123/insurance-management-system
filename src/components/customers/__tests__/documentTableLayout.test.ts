import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 8.1 Part 11 — the Customer Documents table's File Name column had
// no width bound/truncation, unlike the Policy documents table (see
// src/components/policy/__tests__/documentTableLayout.test.ts's equivalent
// guard). Source-structure assertion, not rendered DOM — this project's
// vitest config is node-only (no React Testing Library/jsdom).
const customerDetailSource = readFileSync(join(__dirname, "..", "customer-detail.tsx"), "utf8");

describe("Customer Documents table — filename layout (Phase 8.1 Part 11)", () => {
  it("long filenames are truncated with the full value available via title, not left to break the layout", () => {
    expect(customerDetailSource).toMatch(/truncate[\s\S]*title=\{doc\.originalFileName\}|title=\{doc\.originalFileName\}[\s\S]*truncate/);
  });

  it("the filename column has a bounded max-width so it can't stretch the row", () => {
    const fileNameCellMatch = customerDetailSource.match(/<td className="max-w-\[\d+px\] truncate text-zinc-500" title=\{doc\.originalFileName\}>/);
    expect(fileNameCellMatch).not.toBeNull();
  });

  it("the Dropbox path column stays collapsed by default (unaffected by this change)", () => {
    expect(customerDetailSource).toMatch(/expandedDropboxDocIds/);
    expect(customerDetailSource).not.toMatch(/break-all/);
  });
});
