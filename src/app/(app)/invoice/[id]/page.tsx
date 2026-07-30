import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, isAdmin } from "@/lib/permissions";
import { InvoiceDetailView } from "@/components/invoice/invoice-detail-view";
import { buildInvoiceDropboxViewModel } from "@/lib/integrations/dropbox/invoicePathViewModel";
import type { InvoiceDetail } from "@/components/invoice/types";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "invoice")) {
    redirect("/access-denied");
  }

  const { id } = await params;

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      customer: { select: { companyName: true, pinNumber: true } },
      items: {
        orderBy: { itemNumber: "asc" },
        include: { policyRecord: { select: { recordNumber: true, category: true } } },
      },
    },
  });
  if (!invoice) notFound();

  const dropbox = await buildInvoiceDropboxViewModel(id);

  const userIds = [invoice.createdById, invoice.cancelledById].filter((x): x is string => !!x);
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, username: true } })
    : [];
  const userNameById = new Map(users.map((u) => [u.id, u.fullName || u.username]));

  const detail: InvoiceDetail = {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate.toISOString(),
    status: invoice.status,
    customerId: invoice.customerId,
    customerName: invoice.customer.companyName,
    customerPin: invoice.customer.pinNumber,
    totalPremium: invoice.totalPremium.toString(),
    createdByName: userNameById.get(invoice.createdById) ?? "—",
    createdAt: invoice.createdAt.toISOString(),
    cancelledAt: invoice.cancelledAt?.toISOString() ?? null,
    cancelledByName: invoice.cancelledById ? userNameById.get(invoice.cancelledById) ?? "—" : null,
    items: invoice.items.map((item) => ({
      id: item.id,
      itemNumber: item.itemNumber,
      policyRecordId: item.policyRecordId,
      policyCategory: item.policyRecord.category,
      policyRecordNumber: item.policyRecord.recordNumber,
      policyClassSnapshot: item.policyClassSnapshot,
      policyNumberSnapshot: item.policyNumberSnapshot,
      premiumSnapshot: item.premiumSnapshot.toString(),
    })),
  };

  return <InvoiceDetailView detail={detail} dropbox={dropbox} isAdmin={isAdmin(session.user)} />;
}
