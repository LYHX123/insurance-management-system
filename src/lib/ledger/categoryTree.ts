// Phase 12E — pure helpers for the Manual Ledger category hierarchy.
//
// The tree is a self-reference on LedgerCategory (parentId). Roots have
// parentId === null and live at depth 1; the maximum allowed depth is 3.
// Depth, cycle and transactionType-inheritance rules are ALL enforced here
// / in the server actions — never with a database CHECK constraint.

export const MAX_LEDGER_CATEGORY_DEPTH = 3;

export const CATEGORY_PATH_SEPARATOR = " › ";

export type LedgerCategoryTransactionType = "INCOME" | "EXPENSE";

export type CategoryTreeNode = {
  id: string;
  name: string;
  transactionType: LedgerCategoryTransactionType;
  isActive: boolean;
  parentId: string | null;
  sortOrder: number;
};

export type CategoryIndex = {
  byId: Map<string, CategoryTreeNode>;
  childrenByParent: Map<string | null, CategoryTreeNode[]>;
};

// Builds the lookup maps once. `childrenByParent` lists are ordered by
// sortOrder then name (case-insensitive), the same order the UI shows.
export function indexCategories(nodes: CategoryTreeNode[]): CategoryIndex {
  const byId = new Map<string, CategoryTreeNode>();
  const childrenByParent = new Map<string | null, CategoryTreeNode[]>();
  for (const n of nodes) byId.set(n.id, n);
  for (const n of nodes) {
    const key = n.parentId ?? null;
    const list = childrenByParent.get(key) ?? [];
    list.push(n);
    childrenByParent.set(key, list);
  }
  for (const list of childrenByParent.values()) list.sort(compareSiblings);
  return { byId, childrenByParent };
}

export function compareSiblings(a: CategoryTreeNode, b: CategoryTreeNode): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

// Walks the ancestor chain from `id` to its root, returning the node ids
// root-first. Stops safely if the data already contains a cycle (never
// loops forever). The returned array always starts with a root and ends
// with `id`.
export function ancestorPathIds(id: string, byId: Map<string, CategoryTreeNode>): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let current: string | null = id;
  while (current && !seen.has(current)) {
    seen.add(current);
    path.push(current);
    const node: CategoryTreeNode | undefined = byId.get(current);
    current = node?.parentId ?? null;
  }
  return path.reverse();
}

// 1 for a root, 2 for its child, 3 for a grandchild. Returns 0 if `id` is
// unknown.
export function categoryDepth(id: string, byId: Map<string, CategoryTreeNode>): number {
  if (!byId.has(id)) return 0;
  return ancestorPathIds(id, byId).length;
}

// The depth a NEW category placed under `parentId` would occupy. A null
// parent => a root => depth 1.
export function prospectiveChildDepth(parentId: string | null, byId: Map<string, CategoryTreeNode>): number {
  if (!parentId) return 1;
  const parentDepth = categoryDepth(parentId, byId);
  return parentDepth === 0 ? 0 : parentDepth + 1;
}

// Height of the subtree rooted at `id`: a leaf is 1, a node with children
// is 1 + tallest child.
export function subtreeHeight(id: string, childrenByParent: Map<string | null, CategoryTreeNode[]>): number {
  const children = childrenByParent.get(id) ?? [];
  if (children.length === 0) return 1;
  let tallest = 0;
  for (const c of children) tallest = Math.max(tallest, subtreeHeight(c.id, childrenByParent));
  return 1 + tallest;
}

// Every descendant id of `id` (children, grandchildren, …) — not including
// `id` itself. Cycle-safe.
export function collectDescendantIds(id: string, childrenByParent: Map<string | null, CategoryTreeNode[]>): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const stack = [...(childrenByParent.get(id) ?? [])];
  while (stack.length) {
    const node = stack.pop()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node.id);
    stack.push(...(childrenByParent.get(node.id) ?? []));
  }
  return out;
}

// `id` + all its descendants — the id set a hierarchical "filter by this
// category" resolves to.
export function categoryAndDescendantIds(id: string, index: CategoryIndex): string[] {
  return [id, ...collectDescendantIds(id, index.childrenByParent)];
}

// True when re-parenting node `id` under `newParentId` would create a
// cycle: the new parent is the node itself, or one of its own descendants.
export function wouldCreateCycle(id: string, newParentId: string | null, index: CategoryIndex): boolean {
  if (!newParentId) return false;
  if (newParentId === id) return true;
  return collectDescendantIds(id, index.childrenByParent).includes(newParentId);
}

export function isLeafCategory(id: string, childrenByParent: Map<string | null, CategoryTreeNode[]>): boolean {
  return (childrenByParent.get(id) ?? []).length === 0;
}

// Names from the shallowest ancestor to `id` (e.g. ["Premium Income",
// "Motor Premium"]).
export function categoryPathNames(id: string, byId: Map<string, CategoryTreeNode>): string[] {
  return ancestorPathIds(id, byId)
    .map((nid) => byId.get(nid)?.name)
    .filter((n): n is string => typeof n === "string");
}

// "Premium Income › Motor Premium". transactionType is intentionally not
// part of the path — the row/column already shows Income/Expense.
export function formatCategoryPath(names: string[]): string {
  return names.join(CATEGORY_PATH_SEPARATOR);
}

export function categoryPath(id: string, byId: Map<string, CategoryTreeNode>): string {
  return formatCategoryPath(categoryPathNames(id, byId));
}
