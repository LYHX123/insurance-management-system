import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 12E — source-structure guardrails (this project asserts on source
// text for layout/structure — see documentTableLayout.test.ts /
// ledgerUrlListState.test.ts).

const read = (...p: string[]) => readFileSync(join(__dirname, "..", "..", "..", ...p), "utf8");

const table = read("components", "ledger", "manual-ledger-table.tsx");
const modal = read("components", "ledger", "manual-entry-modal.tsx");
const manage = read("components", "ledger", "manage-categories-modal.tsx");
const exportRoute = read("app", "api", "ledger", "manual", "export", "route.ts");
const page = read("app", "(app)", "ledger", "manual", "page.tsx");

describe("Manual Ledger list — Phase 12E columns & filters", () => {
  it("shows a Category (path) column and a Counterparty column", () => {
    expect(table).toMatch(/t\.ledger\.counterparty/);
    expect(table).toMatch(/r\.categoryPath/);
    expect(table).toMatch(/r\.counterpartyName \|\| "—"/);
  });

  it("renders payment method through the shared label helper (legacy shows as stored)", () => {
    expect(table).toMatch(/displayPaymentMethod\(r\.paymentMethod, t\.ledger\)/);
  });

  it("category filter is hierarchical (a parent resolves to its whole subtree)", () => {
    expect(table).toMatch(/descendantFilterIds\(categories, categoryFilter\)/);
  });

  it("X.24: counterparty filter composes with the other filters via AND", () => {
    expect(table).toMatch(/matchesCounterparty/);
    expect(table).toMatch(/matchesTerm &&\s*matchesType &&\s*matchesCategory &&\s*matchesCounterparty &&\s*matchesCreatedBy &&\s*matchesFrom &&\s*matchesTo/);
  });

  it("keeps URL-persisted list state and resets page on the new filters", () => {
    expect(table).toMatch(/counterparty: "",/);
    expect(table).toMatch(/setListState\(\{ counterparty: e\.target\.value, page: "1" \}\)/);
    expect(table).toMatch(/setListState\(\{ categoryId: e\.target\.value, page: "1" \}, \{ immediate: true \}\)/);
  });

  it("export URL carries the counterparty filter", () => {
    expect(table).toMatch(/params\.set\("counterparty", counterpartyFilter\.trim\(\)\)/);
  });
});

describe("Manual Entry modal — Phase 12E fields", () => {
  it("category picker is a hierarchical, leaf-only select", () => {
    expect(modal).toMatch(/categorySelectItems\(localCategories, transactionType, entry\?\.categoryId/);
    expect(modal).toMatch(/disabled=\{!c\.selectable\}/);
  });

  it("Payment Method is a dropdown built from the shared constant, with a legacy option on edit", () => {
    expect(modal).toMatch(/manualLedgerPaymentMethodOptions\(t\.ledger\)/);
    expect(modal).toMatch(/<Select value=\{paymentMethod\}/);
    expect(modal).toMatch(/legacyPaymentMethod/);
    expect(modal).not.toMatch(/<Input value=\{paymentMethod\}/); // no longer free text
  });

  it("Counterparty is free text with a datalist of prior values", () => {
    expect(modal).toMatch(/list=\{COUNTERPARTY_DATALIST_ID\}/);
    expect(modal).toMatch(/<datalist id=\{COUNTERPARTY_DATALIST_ID\}>/);
    expect(modal).toMatch(/counterpartyName: counterpartyName\.trim\(\) \|\| null/);
  });
});

describe("Manage Categories — tree manager", () => {
  it("is a tree with Add root / Add child / reorder / delete and a depth cap", () => {
    expect(manage).toMatch(/addRootCategory/);
    expect(manage).toMatch(/t\.ledger\.addChild/);
    expect(manage).toMatch(/reorderLedgerCategoryAction/);
    expect(manage).toMatch(/deleteLedgerCategoryAction/);
    expect(manage).toMatch(/node\.depth < MAX_LEDGER_CATEGORY_DEPTH/);
  });
  it("no drag-and-drop library is used", () => {
    expect(manage).not.toMatch(/dnd|drag|sortable/i);
  });
});

describe("Manual Ledger export — Phase 12E columns", () => {
  it("X.25 / X.26: adds Category Path and Counterparty columns, keeps Payment Method", () => {
    expect(exportRoute).toMatch(/header: "Category Path"/);
    expect(exportRoute).toMatch(/header: "Counterparty"/);
    expect(exportRoute).toMatch(/header: "Payment Method"/);
    expect(exportRoute).toMatch(/header: "Category",/); // original column kept
  });
  it("X.41 / X.42: payment method exports the readable value; legacy verbatim", () => {
    expect(exportRoute).toMatch(/paymentMethodForExport\(e\.paymentMethod\)/);
    expect(exportRoute).toMatch(/MANUAL_LEDGER_PAYMENT_METHOD_EXPORT_LABEL\[value\] : value/);
  });
  it("category filter in the export is hierarchical too", () => {
    expect(exportRoute).toMatch(/descendantFilterIds\(categoryOptions, categoryId\)/);
  });
});

describe("Manual Ledger page wiring", () => {
  it("passes tree-built category options and counterparty into rows", () => {
    expect(page).toMatch(/buildCategoryOptions\(categories\)/);
    expect(page).toMatch(/counterpartyName: e\.counterpartyName/);
    expect(page).toMatch(/categoryPath: pathById\.get\(e\.categoryId\)/);
  });
});
