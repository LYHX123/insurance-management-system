import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { computeBusinessStatus } from "@/lib/policy/status";
import { BondListTable } from "@/components/policy/bond/bond-list-table";
import type { BondListRow } from "@/components/policy/types";

export default async function BondPolicyListPage() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "policy.bond")) {
    redirect("/access-denied");
  }

  const [records, receiptSums, paymentSums] = await Promise.all([
    prisma.policyRecord.findMany({
      where: { category: "BOND", deletedAt: null },
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
    .map((r) => {
      const totalReceived = receivedByRecord.get(r.id) ?? 0;
      const totalPaid = paidByRecord.get(r.id) ?? 0;
      const clientPremium = r.customerPremium.toNumber();
      const insurerCost = r.insurerCost.toNumber();
      return {
        id: r.id,
        recordNumber: r.recordNumber,
        processingDate: r.processingDate.toISOString(),
        customerId: r.customerId,
        customerName: r.customer.companyName,
        bondType: r.bondDetail!.bondType,
        customBondType: r.bondDetail!.customBondType,
        policyNumber: r.bondDetail!.policyNumber,
        insurerName: r.insurerName,
        expiryDate: r.expiryDate.toISOString(),
        clientPremium: clientPremium.toFixed(2),
        clientBalance: (clientPremium - totalReceived).toFixed(2),
        insurerBalance: (insurerCost - totalPaid).toFixed(2),
        businessStatus: computeBusinessStatus(r.effectiveDate, r.expiryDate, r.businessStatus),
      };
    });

  return <BondListTable records={rows} />;
}
