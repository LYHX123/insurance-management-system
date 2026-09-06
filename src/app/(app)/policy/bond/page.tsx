import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit, hasPermission } from "@/lib/permissions";
import { toBondListRow } from "@/lib/policy/policyListView";
import { BondListTable } from "@/components/policy/bond/bond-list-table";
import type { BondListRow } from "@/components/policy/types";

export default async function BondPolicyListPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "policy.bond")) {
    redirect("/access-denied");
  }

  // Phase 8.1 Part 4 — the "View All Bond Policies" entry point from Customer
  // Detail's Related Records tab filters at the database level, never just
  // in the browser: customerId here narrows the actual Prisma query.
  const { customerId } = await searchParams;

  const [records, receiptSums, paymentSums] = await Promise.all([
    prisma.policyRecord.findMany({
      where: { category: "BOND", deletedAt: null, ...(customerId ? { customerId } : {}) },
      include: {
        customer: { select: { companyName: true } },
        bondDetail: { select: { bondType: true, customBondType: true, policyNumber: true } },
      },
      orderBy: { processingDate: "desc" },
    }),
    prisma.policyCustomerReceipt.groupBy({
      by: ["policyRecordId"],
      where: { deletedAt: null, policyRecord: { category: "BOND" } },
      _sum: { amount: true },
    }),
    prisma.policyProviderPayment.groupBy({
      by: ["policyRecordId"],
      where: { deletedAt: null, policyRecord: { category: "BOND" } },
      _sum: { amount: true },
    }),
  ]);

  const receivedByRecord = new Map(receiptSums.map((r) => [r.policyRecordId, r._sum.amount?.toNumber() ?? 0]));
  const paidByRecord = new Map(paymentSums.map((p) => [p.policyRecordId, p._sum.amount?.toNumber() ?? 0]));

  const rows: BondListRow[] = records
    .filter((r) => r.bondDetail)
    .map((r) =>
      toBondListRow(r, {
        totalReceived: receivedByRecord.get(r.id) ?? 0,
        totalPaid: paidByRecord.get(r.id) ?? 0,
      })
    );

  return <BondListTable records={rows} canEdit={canEdit(session.user, "policy.bond")} />;
}
