import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 8.1 Part 15.E — Settings Tab was the one Tab implementation in the
// app that didn't sync to the URL (found during Phase 8 Final QA), unlike
// Customer/Policy/Quotation-case detail tabs. Source-structure assertion,
// not rendered DOM (this project's vitest config is node-only).
const settingsContentSource = readFileSync(join(__dirname, "..", "settings-content.tsx"), "utf8");

describe("Settings Tab persistence (Phase 8.1 Part 15.E)", () => {
  it("reads the initial tab from the URL's ?tab= param", () => {
    expect(settingsContentSource).toMatch(/searchParams\.get\("tab"\)/);
  });

  it("writes the tab back to the URL via router.replace (never push) on change", () => {
    expect(settingsContentSource).toMatch(/handleTabChange/);
    expect(settingsContentSource).toMatch(/router\.replace\(/);
    expect(settingsContentSource).not.toMatch(/router\.push\(\s*qs/);
  });

  it("the Tabs component's onChange is wired to the URL-syncing handler, not a bare setState", () => {
    expect(settingsContentSource).toMatch(/onChange=\{handleTabChange\}/);
  });
});
