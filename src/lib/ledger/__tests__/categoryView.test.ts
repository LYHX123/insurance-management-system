import { describe, it, expect } from "vitest";
import { buildCategoryOptions, categorySelectItems, descendantFilterIds } from "@/lib/ledger/categoryView";
import type { CategoryTreeNode } from "@/lib/ledger/categoryTree";

const rows: CategoryTreeNode[] = [
  { id: "premium", name: "Premium Income", transactionType: "INCOME", isActive: true, parentId: null, sortOrder: 0 },
  { id: "motor", name: "Motor Premium", transactionType: "INCOME", isActive: true, parentId: "premium", sortOrder: 0 },
  { id: "private", name: "Private Motor", transactionType: "INCOME", isActive: true, parentId: "motor", sortOrder: 1 },
  { id: "comm", name: "Commercial Motor", transactionType: "INCOME", isActive: true, parentId: "motor", sortOrder: 0 },
  { id: "office", name: "Office Expense", transactionType: "EXPENSE", isActive: false, parentId: null, sortOrder: 0 },
  { id: "rent", name: "Rent", transactionType: "EXPENSE", isActive: true, parentId: "office", sortOrder: 0 },
];

describe("buildCategoryOptions", () => {
  const options = buildCategoryOptions(rows);

  it("emits tree order (each parent immediately followed by its subtree), siblings by sortOrder then name", () => {
    // Roots are ordered by (sortOrder, name) — "Office Expense" sorts before
    // "Premium Income" — and each subtree follows its parent contiguously.
    expect(options.map((o) => o.id)).toEqual(["office", "rent", "premium", "motor", "comm", "private"]);
  });

  it("computes depth, path and leaf", () => {
    const byId = new Map(options.map((o) => [o.id, o]));
    expect(byId.get("premium")!.depth).toBe(1);
    expect(byId.get("private")!.depth).toBe(3);
    expect(byId.get("private")!.path).toBe("Premium Income › Motor Premium › Private Motor");
    expect(byId.get("premium")!.isLeaf).toBe(false);
    expect(byId.get("private")!.isLeaf).toBe(true);
  });

  it("marks the whole subtree of an inactive parent effectivelyInactive", () => {
    const byId = new Map(options.map((o) => [o.id, o]));
    expect(byId.get("office")!.effectivelyInactive).toBe(true);
    expect(byId.get("rent")!.effectivelyInactive).toBe(true); // active row, inactive ancestor
    expect(byId.get("rent")!.isActive).toBe(true);
    expect(byId.get("premium")!.effectivelyInactive).toBe(false);
  });
});

describe("categorySelectItems — leaf-only selectability", () => {
  const options = buildCategoryOptions(rows);

  it("only active leaves whose ancestors are active are selectable", () => {
    const items = categorySelectItems(options, "INCOME");
    const sel = new Map(items.map((i) => [i.id, i.selectable]));
    expect(sel.get("premium")).toBe(false); // branch
    expect(sel.get("motor")).toBe(false); // branch
    expect(sel.get("private")).toBe(true);
    expect(sel.get("comm")).toBe(true);
  });

  it("an inactive subtree is never selectable", () => {
    const items = categorySelectItems(options, "EXPENSE");
    expect(items.find((i) => i.id === "rent")!.selectable).toBe(false);
  });

  it("keepSelectableId keeps the current (now non-leaf / inactive) category usable on edit", () => {
    const items = categorySelectItems(options, "INCOME", "motor");
    expect(items.find((i) => i.id === "motor")!.selectable).toBe(true);
  });
});

describe("descendantFilterIds — X.22 / X.23", () => {
  const options = buildCategoryOptions(rows);
  it("a parent selection includes all descendants", () => {
    expect(new Set(descendantFilterIds(options, "premium"))).toEqual(new Set(["premium", "motor", "private", "comm"]));
  });
  it("a leaf selection is just itself", () => {
    expect(descendantFilterIds(options, "private")).toEqual(["private"]);
  });
});
