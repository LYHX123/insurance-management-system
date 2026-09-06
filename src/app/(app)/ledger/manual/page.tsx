import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit, hasPermission } from "@/lib/permissions";
import { buildCategoryOptions } from "@/lib/ledger/categoryView";
import { ManualLedgerTable } from "@/components/ledger/manual-ledger-table";
import type { ManualEntryRow } from "@/components/ledger/types";

export default async function LedgerManualPage() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "ledger.manual_record")) {
    redirect("/access-denied");
  }

  const [categories, entries] = await Promise.all([
    prisma.ledgerCategory.findMany({
      select: { id: true, name: true, transactionType: true, isActive: true, parentId: true, sortOrder: true },
    }),
    // Only active (non-cancelled) entries — a cancelled entry is hidden by
    // default and excluded from totals but remains in the database untouched
    // for audit purposes.
    prisma.ledgerManualEntry.findMany({
      where: { cancelledAt: null },
      include: { category: { select: { name: true, isActive: true } } },
      orderBy: { transactionDate: "desc" },
    }),
  ]);

  const createdByIds = [...new Set(entries.map((e) => e.createdById))];
  const users = createdByIds.length
    ? await prisma.user.findMany({ where: { id: { in: createdByIds } }, select: { id: true, fullName: true, username: true } })
    : [];
  const userNameById = new Map(users.map((u) => [u.id, u.fullName || u.username]));

  const categoryOptions = buildCategoryOptions(categories);
  const pathById = new Map(categoryOptions.map((c) => [c.id, c.path]));

  const rows: ManualEntryRow[] = entries.map((e) => ({
    id: e.id,
    transactionDate: e.transactionDate.toISOString(),
    transactionType: e.transactionType,
    categoryId: e.categoryId,
    categoryName: e.category.name,
    categoryPath: pathById.get(e.categoryId) ?? e.category.name,
    categoryIsActive: e.category.isActive,
    amount: e.amount.toString(),
    paymentMethod: e.paymentMethod,
    counterpartyName: e.counterpartyName,
    referenceNumber: e.referenceNumber,
    description: e.description,
    createdById: e.createdById,
    createdByName: userNameById.get(e.createdById) ?? "—",
    createdAt: e.createdAt.toISOString(),
  }));

  return <ManualLedgerTable records={rows} categories={categoryOptions} canEdit={canEdit(session.user, "ledger.manual_record")} />;
}
