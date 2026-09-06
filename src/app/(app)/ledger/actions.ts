"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit } from "@/lib/permissions";
import { toDecimal, toFiniteAmount } from "@/lib/money";
import { claimIdempotencyKey, fulfillIdempotencyClaim } from "@/lib/idempotency/claim";
import { normalizeSubmittedPaymentMethod } from "@/lib/ledger/paymentMethods";
import {
  MAX_LEDGER_CATEGORY_DEPTH,
  indexCategories,
  prospectiveChildDepth,
  subtreeHeight,
  wouldCreateCycle,
  isLeafCategory,
  ancestorPathIds,
  type CategoryTreeNode,
} from "@/lib/ledger/categoryTree";
import type { LedgerTransactionType } from "@/generated/prisma/enums";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

async function requireLedgerPermission() {
  const session = await auth();
  if (!session?.user || !canEdit(session.user, "ledger.manual_record")) return null;
  return session;
}

function isValidTransactionType(value: unknown): value is LedgerTransactionType {
  return value === "INCOME" || value === "EXPENSE";
}

// Loads the whole category set once and returns the tree index used by the
// depth / cycle / leaf helpers. Small table (user-authored categories only),
// so a full read per mutation is fine.
async function loadCategoryIndex() {
  const rows = await prisma.ledgerCategory.findMany({
    select: { id: true, name: true, transactionType: true, isActive: true, parentId: true, sortOrder: true },
  });
  return indexCategories(rows as CategoryTreeNode[]);
}

// ============================================================================
// Categories — user-created only, never seeded/hard-coded (see
// LedgerCategory's schema comment).
//
// Phase 12E: categories now form a self-referencing tree (max depth 3). A
// child ALWAYS inherits its parent's transactionType (derived server-side,
// never taken from the client). transactionType still cannot be changed once
// a category exists — a mis-typed category is deactivated and replaced, not
// mutated. Sibling names must be unique within one parent; root names must be
// unique per transactionType (enforced by a partial unique index + the
// explicit check below, because Postgres treats NULL parentId as distinct).
// ============================================================================

export type CreateLedgerCategoryInput = {
  name: string;
  // Only consulted for a ROOT category. For a child the type is derived from
  // the parent and this field is ignored.
  transactionType?: string;
  parentId?: string | null;
};

export async function createLedgerCategoryAction(
  input: CreateLedgerCategoryInput
): Promise<ActionResult<{ id: string; name: string; transactionType: LedgerTransactionType; parentId: string | null; sortOrder: number }>> {
  const session = await requireLedgerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const name = input.name?.trim();
  if (!name) return { success: false, error: "CATEGORY_NAME_REQUIRED" };

  const parentId = input.parentId?.trim() || null;
  const index = await loadCategoryIndex();

  let transactionType: LedgerTransactionType;

  if (parentId) {
    const parent = index.byId.get(parentId);
    if (!parent) return { success: false, error: "PARENT_NOT_FOUND" };
    // Child inherits the parent's type — the client's value is never trusted.
    transactionType = parent.transactionType;
    // Depth: the new child would sit one level below its parent.
    if (prospectiveChildDepth(parentId, index.byId) > MAX_LEDGER_CATEGORY_DEPTH) {
      return { success: false, error: "MAX_DEPTH_REACHED" };
    }
  } else {
    if (!isValidTransactionType(input.transactionType)) return { success: false, error: "TYPE_REQUIRED" };
    transactionType = input.transactionType;
  }

  const duplicate = await prisma.ledgerCategory.findFirst({
    where: { parentId, name, transactionType },
    select: { id: true },
  });
  if (duplicate) return { success: false, error: "CATEGORY_DUPLICATE" };

  const siblings = index.childrenByParent.get(parentId) ?? [];
  const sortOrder = siblings.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;

  try {
    const category = await prisma.ledgerCategory.create({
      data: { name, transactionType, parentId, sortOrder, createdById: session.user.id },
    });
    revalidatePath("/ledger/manual");
    return {
      success: true,
      id: category.id,
      name: category.name,
      transactionType: category.transactionType,
      parentId: category.parentId,
      sortOrder: category.sortOrder,
    };
  } catch (err) {
    console.error("Failed to create Ledger category:", err);
    return { success: false, error: "CATEGORY_DUPLICATE" };
  }
}

