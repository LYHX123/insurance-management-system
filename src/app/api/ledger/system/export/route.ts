import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getSystemLedgerRecords, type SystemLedgerRecord } from "@/lib/ledger/systemRecords";

const MONEY_FORMAT = '_ * #,##0.00_ ;_ * -#,##0.00_ ;_ * "-"??_ ;_ @_ ';

const TYPE_LABEL: Record<SystemLedgerRecord["sourceType"], string> = {
  CUSTOMER_PREMIUM_RECEIPT: "Customer Premium Receipt",
  PROVIDER_PAYMENT: "Provider Payment",
  COMMISSION_INCOME: "Commission Income",
};

const POLICY_CATEGORY_LABEL: Record<SystemLedgerRecord["policyCategory"], string> = {
  MOTOR: "Motor",
  NON_MOTOR: "Non-Motor",
  BOND: "Bond",
  WORK_PERMIT: "Work Permit",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function rowTypeLabel(r: SystemLedgerRecord): string {
  if (r.sourceType === "PROVIDER_PAYMENT" && r.policyCategory === "WORK_PERMIT") return "Agent Payment";
  return TYPE_LABEL[r.sourceType];
}

// Authenticated export of currently-filtered System Records only. Reuses
// getSystemLedgerRecords() — the exact same normalized projection the
// System Records page renders from — so the export can never drift from
// what is shown on screen (see this phase's spec: "Do not rebuild
// transaction mapping separately"). Filter semantics mirror
// SystemLedgerTable's client-side `filtered` useMemo exactly. Generated
// entirely in memory (ExcelJS buffer); nothing is ever written to disk.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "ledger.system_record")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const search = params.get("search")?.trim().toLowerCase() ?? "";
  const sourceType = params.get("sourceType");
  const direction = params.get("direction");
  const customer = params.get("customer");
  const policyCategory = params.get("policyCategory");
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");

  const allRecords = await getSystemLedgerRecords();

  const filtered = allRecords.filter((r) => {
    const matchesTerm =
      !search ||
      r.customerName.toLowerCase().includes(search) ||
      r.policyRecordNumber.toLowerCase().includes(search) ||
      (r.counterparty?.toLowerCase().includes(search) ?? false) ||
      (r.referenceNumber?.toLowerCase().includes(search) ?? false) ||
      (r.paymentMethod?.toLowerCase().includes(search) ?? false) ||
      (r.description?.toLowerCase().includes(search) ?? false);
    const matchesSourceType = !sourceType || sourceType === "ALL" || r.sourceType === sourceType;
    const matchesDirection = !direction || direction === "ALL" || r.direction === direction;
    const matchesCustomer = !customer || customer === "ALL" || r.customerName === customer;
    const matchesPolicyCategory = !policyCategory || policyCategory === "ALL" || r.policyCategory === policyCategory;
    const dateOnly = r.transactionDate.slice(0, 10);
    const matchesFrom = !dateFrom || dateOnly >= dateFrom;
    const matchesTo = !dateTo || dateOnly <= dateTo;
    return matchesTerm && matchesSourceType && matchesDirection && matchesCustomer && matchesPolicyCategory && matchesFrom && matchesTo;
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("System Ledger");

  sheet.columns = [
    { header: "Date", key: "date", width: 14 },
    { header: "Type", key: "type", width: 22 },
    { header: "Direction", key: "direction", width: 12 },
    { header: "Customer", key: "customer", width: 28 },
    { header: "Policy Record", key: "policyRecord", width: 18 },
    { header: "Policy Category", key: "policyCategory", width: 16 },
    { header: "Counterparty", key: "counterparty", width: 24 },
    { header: "Description", key: "description", width: 28 },
    { header: "Payment Method", key: "paymentMethod", width: 18 },
    { header: "Reference Number", key: "referenceNumber", width: 20 },
    { header: "Amount (KES)", key: "amount", width: 16 },
    { header: "Source Created By", key: "createdBy", width: 20 },
    { header: "Source Created At", key: "createdAt", width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };

  let customerPremiumReceived = 0;
  let providerAgentPayments = 0;
  let commissionIncome = 0;

  for (const r of filtered) {
    const amount = Number(r.amount);
    if (r.sourceType === "CUSTOMER_PREMIUM_RECEIPT") customerPremiumReceived += amount;
    else if (r.sourceType === "PROVIDER_PAYMENT") providerAgentPayments += amount;
    else commissionIncome += amount;

    const row = sheet.addRow({
      date: r.transactionDate.slice(0, 10),
      type: rowTypeLabel(r),
      direction: r.direction === "INCOME" ? "Income" : "Expense",
      customer: r.customerName,
      policyRecord: r.policyRecordNumber,
      policyCategory: POLICY_CATEGORY_LABEL[r.policyCategory],
      counterparty: r.counterparty ?? "",
      description: r.description ?? "",
      paymentMethod: r.paymentMethod ?? "",
      referenceNumber: r.referenceNumber ?? "",
      amount,
      createdBy: r.createdByName,
      createdAt: r.createdAt.slice(0, 10),
    });
    row.getCell("amount").numFmt = MONEY_FORMAT;
  }

  // Actual cash records only: System Net Cash Flow = Customer Premium
  // Received + Commission Income - Provider/Agent Payments, matching the
  // page's own summary calculation exactly.
  const netCashFlow = customerPremiumReceived + commissionIncome - providerAgentPayments;

  sheet.addRow({});
  const receivedRow = sheet.addRow({ policyRecord: "Customer Premium Received", amount: customerPremiumReceived });
  const paymentsRow = sheet.addRow({ policyRecord: "Provider/Agent Payments", amount: providerAgentPayments });
  const commissionRow = sheet.addRow({ policyRecord: "Commission Income", amount: commissionIncome });
  const netRow = sheet.addRow({ policyRecord: "System Net Cash Flow", amount: netCashFlow });
  for (const row of [receivedRow, paymentsRow, commissionRow, netRow]) {
    row.font = { bold: true };
    row.getCell("amount").numFmt = MONEY_FORMAT;
  }

  const buffer = await workbook.xlsx.writeBuffer();

  const now = new Date();
  const filename = `system-ledger-${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}.xlsx`;

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
