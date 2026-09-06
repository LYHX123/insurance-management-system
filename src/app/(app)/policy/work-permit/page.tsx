import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit, hasPermission } from "@/lib/permissions";
import { toWorkPermitListRow } from "@/lib/policy/policyListView";
import { WorkPermitListTable } from "@/components/policy/work-permit/work-permit-list-table";
import type { WorkPermitListRow } from "@/components/policy/types";

export default async function WorkPermitPolicyListPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "policy.work_permit")) {
    redirect("/access-denied");
  }

  // Phase 8.1 Part 4 — the "View All Work Permit Policies" entry point from
  // Customer Detail's Related Records tab filters at the database level,
  // never just in the browser: customerId here narrows the actual Prisma
  // query.
  const { customerId } = await searchParams;

  const [records, receiptSums, paymentSums] = await Promise.all([
    prisma.policyRecord.findMany({
      where: { category: "WORK_PERMIT", deletedAt: null, ...(customerId ? { customerId } : {}) },
      include: {
        customer: { select: { companyName: true } },
        workPermitDetail: { select: { permitType: true, otherPermitType: true } },
      },
      orderBy: { processingDate: "desc" },
    }),
    prisma.policyCustomerReceipt.groupBy({
      by: ["policyRecordId"],
      where: { deletedAt: null, policyRecord: { category: "WORK_PERMIT" } },
      _sum: { amount: true },
    }),
    prisma.policyProviderPayment.groupBy({
      by: ["policyRecordId"],
      where: { deletedAt: null, policyRecord: { category: "WORK_PERMIT" } },
      _sum: { amount: true },
    }),
  ]);

  const receivedByRecord = new Map(receiptSums.map((r) => [r.policyRecordId, r._sum.amount?.toNumber() ?? 0]));
  const paidByRecord = new Map(paymentSums.map((p) => [p.policyRecordId, p._sum.amount?.toNumber() ?? 0]));

  const rows: WorkPermitListRow[] = records
    .filter((r) => r.workPermitDetail)
    .map((r) =>
      toWorkPermitListRow(r, {
        totalReceived: receivedByRecord.get(r.id) ?? 0,
        totalPaid: paidByRecord.get(r.id) ?? 0,
      })
    );

  return <WorkPermitListTable records={rows} canEdit={canEdit(session.user, "policy.work_permit")} />;
}
