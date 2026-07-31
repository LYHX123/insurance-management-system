import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Category D — Invoice detail Dropbox UI (Phase 6, Part 6/12/14.D). No
// component-rendering test infrastructure exists in this project (no React
// Testing Library/jsdom — vitest.config.ts uses the node environment), so
// — consistent with documentTableLayout.test.ts's established convention —
// this asserts on source text rather than rendered DOM output.

const sectionSource = readFileSync(join(__dirname, "..", "invoice-dropbox-section.tsx"), "utf8");
const listSource = readFileSync(join(__dirname, "..", "invoice-list-table.tsx"), "utf8");

describe("Invoice Dropbox detail section", () => {
  it("reuses the shared CollapsibleDropboxPath component (default-collapsed, Phase 8 Part 6) rather than re-implementing path rendering", () => {
    expect(sectionSource).toMatch(/import\s*\{\s*CollapsibleDropboxPath\s*\}\s*from\s*"@\/components\/dropbox\/dropbox-path-display"/);
    expect(sectionSource).not.toMatch(/break-all|break-words/);
  });

  it("renders all required paths (Business Folder, Invoice Folder, Invoice File) via the shared collapsible component", () => {
    const matches = sectionSource.match(/<CollapsibleDropboxPath/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("shows a distinct Business File Source label for all three possible sources", () => {
    expect(sectionSource).toMatch(/dropboxSourceQuotation/);
    expect(sectionSource).toMatch(/dropboxSourcePolicyFallback/);
    expect(sectionSource).toMatch(/dropboxSourceInvoiceFallback/);
  });

  it("shows the required planned-path note only while the file path is still planned, never implying a folder already exists", () => {
    expect(sectionSource).toMatch(/dropbox\.invoiceFile\.isPlanned/);
    expect(sectionSource).toMatch(/dropboxPlannedPathTitle/);
    expect(sectionSource).toMatch(/dropboxPlannedPathNote/);
  });

  it("admin-only sync actions (retry/verify file/verify business folder) are gated by isAdmin", () => {
    expect(sectionSource).toMatch(/\{isAdmin\s*&&\s*\(/);
    const adminBlock = sectionSource.slice(sectionSource.indexOf("{isAdmin"));
    expect(adminBlock).toMatch(/dropboxRetrySync/);
    expect(adminBlock).toMatch(/dropboxVerifyFile/);
    expect(adminBlock).toMatch(/dropboxVerifyBusinessFolder/);
  });

  it("renders nothing when Dropbox is not connected (no misleading UI)", () => {
    expect(sectionSource).toMatch(/if \(!dropbox\.dropboxConnected\) return null;/);
  });
});

describe("Invoice list page stays uncrowded (Part 7)", () => {
  it("no full Dropbox path is rendered in the list table", () => {
    expect(listSource).not.toMatch(/DropboxPathDisplay/);
    expect(listSource).not.toMatch(/dropboxDisplayPath/);
  });
});
