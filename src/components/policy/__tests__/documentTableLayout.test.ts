import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Correction 3 — the Policy documents table row was extremely tall because
// the full Dropbox path was rendered directly inside a narrow table column
// and wrapped character-by-character. These are source-structure guardrails
// (this project has no component-rendering test infrastructure — no
// React Testing Library/jsdom, see vitest.config.ts's node environment —
// so, consistent with phase5Regression.test.ts's existing convention, this
// asserts on source text rather than rendered DOM output).

const documentsTabSource = readFileSync(join(__dirname, "..", "motor", "motor-documents-tab.tsx"), "utf8");
const statusSource = readFileSync(join(__dirname, "..", "policy-document-dropbox-status.tsx"), "utf8");
const pathDisplaySource = readFileSync(join(__dirname, "..", "..", "dropbox", "dropbox-path-display.tsx"), "utf8");

describe("Policy documents table — compact row / expandable Dropbox details", () => {
  it("reuses the shared DropboxPathDisplay component rather than re-implementing path rendering", () => {
    expect(statusSource).toMatch(/import\s*\{[^}]*DropboxPathDisplay[^}]*\}\s*from\s*"@\/components\/dropbox\/dropbox-path-display"/);
    // No second path-display implementation anywhere near the documents
    // table — path text is never rendered/wrapped outside the one shared
    // component.
    expect(documentsTabSource).not.toMatch(/break-all|break-words/);
    expect(statusSource).not.toMatch(/break-all|break-words/);
  });

  it("the collapsed table row never renders the raw Dropbox path — only the compact badge component", () => {
    expect(documentsTabSource).toMatch(/PolicyDocumentDropboxBadge/);
    expect(documentsTabSource).not.toMatch(/dropbox\.view\.path/);
  });

  it("the full path/details only render through the expandable details component, gated by a toggle", () => {
    expect(documentsTabSource).toMatch(/PolicyDocumentDropboxDetails/);
    expect(documentsTabSource).toMatch(/expandedId/);
    expect(statusSource).toMatch(/export function PolicyDocumentDropboxDetails/);
    expect(statusSource).toMatch(/export function PolicyDocumentDropboxBadge/);
  });

  it("admin-only Dropbox sync actions (retry/reupload/verify) live in the expanded details, still gated by isAdmin", () => {
    expect(statusSource).toMatch(/PolicyDocumentDropboxDetails[\s\S]*isAdmin && dropbox\.view\.state !== "not_connected"/);
    // Not present in the compact badge component's own body.
    const badgeBody = statusSource.slice(
      statusSource.indexOf("export function PolicyDocumentDropboxBadge"),
      statusSource.indexOf("export function PolicyDocumentDropboxDetails")
    );
    expect(badgeBody).not.toMatch(/retryPolicyDocumentSyncAction|reuploadPolicyDocumentAction|verifyPolicyDocumentAction/);
  });

  it("a mobile card layout exists alongside the desktop table (md breakpoint split, not a squeezed table)", () => {
    expect(documentsTabSource).toMatch(/hidden md:block/);
    expect(documentsTabSource).toMatch(/md:hidden/);
  });

  it("long filenames are truncated with the full value available via title, not left to break the layout", () => {
    expect(documentsTabSource).toMatch(/truncate[\s\S]*title=\{doc\.originalFileName\}|title=\{doc\.originalFileName\}[\s\S]*truncate/);
  });

  it("the shared DropboxPathDisplay wraps by word/segment first, not character-by-character", () => {
    // `break-words` (overflow-wrap: break-word) breaks only a segment that
    // itself doesn't fit, preferring normal breaks first — `break-all`
    // (word-break: break-all, the original bug) breaks at every character
    // regardless of fit and must not be reintroduced.
    expect(pathDisplaySource).toMatch(/break-words/);
    expect(pathDisplaySource).not.toMatch(/break-all/);
    expect(pathDisplaySource).toMatch(/w-full/);
  });
});
