import { prisma } from "@/lib/prisma";
import { hasPermission, isAdmin, type AuthzUser } from "@/lib/permissions";
import type { PolicyCategory } from "@/generated/prisma/enums";
import type { DateRange } from "@/lib/reminders/datetime";
import { sumClientPremiumOutstanding, sumInsurerPaymentOutstanding } from "./statCards";
import type { FinancialSummary, ManualLedgerSummary } from "./types";

// Part 13 — every figure sourced from the same authoritative tables the
// Policy/Ledger pages themselves read (PolicyRecord.customerPremium/
// insurerCost, PolicyCustomerReceipt, PolicyProviderPayment,
// PolicyRecord.commission*), never a second parallel definition. "Due"
// figures are scoped by `processingDate` (the same field every Policy list
// already sorts/groups by); "Received"/"Made" figures are scoped by the
// actual receipt/payment date so they reflect real cash movement in the
// period, independent of which month the underlying policy was processed.
export async function buildFinancialSummary(
  user: AuthzUser & { id: string },
  policyCategories: PolicyCategory[],
  currency: string,
  monthRange: DateRange
): Promise<FinancialSummary | null> {
  if (policyCategories.length === 0) return null;
  const admin = isAdmin(user);
  const hasSystemLedger = admin || hasPermission(user, "ledger.system_record");

  const dueWhere = {
    category: { in: policyCategories },
    deletedAt: null,
    businessStatus: { notIn: ["CANCELLED", "RENEWED"] as ("CANCELLED" | "RENEWED")[] },
    processingDate: { gte: monthRange.gte, lt: monthRange.lt },
  };

  const [dueAgg, receivedAgg, outstanding] = await Promise.all([
    prisma.policyRecord.aggregate({ where: dueWhere, _sum: { customerPremium: true, insurerCost: true } }),
    prisma.policyCustomerReceipt.aggregate({
      where: {
        deletedAt: null,
        receiptDate: { gte: monthRange.gte, lt: monthRange.lt },
        policyRecord: { category: { in: policyCategories } },
      },
      _sum: { amount: true },
    }),
    sumClientPremiumOutstanding(policyCategories),
  ]);

  const clientPremiumDue = dueAgg._sum?.customerPremium?.toNumber() ?? 0;
  const clientPremiumReceived = receivedAgg._sum.amount?.toNumber() ?? 0;

  let insurerCostDue: number | null = null;
  let insurerPaymentsMade: number | null = null;
  let insurerPaymentOutstanding: number | null = null;
  let commissionReceived: number | null = null;

  if (hasSystemLedger) {
    const [paidAgg, commissionAgg, insurerOutstanding] = await Promise.all([
      prisma.policyProviderPayment.aggregate({
        where: {
          deletedAt: null,
          paymentDate: { gte: monthRange.gte, lt: monthRange.lt },
          policyRecord: { category: { in: policyCategories } },
        },
        _sum: { amount: true },
      }),
      prisma.policyRecord.aggregate({
        where: {
          category: { in: policyCategories },
          deletedAt: null,
          commissionReceived: true,
          commissionAmount: { not: null },
          commissionReceivedDate: { gte: monthRange.gte, lt: monthRange.lt },
        },
        _sum: { commissionAmount: true },
      }),
      sumInsurerPaymentOutstanding(policyCategories),
    ]);
    insurerCostDue = dueAgg._sum?.insurerCost?.toNumber() ?? 0;
    insurerPaymentsMade = paidAgg._sum.amount?.toNumber() ?? 0;
    commissionReceived = commissionAgg._sum.commissionAmount?.toNumber() ?? 0;
    insurerPaymentOutstanding = insurerOutstanding;
  }

  return {
    currency,
    clientPremiumDue,
    clientPremiumReceived,
    clientPremiumOutstanding: outstanding,
    insurerCostDue,
    insurerPaymentsMade,
    insurerPaymentOutstanding,
    commissionReceived,
  };
}

// Part 14 — manual (user-created) Ledger records only, never the
// system-computed records (LedgerManualEntry is a genuinely separate model
// from the Policy-derived system-record projection — see
// src/lib/ledger/systemRecords.ts's doc comment on why the two are never
// mixed).
export async function buildManualLedgerSummary(
  user: AuthzUser & { id: string },
  currency: string,
  monthRange: DateRange
): Promise<ManualLedgerSummary | null> {
  if (!isAdmin(user) && !hasPermission(user, "ledger.manual_record")) return null;

  const rows = await prisma.ledgerManualEntry.groupBy({
    by: ["transactionType"],
    where: { cancelledAt: null, transactionDate: { gte: monthRange.gte, lt: monthRange.lt } },
    _sum: { amount: true },
  });

  const income = rows.find((r) => r.transactionType === "INCOME")?._sum.amount?.toNumber() ?? 0;
  const expense = rows.find((r) => r.transactionType === "EXPENSE")?._sum.amount?.toNumber() ?? 0;

  return { currency, income, expense, net: income - expense };
}
