import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 12A (corrected) — "经办人 / Contact Person" is a free-text customer-
// side contact, NOT an internal User. These are source-structure guardrails
// (this project asserts on source text for layout/structure — see
// documentTableLayout.test.ts / urlListState.test.ts).

const dir = (...p: string[]) => join(__dirname, "..", ...p);
const read = (...p: string[]) => readFileSync(dir(...p), "utf8");

const motorTable = read("motor", "motor-list-table.tsx");
const motorCreateForm = read("motor", "create-motor-record-form.tsx");
const motorOverview = read("motor", "motor-overview-tab.tsx");
const motorDetailView = read("motor", "motor-detail-view.tsx");
const enDict = readFileSync(join(__dirname, "..", "..", "..", "i18n", "dictionaries", "en.ts"), "utf8");
const zhDict = readFileSync(join(__dirname, "..", "..", "..", "i18n", "dictionaries", "zh.ts"), "utf8");

describe("Contact Person is free text, not an internal-User handler", () => {
  it("no internal-User handler concepts remain in the Motor UI", () => {
    for (const src of [motorTable, motorCreateForm, motorOverview, motorDetailView]) {
      expect(src).not.toMatch(/handlerId|handlerOptions|HandlerUserOption|HANDLER_FILTER|HANDLER_NOT_FOUND|HANDLER_INACTIVE/);
      expect(src).not.toMatch(/t\.policy\.(allHandlers|handlerMine|selectHandler|handlerSearchNoResults)/);
    }
  });

  it("the handler option-loader helper files are gone", () => {
    for (const f of ["handlerOptions.ts", "handlerSearchOptions.ts"]) {
      expect(() => readFileSync(join(__dirname, "..", "..", "..", "lib", "users", f), "utf8")).toThrow();
    }
  });

  it("the create form uses a plain text Input for Contact Person (no dropdown / SearchableSelect for it)", () => {
    expect(motorCreateForm).toMatch(/t\.policy\.contactPersonOptional/);
    expect(motorCreateForm).toMatch(/<Input value=\{contactPerson\}/);
    expect(motorCreateForm).not.toMatch(/buildHandlerSearchOptions|handlerSearchOptions/);
  });

  it("the edit form uses a plain text Input for Contact Person and allows clearing it", () => {
    expect(motorOverview).toMatch(/t\.policy\.contactPersonOptional/);
    expect(motorOverview).toMatch(/<Input value=\{contactPerson\}/);
    expect(motorOverview).toMatch(/customerContactPerson: contactPerson \|\| null/);
  });

  it("the detail view shows Contact Person with an em-dash fallback", () => {
    expect(motorOverview).toMatch(/t\.policy\.contactPerson,\s*detail\.customerContactPerson \|\| "—"/);
  });
});

describe("Motor list header layout (Phase 12A section 2)", () => {
  it("every Motor list <th> is whitespace-nowrap", () => {
    const headerBlock = motorTable.match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? "";
    const ths = headerBlock.match(/<th\b[^>]*>/g) ?? [];
    expect(ths.length).toBe(12);
    for (const th of ths) expect(th).toMatch(/whitespace-nowrap/);
  });

  it("column widths are rebalanced via a <colgroup> (not one giant min-width)", () => {
    expect(motorTable).toMatch(/<colgroup>[\s\S]*?<\/colgroup>/);
    // Customer + Insurance Type columns are the widest; Actions is the
    // narrowest.
    expect(motorTable).toMatch(/width: "200px"/); // Customer
    expect(motorTable).toMatch(/width: "160px"/); // Insurance Type
    expect(motorTable).toMatch(/width: "64px"/); // Actions
    // Horizontal scroll preserved.
    expect(motorTable).toMatch(/<TableWrap scroll>/);
    expect(motorTable).toMatch(/min-w-\[\d+px\]/);
  });

  it("(11) no deliberate <br> / forced wrapping in the Motor list table or the Chinese header strings", () => {
    expect(motorTable).not.toMatch(/<br\s*\/?>/);
    const zhPolicy = zhDict.match(/policy:\s*\{[\s\S]*?\n {2}\},/)?.[0] ?? zhDict;
    for (const key of ["insurer:", "contactPerson:", "expiryDate:", "clientPremium:", "clientBalance:"]) {
      const line = zhPolicy.match(new RegExp(`\\b${key}\\s*"[^"]*"`))?.[0] ?? "";
      expect(line).not.toMatch(/<br|\\n/);
    }
  });

  it("both dictionaries define contactPerson and neither still defines the removed handler keys", () => {
    for (const d of [enDict, zhDict]) {
      expect(d).toMatch(/\bcontactPerson:\s*"/);
      expect(d).toMatch(/\bcontactPersonOptional:\s*"/);
      expect(d).not.toMatch(/\ballHandlers:\s*"|\bhandlerMine:\s*"|\bselectHandler:\s*"/);
    }
  });
});

describe("(12) Non-Motor / Bond / Work Permit list tables are unchanged by Phase 12A", () => {
  const others = [
    read("non-motor", "non-motor-list-table.tsx"),
    read("bond", "bond-list-table.tsx"),
    read("work-permit", "work-permit-list-table.tsx"),
  ];
  it("still use the single-date expiryDate key + PolicyExpiryDateFilter value/onChange", () => {
    for (const src of others) {
      expect(src).toMatch(/expiryDate:\s*""/);
      expect(src).toMatch(/<PolicyExpiryDateFilter\s+value=\{expiryDate\}/);
      expect(src).not.toMatch(/contactPerson|customerContactPerson|expiryFrom|expiryTo/);
    }
  });
});