export type UpdateLedgerCategoryInput = {
  name?: string;
  isActive?: boolean;
  // Re-parent (move) support. The Manage Categories UI does not expose this
  // yet, but the validation is built so a future "move" cannot create a
  // cycle, exceed the depth limit, or cross transactionType. Pass `null` to
  // promote a category to a root.
  parentId?: string | null;
};

export async function updateLedgerCategoryAction(id: string, input: UpdateLedgerCategoryInput): Promise<ActionResult> {
  const session = await requireLedgerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const index = await loadCategoryIndex();
  const category = index.byId.get(id);
  if (!category) return { success: false, error: "CATEGORY_NOT_FOUND" };

  const data: { name?: string; isActive?: boolean; parentId?: string | null } = {};

  // --- Move / re-parent (validated even though no UI calls it yet) ---
  let effectiveParentId = category.parentId;
  if (input.parentId !== undefined) {
    const newParentId = input.parentId?.trim() || null;
    if (newParentId !== category.parentId) {
      if (newParentId === id) return { success: false, error: "CATEGORY_SELF_PARENT" };
      if (wouldCreateCycle(id, newParentId, index)) return { success: false, error: "CATEGORY_CYCLE" };
      if (newParentId) {
        const newParent = index.byId.get(newParentId);
        if (!newParent) return { success: false, error: "PARENT_NOT_FOUND" };
        if (newParent.transactionType !== category.transactionType) {
          return { success: false, error: "CATEGORY_TYPE_MISMATCH" };
        }
        // depth(newParent) + (height of this subtree) must stay within the cap
        const newParentDepth = prospectiveChildDepth(newParentId, index.byId) - 1;
        if (newParentDepth + subtreeHeight(id, index.childrenByParent) > MAX_LEDGER_CATEGORY_DEPTH) {
          return { success: false, error: "MAX_DEPTH_REACHED" };
        }
      }
      data.parentId = newParentId;
      effectiveParentId = newParentId;
    }
  }

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { success: false, error: "CATEGORY_NAME_REQUIRED" };
    if (name !== category.name || data.parentId !== undefined) {
      const conflict = await prisma.ledgerCategory.findFirst({
        where: { parentId: effectiveParentId, name, transactionType: category.transactionType, id: { not: id } },
        select: { id: true },
      });
      if (conflict) return { success: false, error: "CATEGORY_DUPLICATE" };
      data.name = name;
    }
  }

  if (input.isActive !== undefined) data.isActive = input.isActive;

  if (Object.keys(data).length === 0) return { success: true };

  try {
    await prisma.ledgerCategory.update({ where: { id }, data });
    revalidatePath("/ledger/manual");
    return { success: true };
  } catch (err) {
    console.error("Failed to update Ledger category:", err);
    return { success: false, error: "CATEGORY_DUPLICATE" };
  }
}

// Swap a category with its previous / next sibling in display order. Used by
// the Up / Down controls in Manage Categories.
export async function reorderLedgerCategoryAction(id: string, direction: "UP" | "DOWN"): Promise<ActionResult> {
  const session = await requireLedgerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const index = await loadCategoryIndex();
  const category = index.byId.get(id);
  if (!category) return { success: false, error: "CATEGORY_NOT_FOUND" };

  // `siblings` is already in display order (sortOrder then name).
  const siblings = index.childrenByParent.get(category.parentId) ?? [];
  const pos = siblings.findIndex((s) => s.id === id);
  const targetPos = direction === "UP" ? pos - 1 : pos + 1;
  if (targetPos < 0 || targetPos >= siblings.length) return { success: true }; // already at the edge — no-op

  // Rebuild the whole sibling group's sortOrder from the new display order so
  // the values stay a clean 0..n-1 sequence even if they had ties before.
  const reordered = [...siblings];
  [reordered[pos], reordered[targetPos]] = [reordered[targetPos], reordered[pos]];
  await prisma.$transaction(
    reordered.map((s, i) => prisma.ledgerCategory.update({ where: { id: s.id }, data: { sortOrder: i } }))
  );
  revalidatePath("/ledger/manual");
  return { success: true };
}

