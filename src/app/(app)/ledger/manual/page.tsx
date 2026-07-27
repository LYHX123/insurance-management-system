import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { ManualLedgerTable } from "@/components/ledger/manual-ledger-table";
import type { ManualEntryRow, LedgerCategoryOption } from "@/components/ledger/types";

export default async function LedgerManualPage() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "ledger.manual_record")) {
    redirect("/access-denied");
  }

  const [categories, entries] = await Promise.all([
    prisma.ledgerCategory.findMany({ orderBy: [{ transactionType: "asc" }, { name: "asc" }] }),
    // Only active (non-cancelled) entries — a cancelled entry is hidden by
    // default and excluded from totals (see this phase's spec) but remains
    // in the database untouched for audit purposes.
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

  const categoryOptions: LedgerCategoryOption[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    transactionType: c.transactionType,
    isActive: c.isActive,
  }));

  const rows: ManualEntryRow[] = entries.map((e) => ({
    id: e.id,
    transactionDate: e.transactionDate.toISOString(),
    transactionType: e.transactionType,
    categoryId: e.categoryId,
    categoryName: e.category.name,
    categoryIsActive: e.category.isActive,
    amount: e.amount.toString(),
    paymentMethod: e.paymentMethod,
    referenceNumber: e.referenceNumber,
    description: e.description,
    createdById: e.createdById,
    createdByName: userNameById.get(e.createdById) ?? "—",
    createdAt: e.createdAt.toISOString(),
  }));

  return <ManualLedgerTable records={rows} categories={categoryOptions} />;
}
