import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { getImportBatchSummaryAction } from "@/app/(app)/policy/motor/import/actions";
import { ImportPreviewTable } from "@/components/policy/motor/import-preview-table";
import type { ImportPreviewRowData } from "@/components/policy/motor/import-preview-table";

export default async function MotorImportPreviewPage({ params }: { params: Promise<{ batchId: string }> }) {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "policy")) {
    redirect("/access-denied");
  }

  const { batchId } = await params;

  const batch = await prisma.policyImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) notFound();

  const [rows, customers, summaryResult] = await Promise.all([
    prisma.policyImportRow.findMany({ where: { importBatchId: batchId }, orderBy: { originalRowNumber: "asc" } }),
    prisma.customer.findMany({ where: { status: "ACTIVE" }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true } }),
    getImportBatchSummaryAction(batchId),
  ]);

  const previewRows: ImportPreviewRowData[] = rows.map((r) => ({
    id: r.id,
    originalRowNumber: r.originalRowNumber,
    processingDate: r.processingDate?.toISOString() ?? null,
    customerNameRaw: r.customerNameRaw,
    matchedCustomerId: r.matchedCustomerId,
    customerMatchStatus: r.customerMatchStatus,
    insuranceType: r.insuranceType,
    registrationNumber: r.registrationNumber,
    insurerName: r.insurerName,
    effectiveDate: r.effectiveDate?.toISOString() ?? null,
    expiryDate: r.expiryDate?.toISOString() ?? null,
    insurerCost: r.insurerCost?.toString() ?? null,
    amountPaidToInsurer: r.amountPaidToInsurer?.toString() ?? null,
    calculatedInsurerBalance: r.calculatedInsurerBalance?.toString() ?? null,
    originalInsurerBalance: r.originalInsurerBalance?.toString() ?? null,
    clientPremium: r.clientPremium?.toString() ?? null,
    amountReceivedFromClient: r.amountReceivedFromClient?.toString() ?? null,
    calculatedClientBalance: r.calculatedClientBalance?.toString() ?? null,
    originalClientBalance: r.originalClientBalance?.toString() ?? null,
    commissionReceived: r.commissionReceived,
    insurerBalanceVerification: r.insurerBalanceVerification,
    clientBalanceVerification: r.clientBalanceVerification,
    status: r.status,
    warnings: r.warnings,
    duplicateOfRowNumbers: r.duplicateOfRowNumbers,
    duplicateOfPolicyRecordId: r.duplicateOfPolicyRecordId,
    includeInImport: r.includeInImport,
    isSelectedForImport: r.isSelectedForImport,
  }));

  return (
    <ImportPreviewTable
      batchId={batch.id}
      batchStatus={batch.status}
      sourceFileName={batch.sourceFileName}
      rows={previewRows}
      customers={customers}
      initialSummary={summaryResult.success ? summaryResult.summary : null}
    />
  );
}