// Hard delete — only when the category has zero children AND zero ledger
// entries (cancelled entries count: the row still references the category).
// onDelete: Restrict on both relations is the database backstop.
export async function deleteLedgerCategoryAction(id: string): Promise<ActionResult> {
  const session = await requireLedgerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const category = await prisma.ledgerCategory.findUnique({
    where: { id },
    select: { id: true, _count: { select: { children: true, manualEntries: true } } },
  });
  if (!category) return { success: false, error: "CATEGORY_NOT_FOUND" };
  if (category._count.children > 0) return { success: false, error: "CATEGORY_HAS_CHILDREN" };
  if (category._count.manualEntries > 0) return { success: false, error: "CATEGORY_IN_USE" };

  try {
    await prisma.ledgerCategory.delete({ where: { id } });
    revalidatePath("/ledger/manual");
    return { success: true };
  } catch (err) {
    console.error("Failed to delete Ledger category:", err);
    return { success: false, error: "CATEGORY_DELETE_FAILED" };
  }
}

// ============================================================================
// Manual Entries
// ============================================================================

export type ManualEntryInput = {
  transactionDate: string;
  transactionType: string;
  categoryId: string;
  amount: number | string;
  paymentMethod?: string | null;
  counterpartyName?: string | null;
  referenceNumber?: string | null;
  description?: string | null;
};

export type CreateManualEntryInput = ManualEntryInput & { idempotencyKey: string };

type CategoryCheckResult = { error: string } | { ok: true };

// Validates the chosen category for an entry. A NEW selection (or a change to
// a different category on edit) must be an ACTIVE LEAF of the right type. The
// entry's CURRENT category is always allowed to stay, even if it has since
// gained children or been deactivated — historical rows never break.
async function validateCategoryForEntry(
  categoryId: string,
  transactionType: LedgerTransactionType,
  currentCategoryId?: string
): Promise<CategoryCheckResult> {
  if (!categoryId) return { error: "CATEGORY_REQUIRED" };

  if (currentCategoryId && categoryId === currentCategoryId) {
    const current = await prisma.ledgerCategory.findUnique({ where: { id: categoryId }, select: { transactionType: true } });
    if (!current) return { error: "CATEGORY_NOT_FOUND" };
    if (current.transactionType !== transactionType) return { error: "CATEGORY_TYPE_MISMATCH" };
    return { ok: true };
  }

  const index = await loadCategoryIndex();
  const category = index.byId.get(categoryId);
  if (!category) return { error: "CATEGORY_NOT_FOUND" };
  if (category.transactionType !== transactionType) return { error: "CATEGORY_TYPE_MISMATCH" };
  // Rejected if the category itself OR any ancestor is inactive — an
  // inactive parent hides its whole subtree from new entries.
  const inactiveInChain = ancestorPathIds(categoryId, index.byId).some((id) => index.byId.get(id)?.isActive === false);
  if (inactiveInChain) return { error: "CATEGORY_INACTIVE" };
  if (!isLeafCategory(categoryId, index.childrenByParent)) return { error: "CATEGORY_NOT_LEAF" };
  return { ok: true };
}

