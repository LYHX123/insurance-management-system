import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit, hasPermission } from "@/lib/permissions";
import { buildMotorListFilterWhere } from "@/lib/policy/motorListFilters";
import { toMotorListRow } from "@/lib/policy/policyListView";
import { MotorListTable } from "@/components/policy/motor/motor-list-table";
import type { MotorListRow } from "@/components/policy/types";

export default async function MotorPolicyListPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; contact?: string; expiryFrom?: string; expiryTo?: string; valuationStatus?: string }>;
}) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "policy.motor")) {
    redirect("/access-denied");
  }

  // Phase 8.1 Part 4 — the "View All Motor Policies" entry point from
  // Customer Detail's Related Records tab filters at the database level,
  // never just in the browser: customerId here narrows the actual Prisma
  // query. Phase 12A adds a free-text Contact Person match + an expiry-date
  // range to the same server-side where clause (see buildMotorListFilterWhere)
  // — none of these are applied by filtering the full dataset in the browser.
  const { customerId, contact, expiryFrom, expiryTo, valuationStatus } = await searchParams;
  const filterWhere = buildMotorListFilterWhere({ contact, expiryFrom, expiryTo, valuationStatus });

  const [records, receiptSums, paymentSums] = await Promise.all([
    prisma.policyRecord.findMany({
      where: { category: "MOTOR", deletedAt: null, ...(customerId ? { customerId } : {}), ...filterWhere },
      include: {
        customer: { select: { companyName: true } },
        motorDetail: { select: { insuranceType: true, registrationNumber: true, valuationStatus: true } },
      },
      orderBy: { processingDate: "desc" },
    }),
    prisma.policyCustomerReceipt.groupBy({
      by: ["policyRecordId"],
      where: { deletedAt: null, policyRecord: { category: "MOTOR" } },
      _sum: { amount: true },
    }),
    prisma.policyProviderPayment.groupBy({
      by: ["policyRecordId"],
      where: { deletedAt: null, policyRecord: { category: "MOTOR" } },
      _sum: { amount: true },
    }),
  ]);

  const receivedByRecord = new Map(receiptSums.map((r) => [r.policyRecordId, r._sum.amount?.toNumber() ?? 0]));
  const paidByRecord = new Map(paymentSums.map((p) => [p.policyRecordId, p._sum.amount?.toNumber() ?? 0]));

  const rows: MotorListRow[] = records.map((r) =>
    toMotorListRow(r, {
      totalReceived: receivedByRecord.get(r.id) ?? 0,
      totalPaid: paidByRecord.get(r.id) ?? 0,
    })
  );

  return <MotorListTable records={rows} canEdit={canEdit(session.user, "policy.motor")} />;
}
