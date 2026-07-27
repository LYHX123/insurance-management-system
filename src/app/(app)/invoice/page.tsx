import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { InvoiceListTable } from "@/components/invoice/invoice-list-table";
import type { InvoiceListRow } from "@/components/invoice/types";

export default async function InvoiceListPage() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "invoice")) {
    redirect("/access-denied");
  }

  const invoices = await prisma.invoice.findMany({
    include: {
      customer: { select: { companyName: true } },
      items: { select: { policyClassSnapshot: true, policyNumberSnapshot: true } },
    },
    orderBy: { invoiceDate: "desc" },
  });

  const rows: InvoiceListRow[] = invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate.toISOString(),
    customerId: inv.customerId,
    customerName: inv.customer.companyName,
    policyCount: inv.items.length,
    totalPremium: inv.totalPremium.toString(),
    status: inv.status,
    searchableItemText: inv.items.map((i) => `${i.policyClassSnapshot} ${i.policyNumberSnapshot}`).join(" "),
  }));

  return <InvoiceListTable records={rows} />;
}