function cleanCounterparty(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

export async function createManualEntryAction(
  input: CreateManualEntryInput
): Promise<ActionResult<{ id: string }>> {
  const session = await requireLedgerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  if (!input.transactionDate) return { success: false, error: "DATE_REQUIRED" };
  if (!isValidTransactionType(input.transactionType)) return { success: false, error: "TYPE_REQUIRED" };
  const transactionType = input.transactionType;

  const categoryCheck = await validateCategoryForEntry(input.categoryId, transactionType);
  if ("error" in categoryCheck) return { success: false, error: categoryCheck.error };

  const amount = toFiniteAmount(input.amount);
  if (amount === null || amount <= 0) {
    return { success: false, error: "AMOUNT_INVALID" };
  }

  // A new entry may only carry one of the four standard payment methods (or
  // blank). Never trust the client dropdown alone.
  const paymentMethod = normalizeSubmittedPaymentMethod(input.paymentMethod);
  if (paymentMethod === undefined) return { success: false, error: "PAYMENT_METHOD_INVALID" };

  if (!input.idempotencyKey?.trim()) return { success: false, error: "IDEMPOTENCY_KEY_REQUIRED" };

  try {
    const created = await prisma.$transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, "ledger.manualEntry", input.idempotencyKey);
      if (claim.kind === "replay") return { id: claim.resourceId };

      const entry = await tx.ledgerManualEntry.create({
        data: {
          transactionDate: new Date(input.transactionDate),
          transactionType,
          categoryId: input.categoryId,
          amount: toDecimal(amount),
          paymentMethod,
          counterpartyName: cleanCounterparty(input.counterpartyName),
          referenceNumber: input.referenceNumber?.trim() || null,
          description: input.description?.trim() || null,
          createdById: session.user.id,
        },
      });
      await fulfillIdempotencyClaim(tx, input.idempotencyKey, entry.id);
      return entry;
    });
    revalidatePath("/ledger/manual");
    return { success: true, id: created.id };
  } catch (err) {
    console.error("Failed to create Manual Ledger entry:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

export async function updateManualEntryAction(id: string, input: ManualEntryInput): Promise<ActionResult> {
  const session = await requireLedgerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const existing = await prisma.ledgerManualEntry.findUnique({ where: { id } });
  if (!existing || existing.cancelledAt) return { success: false, error: "ENTRY_NOT_FOUND" };

  if (!input.transactionDate) return { success: false, error: "DATE_REQUIRED" };
  if (!isValidTransactionType(input.transactionType)) return { success: false, error: "TYPE_REQUIRED" };

  const categoryCheck = await validateCategoryForEntry(input.categoryId, input.transactionType, existing.categoryId);
  if ("error" in categoryCheck) return { success: false, error: categoryCheck.error };

  const amount = toFiniteAmount(input.amount);
  if (amount === null || amount <= 0) {
    return { success: false, error: "AMOUNT_INVALID" };
  }

  // Payment method: an unchanged value (including a legacy one) is kept as
  // stored — opening and saving an entry never rewrites its legacy payment
  // method. A CHANGED value must be one of the four standard tokens (or
  // blank).
  const submitted = (input.paymentMethod ?? "").trim() || null;
  let paymentMethod: string | null;
  if (submitted === (existing.paymentMethod ?? null)) {
    paymentMethod = existing.paymentMethod;
  } else {
    const normalized = normalizeSubmittedPaymentMethod(submitted);
    if (normalized === undefined) return { success: false, error: "PAYMENT_METHOD_INVALID" };
    paymentMethod = normalized;
  }

  try {
    await prisma.ledgerManualEntry.update({
      where: { id },
      data: {
        transactionDate: new Date(input.transactionDate),
        transactionType: input.transactionType,
        categoryId: input.categoryId,
        amount: toDecimal(amount),
        paymentMethod,
        counterpartyName: cleanCounterparty(input.counterpartyName),
        referenceNumber: input.referenceNumber?.trim() || null,
        description: input.description?.trim() || null,
        updatedById: session.user.id,
      },
    });
    revalidatePath("/ledger/manual");
    return { success: true };
  } catch (err) {
    console.error("Failed to update Manual Ledger entry:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

export async function cancelManualEntryAction(id: string): Promise<ActionResult> {
  const session = await requireLedgerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const result = await prisma.ledgerManualEntry.updateMany({
    where: { id, cancelledAt: null },
    data: { cancelledAt: new Date(), cancelledById: session.user.id },
  });
  if (result.count === 0) return { success: false, error: "ALREADY_CANCELLED" };

  revalidatePath("/ledger/manual");
  return { success: true };
}
