import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { computeBusinessStatus, computePaymentStatus } from "@/lib/policy/status";
import { toDecimal } from "@/lib/money";
import { ensurePolicyCreatedActivityBackfilled } from "@/lib/policy/activity";
import { pickRelatedInvoiceForDisplay } from "@/lib/invoice/eligibility";
import { MotorDetailView } from "@/components/policy/motor/motor-detail-view";
import type { MotorDetail, TransactionRow, PolicyDocumentRow, PolicyActivityRow } from "@/components/policy/types";

export default async function MotorRecordDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "policy.motor")) {
    redirect("/access-denied");
  }

  const { id } = await params;

  const record = await prisma.policyRecord.findUnique({
    where: { id, category: "MOTOR", deletedAt: null },
    include: {
      customer: { select: { companyName: true } },
      project: { select: { projectName: true } },
      motorDetail: true,
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
  if (!record || !record.motorDetail) notFound();

  // Idempotent (check-count-then-insert, see that function's doc comment) —
  // safe to run on every page view, and the only place a pre-Phase-1B
  // record ever gets its first Activity entry.
  await prisma.$transaction((tx) =>
    ensurePolicyCreatedActivityBackfilled(tx, {
      id: record.id,
      createdById: record.createdById,
      createdAt: record.createdAt,
      recordNumber: record.recordNumber,
      source: record.source,
    })
  );

  const [documents, activities] = await Promise.all([
    prisma.policyDocument.findMany({ where: { policyRecordId: id }, orderBy: { createdAt: "desc" } }),
    prisma.policyActivity.findMany({ where: { policyRecordId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
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
  }));

  const activityRows: PolicyActivityRow[] = activities.map((a) => ({
    id: a.id,
    actionType: a.actionType,
    summary: a.summary,
    details: a.details,
    performedByName: a.performedById ? userNameById.get(a.performedById) ?? null : null,
    createdAt: a.createdAt.toISOString(),
  }));

  // The raw/cached source value for the "Historical Import Warning" card
  // lives on the staging PolicyImportRow, kept forever as an audit trail
  // (see that model's schema comment) — joined here by sourceSheet +
  // originalRowNumber rather than a direct FK, since PolicyRecord already
  // carries those two fields and no formal relation exists between the two
  // models (see this phase's "reusable import foundation" notes).
  const sourceImportRow =
    record.source === "HISTORICAL_IMPORT" && record.sourceSheet && record.originalRowNumber !== null
      ? await prisma.policyImportRow.findFirst({
          where: { importBatchId: record.importBatchId ?? undefined, originalRowNumber: record.originalRowNumber },
          select: { originalInsurerBalanceRaw: true, originalClientBalanceRaw: true },
        })
      : null;

  const resolverIds = [record.insurerBalanceResolvedById, record.clientBalanceResolvedById].filter(
    (id): id is string => !!id
  );
  const resolvers = resolverIds.length
    ? await prisma.user.findMany({ where: { id: { in: resolverIds } }, select: { id: true, fullName: true, username: true } })
    : [];
  const resolverNameById = new Map(resolvers.map((u) => [u.id, u.fullName || u.username]));

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

  const detail: MotorDetail = {
    id: record.id,
    recordNumber: record.recordNumber,
    processingDate: record.processingDate.toISOString(),
    customerId: record.customerId,
    customerName: record.customer.companyName,
    projectId: record.projectId,
    projectName: record.project?.projectName ?? null,
    insuranceType: record.motorDetail.insuranceType,
    registrationNumber: record.motorDetail.registrationNumber,
    taxClass: record.motorDetail.taxClass,
    vehicleValue: record.motorDetail.vehicleValue?.toString() ?? null,
    vehicleMake: record.motorDetail.vehicleMake,
    vehicleModel: record.motorDetail.vehicleModel,
    insurerName: record.insurerName,
    policyNumber: record.motorDetail.policyNumber,
    effectiveDate: record.effectiveDate.toISOString(),
    expiryDate: record.expiryDate.toISOString(),
    businessStatus: computeBusinessStatus(record.effectiveDate, record.expiryDate, record.businessStatus),
    source: record.source,
    sourceSheet: record.sourceSheet,
    originalRowNumber: record.originalRowNumber,
    remarks: record.remarks,

    customerPremium: record.customerPremium.toString(),
    insurerCost: record.insurerCost.toString(),
    totalReceived: totalReceived.toString(),
    totalPaid: totalPaid.toString(),
    clientBalance: clientBalance.toString(),
    insurerBalance: insurerBalance.toString(),
    customerPaymentStatus: computePaymentStatus(record.customerPremium.toNumber(), totalReceived.toNumber()),
    insurerPaymentStatus: computePaymentStatus(record.insurerCost.toNumber(), totalPaid.toNumber()),
    insurerBalanceVerification: record.insurerBalanceVerification,
    insurerBalanceWarningReason: record.insurerBalanceWarningReason,
    insurerBalanceRaw: sourceImportRow?.originalInsurerBalanceRaw ?? null,
    insurerBalanceResolutionNote: record.insurerBalanceResolutionNote,
    insurerBalanceResolvedAt: record.insurerBalanceResolvedAt?.toISOString() ?? null,
    insurerBalanceResolvedByName: record.insurerBalanceResolvedById ? resolverNameById.get(record.insurerBalanceResolvedById) ?? null : null,
    clientBalanceVerification: record.clientBalanceVerification,
    clientBalanceWarningReason: record.clientBalanceWarningReason,
    clientBalanceRaw: sourceImportRow?.originalClientBalanceRaw ?? null,
    clientBalanceResolutionNote: record.clientBalanceResolutionNote,
    clientBalanceResolvedAt: record.clientBalanceResolvedAt?.toISOString() ?? null,
    clientBalanceResolvedByName: record.clientBalanceResolvedById ? resolverNameById.get(record.clientBalanceResolvedById) ?? null : null,

    commissionReceived: record.commissionReceived,
    commissionAmount: record.commissionAmount?.toString() ?? null,
    commissionReceivedDate: record.commissionReceivedDate?.toISOString() ?? null,
    historicalNetProfit: record.historicalNetProfit?.toString() ?? null,
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
    // Phase 2B: fallback display data for when the live relation above is
    // null but this policy was in fact created from a quotation (e.g. the
    // relation's onDelete: SetNull fired) — see
    // PolicyRecord.sourceQuotationNumberSnapshot's schema comment.
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

  return <MotorDetailView detail={detail} customers={customers} />;
}
