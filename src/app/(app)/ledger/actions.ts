"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit } from "@/lib/permissions";
import { toDecimal, toFiniteAmount } from "@/lib/money";
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

// ============================================================================
// Categories — user-created only, never seeded/hard-coded (see
// LedgerCategory's schema comment). transactionType is fixed for the life of
// a category: no action here ever accepts a transactionType change on an
// existing category. This sidesteps needing to "safely validate" whether a
// category already has entries under its old type (this phase's spec
// explicitly allows either approach) — simplest and safest is to never offer
// the change at all; if a category was created under the wrong type, create
// a new one and deactivate the old one instead.
// ============================================================================

export type CreateLedgerCategoryInput = {
  name: string;
  transactionType: string;
};

export async function createLedgerCategoryAction(
  input: CreateLedgerCategoryInput
): Promise<ActionResult<{ id: string; name: string; transactionType: LedgerTransactionType }>> {
  const session = await requireLedgerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const name = input.name?.trim();
  if (!name) return { success: false, error: "CATEGORY_NAME_REQUIRED" };
  if (!isValidTransactionType(input.transactionType)) return { success: false, error: "TYPE_REQUIRED" };

  const existing = await prisma.ledgerCategory.findUnique({
    where: { name_transactionType: { name, transactionType: input.transactionType } },
  });
  if (existing) return { success: false, error: "CATEGORY_DUPLICATE" };

  try {
    const category = await prisma.ledgerCategory.create({
      data: { name, transactionType: input.transactionType, createdById: session.user.id },
    });
    revalidatePath("/ledger/manual");
    return { success: true, id: category.id, name: category.name, transactionType: category.transactionType };
  } catch (err) {
    console.error("Failed to create Ledger category:", err);
    return { success: false, error: "CATEGORY_DUPLICATE" };
  }
}

export type UpdateLedgerCategoryInput = {
  name?: string;
  isActive?: boolean;
};

export async function updateLedgerCategoryAction(id: string, input: UpdateLedgerCategoryInput): Promise<ActionResult> {
  const session = await requireLedgerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const category = await prisma.ledgerCategory.findUnique({ where: { id } });
  if (!category) return { success: false, error: "CATEGORY_NOT_FOUND" };

  const data: { name?: string; isActive?: boolean } = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { success: false, error: "CATEGORY_NAME_REQUIRED" };
    if (name !== category.name) {
      const conflict = await prisma.ledgerCategory.findUnique({
        where: { name_transactionType: { name, transactionType: category.transactionType } },
      });
      if (conflict && conflict.id !== id) return { success: false, error: "CATEGORY_DUPLICATE" };
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

// ============================================================================
// Manual Entries
// ============================================================================

export type ManualEntryInput = {
  transactionDate: string;
  transactionType: string;
  categoryId: string;
  amount: number | string;
  paymentMethod?: string | null;
  referenceNumber?: string | null;
  description?: string | null;
};

type CategoryCheckResult = { error: string } | { ok: true };

async function validateCategoryForEntry(
  categoryId: string,
  transactionType: LedgerTransactionType,
  currentCategoryId?: string
): Promise<CategoryCheckResult> {
  if (!categoryId) return { error: "CATEGORY_REQUIRED" };
  const category = await prisma.ledgerCategory.findUnique({ where: { id: categoryId } });
  if (!category) return { error: "CATEGORY_NOT_FOUND" };
  if (category.transactionType !== transactionType) return { error: "CATEGORY_TYPE_MISMATCH" };
  // Inactive categories are never offered for a NEW selection, but editing
  // an entry that already carries one (unchanged) is still allowed — see
  // this phase's spec ("Inactive categories remain visible on historical
  // records but are not offered for new entries").
  if (!category.isActive && categoryId !== currentCategoryId) return { error: "CATEGORY_INACTIVE" };
  return { ok: true };
}

export async function createManualEntryAction(
  input: ManualEntryInput
): Promise<ActionResult<{ id: string }>> {
  const session = await requireLedgerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  if (!input.transactionDate) return { success: false, error: "DATE_REQUIRED" };
  if (!isValidTransactionType(input.transactionType)) return { success: false, error: "TYPE_REQUIRED" };

  const categoryCheck = await validateCategoryForEntry(input.categoryId, input.transactionType);
  if ("error" in categoryCheck) return { success: false, error: categoryCheck.error };

  const amount = toFiniteAmount(input.amount);
  if (amount === null || amount <= 0) {
    return { success: false, error: "AMOUNT_INVALID" };
  }

  try {
    const entry = await prisma.ledgerManualEntry.create({
      data: {
        transactionDate: new Date(input.transactionDate),
        transactionType: input.transactionType,
        categoryId: input.categoryId,
        amount: toDecimal(amount),
        paymentMethod: input.paymentMethod?.trim() || null,
        referenceNumber: input.referenceNumber?.trim() || null,
        description: input.description?.trim() || null,
        createdById: session.user.id,
      },
    });
    revalidatePath("/ledger/manual");
    return { success: true, id: entry.id };
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

  try {
    await prisma.ledgerManualEntry.update({
      where: { id },
      data: {
        transactionDate: new Date(input.transactionDate),
        transactionType: input.transactionType,
        categoryId: input.categoryId,
        amount: toDecimal(amount),
        paymentMethod: input.paymentMethod?.trim() || null,
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

// Idempotent by construction (same pattern as cancelInvoiceAction): the
// status transition is the WHERE clause of the update itself, so a
// retry/double-click affects 0 rows rather than double-cancelling.
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
