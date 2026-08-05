import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit, hasPermission, isAdmin } from "@/lib/permissions";
import { computeBusinessStatus, computePaymentStatus } from "@/lib/policy/status";
import { toDecimal } from "@/lib/money";
import { pickRelatedInvoiceForDisplay } from "@/lib/invoice/eligibility";
import { buildPolicyDropboxViewModel } from "@/lib/integrations/dropbox/policyPathViewModel";
import { NonMotorDetailView } from "@/components/policy/non-motor/non-motor-detail-view";
import type { NonMotorDetail, TransactionRow, PolicyDocumentRow, PolicyActivityRow } from "@/components/policy/types";

export default async function NonMotorRecordDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "policy.non_motor")) {
    redirect("/access-denied");
  }

  const { id } = await params;

  const record = await prisma.policyRecord.findUnique({
    where: { id, category: "NON_MOTOR", deletedAt: null },
    include: {
      customer: { select: { companyName: true } },
      project: { select: { projectName: true } },
      nonMotorDetail: true,
      customerReceipts: { where: { deletedAt: null }, orderBy: { receiptDate: "desc" } },
      providerPayments: { where: { deletedAt: null }, orderBy: { paymentDate: "desc" } },
      sourceQuotation: {
        select: {
          id: true,
          quotationNumber: true,
          revisionCode: true,
          quotationDate: true,
          grandTotal: true,
          customer: { select: { companyName: true } },
          project: { select: { projectName: true } },
        },
      },
      invoiceItems: {
        select: {
          invoice: { select: { id: true, invoiceNumber: true, invoiceDate: true, status: true, totalPremium: true } },
        },
      },
    },
  });
  if (!record || !record.nonMotorDetail) notFound();

  const [documents, activities, dropboxViewModel] = await Promise.all([
    prisma.policyDocument.findMany({ where: { policyRecordId: id }, orderBy: { createdAt: "desc" } }),
    prisma.policyActivity.findMany({ where: { policyRecordId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
    buildPolicyDropboxViewModel(id),
  ]);

  const documentUploaderIds = [...new Set(documents.map((d) => d.uploadedById))];
  const activityPerformerIds = [...new Set(activities.map((a) => a.performedById).filter((x): x is string => !!x))];
  const activityUsers = activityPerformerIds.length
    ? await prisma.user.findMany({ where: { id: { in: activityPerformerIds } }, select: { id: true, fullName: true, username: true } })
    : [];
  const documentUsers = documentUploaderIds.length
    ? await prisma.user.findMany({ where: { id: { in: documentUploaderIds } }, select: { id: true, fullName: true, username: true } })
    : [];
  const userNameById = new Map(
    [...activityUsers, ...documentUsers].map((u) => [u.id, u.fullName || u.username])
  );

  const fallbackDropboxInfo = { view: { state: "unavailable" as const, path: null, isPlanned: true, errorMessage: null }, standardizedFileName: null, lastSyncedAt: null };
  const documentRows: PolicyDocumentRow[] = documents.map((d) => ({
    id: d.id,
    documentType: d.documentType,
    originalFileName: d.originalFileName,
    mimeType: d.mimeType,
    fileSize: d.fileSize,
    issueDate: d.issueDate?.toISOString() ?? null,
    expiryDate: d.expiryDate?.toISOString() ?? null,
    notes: d.notes,
    uploadedByName: userNameById.get(d.uploadedById) ?? "—",
    createdAt: d.createdAt.toISOString(),
    dropbox: dropboxViewModel.documents[d.id] ?? fallbackDropboxInfo,
  }));

  const activityRows: PolicyActivityRow[] = activities.map((a) => ({
    id: a.id,
    actionType: a.actionType,
    summary: a.summary,
    details: a.details,
    performedByName: a.performedById ? userNameById.get(a.performedById) ?? null : null,
    createdAt: a.createdAt.toISOString(),
  }));

  const totalReceived = record.customerReceipts.reduce((sum, r) => sum.plus(r.amount), toDecimal(0));
  const totalPaid = record.providerPayments.reduce((sum, p) => sum.plus(p.amount), toDecimal(0));
  const clientBalance = record.customerPremium.minus(totalReceived);
  const insurerBalance = record.insurerCost.minus(totalPaid);
  const systemCalculatedMargin = record.customerPremium.minus(record.insurerCost);

  const customerReceipts: TransactionRow[] = record.customerReceipts.map((r) => ({
    id: r.id,
    date: r.receiptDate.toISOString(),
    amount: r.amount.toString(),
    paymentMethod: r.paymentMethod,
    referenceNumber: r.referenceNumber,
    notes: r.notes,
    source: r.source,
  }));
  const providerPayments: TransactionRow[] = record.providerPayments.map((p) => ({
    id: p.id,
    date: p.paymentDate.toISOString(),
    amount: p.amount.toString(),
    paymentMethod: p.paymentMethod,
    referenceNumber: p.referenceNumber,
    notes: p.notes,
    source: p.source,
  }));

  const detail: NonMotorDetail = {
    id: record.id,
    recordNumber: record.recordNumber,
    processingDate: record.processingDate.toISOString(),
    customerId: record.customerId,
    customerName: record.customer.companyName,
    projectId: record.projectId,
    projectName: record.project?.projectName ?? null,
    insuranceType: record.nonMotorDetail.insuranceType,
    policyNumber: record.nonMotorDetail.policyNumber,
    insurerName: record.insurerName,
    effectiveDate: record.effectiveDate.toISOString(),
    expiryDate: record.expiryDate.toISOString(),
    businessStatus: computeBusinessStatus(record.effectiveDate, record.expiryDate, record.businessStatus),
    source: record.source,
    remarks: record.remarks,

    customerPremium: record.customerPremium.toString(),
    insurerCost: record.insurerCost.toString(),
    totalReceived: totalReceived.toString(),
    totalPaid: totalPaid.toString(),
    clientBalance: clientBalance.toString(),
    insurerBalance: insurerBalance.toString(),
    customerPaymentStatus: computePaymentStatus(record.customerPremium.toNumber(), totalReceived.toNumber()),
    insurerPaymentStatus: computePaymentStatus(record.insurerCost.toNumber(), totalPaid.toNumber()),

    commissionReceived: record.commissionReceived,
    commissionAmount: record.commissionAmount?.toString() ?? null,
    commissionReceivedDate: record.commissionReceivedDate?.toISOString() ?? null,
    systemCalculatedMargin: systemCalculatedMargin.toString(),

    customerReceipts,
    providerPayments,
    documents: documentRows,
    activities: activityRows,
    sourceQuotation: record.sourceQuotation
      ? {
          id: record.sourceQuotation.id,
          quotationNumber: record.sourceQuotation.quotationNumber,
          revisionCode: record.sourceQuotation.revisionCode,
          customerName: record.sourceQuotation.customer.companyName,
          projectName: record.sourceQuotation.project?.projectName ?? null,
          quotationDate: record.sourceQuotation.quotationDate.toISOString(),
          grandTotal: record.sourceQuotation.grandTotal.toString(),
        }
      : null,
    sourceQuotationSnapshot: record.sourceQuotationNumberSnapshot
      ? {
          quotationNumber: record.sourceQuotationNumberSnapshot,
          revisionCode: record.sourceQuotationRevisionSnapshot,
          quotationDate: (record.sourceQuotationDateSnapshot ?? record.createdAt).toISOString(),
        }
      : null,
    relatedInvoice: pickRelatedInvoiceForDisplay(record.invoiceItems),
  };

  const customers = await prisma.customer.findMany({
    where: { status: "ACTIVE" },
    orderBy: { companyName: "asc" },
    select: {
      id: true,
      companyName: true,
      customerNumber: true,
      projects: { select: { id: true, projectName: true }, orderBy: { projectName: "asc" } },
    },
  });

  return (
    <NonMotorDetailView
      detail={detail}
      customers={customers}
      isAdmin={isAdmin(session.user)}
      canEdit={canEdit(session.user, "policy.non_motor")}
      dropbox={dropboxViewModel}
    />
  );
}
