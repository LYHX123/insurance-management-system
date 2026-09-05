import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit, hasPermission, isAdmin } from "@/lib/permissions";
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
      // Phase 12B — live insured customer (may be null: historical/same-party
      // invoices, or its Customer row later removed → snapshot still holds).
      insuredCustomer: { select: { companyName: true, pinNumber: true } },
      items: {
        orderBy: { itemNumber: "asc" },
        include: { policyRecord: { select: { recordNumber: true, category: true, sourceQuotationNumberSnapshot: true } } },
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

  // Phase 12B — an invoice has a "separate insured" only when it actually
  // recorded one at creation (insuredCustomerId or the name snapshot). NULL
  // on every historical/same-party invoice → treat Bill-To as both.
  const hasSeparateInsured = invoice.insuredCustomerId !== null || invoice.insuredNameSnapshot !== null;
  const insuredName = hasSeparateInsured
    ? invoice.insuredNameSnapshot ?? invoice.insuredCustomer?.companyName ?? invoice.customer.companyName
    : null;
  const insuredPin = hasSeparateInsured
    ? invoice.insuredPinSnapshot ?? invoice.insuredCustomer?.pinNumber ?? invoice.customer.pinNumber
    : null;

  const detail: InvoiceDetail = {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate.toISOString(),
    status: invoice.status,
    customerId: invoice.customerId,
    customerName: invoice.customer.companyName,
    customerPin: invoice.customer.pinNumber,
    hasSeparateInsured,
    insuredName,
    insuredPin,
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
      sourceQuotationNumber: item.policyRecord.sourceQuotationNumberSnapshot,
    })),
  };

  return <InvoiceDetailView detail={detail} dropbox={dropbox} isAdmin={isAdmin(session.user)} canEdit={canEdit(session.user, "invoice")} />;
}
