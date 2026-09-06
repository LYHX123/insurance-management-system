// Phase 12E — turns raw LedgerCategory rows into the display-ready option
// list (path / depth / leaf / effective-inactive) shared by the Manual
// Ledger page, the entry modal, the filters and the Excel export. One place
// builds these facts so no component re-walks the tree.

import {
  indexCategories,
  categoryDepth,
  categoryPath,
  isLeafCategory,
  ancestorPathIds,
  compareSiblings,
  CATEGORY_PATH_SEPARATOR,
  type CategoryTreeNode,
} from "@/lib/ledger/categoryTree";
import type { LedgerCategoryOption, LedgerTransactionType } from "@/components/ledger/types";

export function buildCategoryOptions(rows: CategoryTreeNode[]): LedgerCategoryOption[] {
  const index = indexCategories(rows);

  const anyInactiveAncestor = (id: string): boolean =>
    ancestorPathIds(id, index.byId).some((nid) => index.byId.get(nid)?.isActive === false);

  // Emit in tree order (each parent immediately followed by its subtree) so
  // an indented render just walks the array.
  const ordered: CategoryTreeNode[] = [];
  const visit = (parentId: string | null) => {
    for (const node of index.childrenByParent.get(parentId) ?? []) {
      ordered.push(node);
      visit(node.id);
    }
  };
  visit(null);

  return ordered.map((node) => ({
    id: node.id,
    name: node.name,
    transactionType: node.transactionType,
    isActive: node.isActive,
    parentId: node.parentId,
    sortOrder: node.sortOrder,
    depth: categoryDepth(node.id, index.byId),
    path: categoryPath(node.id, index.byId),
    isLeaf: isLeafCategory(node.id, index.childrenByParent),
    effectivelyInactive: anyInactiveAncestor(node.id),
  }));
}

export { compareSiblings, CATEGORY_PATH_SEPARATOR };

// One figure-space per hierarchy level — plain spaces collapse inside an
// <option>, figure-spaces do not.
const INDENT_UNIT = "   ";

export type CategorySelectItem = {
  id: string;
  label: string;
  selectable: boolean;
};

// The <option> list for the Manual Entry category picker, already tree-
// ordered. Only ACTIVE LEAVES whose whole ancestor chain is active are
// selectable. On EDIT, the entry's current category is always kept
// selectable (even if it has since gained children or been deactivated) so
// the historical row stays editable — `keepSelectableId`.
export function categorySelectItems(
  options: LedgerCategoryOption[],
  transactionType: LedgerTransactionType,
  keepSelectableId?: string | null
): CategorySelectItem[] {
  return options
    .filter((o) => o.transactionType === transactionType)
    .map((o) => ({
      id: o.id,
      label: `${INDENT_UNIT.repeat(Math.max(0, o.depth - 1))}${o.name}`,
      selectable: o.id === keepSelectableId || (o.isLeaf && o.isActive && !o.effectivelyInactive),
    }));
}

// The ids a "filter by this category" selection resolves to: the category
// itself plus every descendant.
export function descendantFilterIds(options: LedgerCategoryOption[], selectedId: string): string[] {
  const childrenByParent = new Map<string | null, string[]>();
  for (const o of options) {
    const list = childrenByParent.get(o.parentId) ?? [];
    list.push(o.id);
    childrenByParent.set(o.parentId, list);
  }
  const out = [selectedId];
  const stack = [selectedId];
  const seen = new Set(out);
  while (stack.length) {
    const id = stack.pop()!;
    for (const childId of childrenByParent.get(id) ?? []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      out.push(childId);
      stack.push(childId);
    }
  }
  return out;
}
