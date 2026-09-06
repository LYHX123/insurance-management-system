import { describe, it, expect } from "vitest";
import {
  MAX_LEDGER_CATEGORY_DEPTH,
  indexCategories,
  categoryDepth,
  prospectiveChildDepth,
  subtreeHeight,
  collectDescendantIds,
  categoryAndDescendantIds,
  wouldCreateCycle,
  isLeafCategory,
  categoryPath,
  ancestorPathIds,
  type CategoryTreeNode,
} from "@/lib/ledger/categoryTree";

// Phase 12E — pure tree-helper unit tests (depth, cycle, descendant
// resolution, path). Complements the real-DB action tests.

const N = (id: string, parentId: string | null, extra: Partial<CategoryTreeNode> = {}): CategoryTreeNode => ({
  id,
  name: id,
  transactionType: "INCOME",
  isActive: true,
  parentId,
  sortOrder: 0,
  ...extra,
});

// INCOME
//   premium (root)
//     motor
//       private   (leaf, depth 3)
//     nonmotor    (leaf, depth 2)
//   commission (root, leaf)
const nodes: CategoryTreeNode[] = [
  N("premium", null, { name: "Premium Income" }),
  N("motor", "premium", { name: "Motor Premium" }),
  N("private", "motor", { name: "Private Motor" }),
  N("nonmotor", "premium", { name: "Non-Motor Premium" }),
  N("commission", null, { name: "Commission Income" }),
];
const index = indexCategories(nodes);

describe("categoryDepth / ancestorPathIds", () => {
  it("root = 1, child = 2, grandchild = 3", () => {
    expect(categoryDepth("premium", index.byId)).toBe(1);
    expect(categoryDepth("motor", index.byId)).toBe(2);
    expect(categoryDepth("private", index.byId)).toBe(3);
  });
  it("ancestor path is root-first and inclusive of the node", () => {
    expect(ancestorPathIds("private", index.byId)).toEqual(["premium", "motor", "private"]);
  });
  it("does not loop forever on pre-existing cyclic data", () => {
    const bad = indexCategories([N("a", "b"), N("b", "a")]);
    expect(ancestorPathIds("a", bad.byId).length).toBeLessThanOrEqual(2);
  });
});

describe("prospectiveChildDepth — X.6 fourth-level rejection maths", () => {
  it("a child under a root would be depth 2; under a grandchild depth 4", () => {
    expect(prospectiveChildDepth(null, index.byId)).toBe(1);
    expect(prospectiveChildDepth("premium", index.byId)).toBe(2);
    expect(prospectiveChildDepth("motor", index.byId)).toBe(3);
    expect(prospectiveChildDepth("private", index.byId)).toBe(4);
    expect(prospectiveChildDepth("private", index.byId)).toBeGreaterThan(MAX_LEDGER_CATEGORY_DEPTH);
  });
});

describe("subtreeHeight", () => {
  it("leaf = 1, premium subtree = 3", () => {
    expect(subtreeHeight("private", index.childrenByParent)).toBe(1);
    expect(subtreeHeight("motor", index.childrenByParent)).toBe(2);
    expect(subtreeHeight("premium", index.childrenByParent)).toBe(3);
  });
});

describe("descendant resolution — X.22 / X.23", () => {
  it("a parent resolves to itself + every descendant", () => {
    expect(new Set(categoryAndDescendantIds("premium", index))).toEqual(
      new Set(["premium", "motor", "private", "nonmotor"])
    );
  });
  it("a leaf resolves to just itself — unrelated siblings excluded", () => {
    expect(categoryAndDescendantIds("private", index)).toEqual(["private"]);
    expect(collectDescendantIds("nonmotor", index.childrenByParent)).toEqual([]);
  });
});

describe("wouldCreateCycle — X.9 / X.10", () => {
  it("rejects self-parenting", () => {
    expect(wouldCreateCycle("motor", "motor", index)).toBe(true);
  });
  it("rejects making a descendant the new parent", () => {
    expect(wouldCreateCycle("premium", "private", index)).toBe(true);
    expect(wouldCreateCycle("motor", "private", index)).toBe(true);
  });
  it("allows a legitimate move", () => {
    expect(wouldCreateCycle("nonmotor", "motor", index)).toBe(false);
    expect(wouldCreateCycle("motor", null, index)).toBe(false);
  });
});

describe("isLeafCategory / categoryPath", () => {
  it("leaf detection", () => {
    expect(isLeafCategory("private", index.childrenByParent)).toBe(true);
    expect(isLeafCategory("premium", index.childrenByParent)).toBe(false);
  });
  it("path is breadcrumb, transactionType-free", () => {
    expect(categoryPath("private", index.byId)).toBe("Premium Income › Motor Premium › Private Motor");
    expect(categoryPath("commission", index.byId)).toBe("Commission Income");
  });
});
