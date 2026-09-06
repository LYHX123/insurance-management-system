import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 13A — source-structure guardrails: every list toolbar wires the
// shared Export button + shared filter predicate, the export routes exist,
// and no financial field leaks into a policy export.

const root = join(__dirname, "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

const TABLES: Array<[string, string, string]> = [
  ["motor", "components/policy/motor/motor-list-table.tsx", "matchesMotorListFilters"],
  ["non-motor", "components/policy/non-motor/non-motor-list-table.tsx", "matchesNonMotorListFilters"],
  ["bond", "components/policy/bond/bond-list-table.tsx", "matchesBondListFilters"],
  ["work-permit", "components/policy/work-permit/work-permit-list-table.tsx", "matchesWorkPermitListFilters"],
];

describe("Policy list tables — export wiring", () => {
  for (const [slug, path, predicate] of TABLES) {
    it(`${slug}: uses the shared predicate + shared Export button, and builds the route href`, () => {
      const s = read(path);
      expect(s).toMatch(new RegExp(`import \\{ ${predicate} \\}`));
      expect(s).toMatch(/<ExportExcelButton href=\{exportHref\} \/>/);
      expect(s).toMatch(new RegExp(`buildListExportHref\\("/api/policy/export/${slug}"`));
      // the old disabled "coming soon" download placeholder is gone from Motor
      if (slug === "motor") expect(s).not.toMatch(/t\.comingSoon\.title/);
    });
  }
});

describe("Customer list table — export wiring", () => {
  it("uses the shared predicate + Export button", () => {
    const s = read("components/customers/customers-table.tsx");
    expect(s).toMatch(/import \{ matchesCustomerListFilters \}/);
    expect(s).toMatch(/<ExportExcelButton href=\{exportHref\} \/>/);
    expect(s).toMatch(/buildListExportHref\("\/api\/customer\/export"/);
  });
});

describe("Export routes exist and exclude financial fields", () => {
  it("customer export route", () => {
    const s = read("app/api/customer/export/route.ts");
    expect(s).toMatch(/hasPermission\(session\.user, "customer"\)/);
    expect(s).toMatch(/matchesCustomerListFilters/);
  });

  it("policy export route enforces permission and never writes a premium/cost/balance column", () => {
    const s = read("app/api/policy/export/[category]/route.ts");
    expect(s).toMatch(/POLICY_CATEGORY_PERMISSION\[config\.db\]/);
    expect(s).toMatch(/buildMotorListFilterWhere/);
    for (const banned of ["clientPremium", "customerPremium", "insurerCost", "clientBalance", "insurerBalance", "commission"]) {
      // these identifiers may appear in imported row types, but never as an
      // export column key/header — assert none are added to a `columns` list.
      expect(s).not.toMatch(new RegExp(`header:[^\\n]*${banned}`, "i"));
      expect(s).not.toMatch(new RegExp(`key: "${banned}"`));
    }
  });
});
