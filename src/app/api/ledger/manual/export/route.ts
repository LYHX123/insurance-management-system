import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";

const MONEY_FORMAT = '_ * #,##0.00_ ;_ * -#,##0.00_ ;_ * "-"??_ ;_ @_ ';

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Authenticated export of currently-filtered, active Manual Records only —
// never System Records (see this phase's spec). Re-applies the exact same
// filter semantics as ManualLedgerTable's client-side filtering (search,
// type, category, createdBy, date range) against the full, unpaginated
// active-entry set, so the export always matches what "Export Excel" was
// clicked from, not just the current page. Generated entirely in memory
// (ExcelJS buffer) — nothing is ever written to disk, so there is no
// temporary file to clean up.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "ledger.manual_record")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const search = params.get("search")?.trim().toLowerCase() ?? "";
  const type = params.get("type");
  const categoryId = params.get("categoryId");
  const createdById = params.get("createdById");
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");

  const entries = await prisma.ledgerManualEntry.findMany({
    where: {
      cancelledAt: null,
      ...(type === "INCOME" || type === "EXPENSE" ? { transactionType: type } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(createdById ? { createdById } : {}),
    },
    include: { category: { select: { name: true } } },
    orderBy: { transactionDate: "desc" },
  });

  const userIds = [...new Set(entries.map((e) => e.createdById))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, username: true } })
    : [];
  const userNameById = new Map(users.map((u) => [u.id, u.fullName || u.username]));

  const filtered = entries.filter((e) => {
    const dateOnly = e.transactionDate.toISOString().slice(0, 10);
    if (dateFrom && dateOnly < dateFrom) return false;
    if (dateTo && dateOnly > dateTo) return false;
    if (!search) return true;
    const createdByName = (userNameById.get(e.createdById) ?? "").toLowerCase();
    return (
      e.category.name.toLowerCase().includes(search) ||
      (e.description?.toLowerCase().includes(search) ?? false) ||
      (e.referenceNumber?.toLowerCase().includes(search) ?? false) ||
      (e.paymentMethod?.toLowerCase().includes(search) ?? false) ||
      createdByName.includes(search)
    );
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Manual Ledger");

  sheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Type", key: "type", width: 12 },
    { header: "Category", key: "category", width: 22 },
    { header: "Description", key: "description", width: 32 },
    { header: "Payment Method", key: "paymentMethod", width: 18 },
    { header: "Reference Number", key: "referenceNumber", width: 20 },
    { header: "Amount (KES)", key: "amount", width: 16 },
    { header: "Created By", key: "createdBy", width: 20 },
    { header: "Created At", key: "createdAt", width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };

  let totalIncome = 0;
  let totalExpense = 0;

  for (const e of filtered) {
    const amount = e.amount.toNumber();
    if (e.transactionType === "INCOME") totalIncome += amount;
    else totalExpense += amount;

    const row = sheet.addRow({
      date: e.transactionDate.toISOString().slice(0, 10),
      type: e.transactionType === "INCOME" ? "Income" : "Expense",
      category: e.category.name,
      description: e.description ?? "",
      paymentMethod: e.paymentMethod ?? "",
      referenceNumber: e.referenceNumber ?? "",
      amount,
      createdBy: userNameById.get(e.createdById) ?? "—",
      createdAt: e.createdAt.toISOString().slice(0, 10),
    });
    row.getCell("amount").numFmt = MONEY_FORMAT;
  }

  // Summary block — two blank rows below the data, then Total
  // Income/Expense/Net, matching this phase's spec.
  sheet.addRow({});
  const incomeRow = sheet.addRow({ category: "Total Income", amount: totalIncome });
  const expenseRow = sheet.addRow({ category: "Total Expense", amount: totalExpense });
  const netRow = sheet.addRow({ category: "Net", amount: totalIncome - totalExpense });
  for (const row of [incomeRow, expenseRow, netRow]) {
    row.font = { bold: true };
    row.getCell("amount").numFmt = MONEY_FORMAT;
  }

  const buffer = await workbook.xlsx.writeBuffer();

  const now = new Date();
  const filename = `manual-ledger-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}.xlsx`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
