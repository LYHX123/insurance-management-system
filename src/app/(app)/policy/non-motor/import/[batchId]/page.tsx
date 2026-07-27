import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { getImportBatchSummaryAction } from "@/app/(app)/policy/non-motor/import/actions";
import { ImportPreviewTable } from "@/components/policy/non-motor/import-preview-table";
import type { NonMotorImportPreviewRowData } from "@/components/policy/non-motor/import-preview-table";

export default async function NonMotorImportPreviewPage({ params }: { params: Promise<{ batchId: string }> }) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "policy.non_motor")) {
    redirect("/access-denied");
  }

  const { batchId } = await params;

  const batch = await prisma.policyImportBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.category !== "NON_MOTOR") notFound();

  const [rows, customers, summaryResult] = await Promise.all([
    prisma.policyImportRow.findMany({ where: { importBatchId: batchId }, orderBy: { originalRowNumber: "asc" } }),
    prisma.customer.findMany({ where: { status: "ACTIVE" }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true } }),
    getImportBatchSummaryAction(batchId),
  ]);

  const previewRows: NonMotorImportPreviewRowData[] = rows.map((r) => ({
    id: r.id,
    originalRowNumber: r.originalRowNumber,
    processingDate: r.processingDate?.toISOString() ?? null,
    customerNameRaw: r.customerNameRaw,
    matchedCustomerId: r.matchedCustomerId,
    customerMatchStatus: r.customerMatchStatus,
    insuranceType: r.insuranceType,
    insurerName: r.insurerName,
    policyNumber: r.policyNumber,
    effectiveDate: r.effectiveDate?.toISOString() ?? null,
    expiryDate: r.expiryDate?.toISOString() ?? null,
    clientPremium: r.clientPremium?.toString() ?? null,
    insurerCost: r.insurerCost?.toString() ?? null,
    projectNameRaw: r.projectNameRaw,
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
