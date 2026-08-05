"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit } from "@/lib/permissions";
import { toDecimal } from "@/lib/money";
import { generatePolicyRecordNumber } from "@/lib/policy/recordNumber";
import { computeBusinessStatus } from "@/lib/policy/status";
import { normalizeCustomerNameStrict } from "@/lib/policy/normalize";
import { parseNonMotorWorkbook } from "@/lib/policy/nonMotorImportParser";
import {
  buildNonMotorImportPreviewRows,
  deriveNonMotorStatusAndWarnings,
  type NonMotorStatusDerivationInput,
} from "@/lib/policy/nonMotorImportPreviewBuilder";
import { mapImportTextToNonMotorCoverType } from "@/lib/policy/nonMotorImportTypeMapping";
import { detectExactDuplicates } from "@/lib/policy/exactDuplicateCheck";
import { createHistoricalCustomer } from "@/lib/policy/historicalCustomer";
import { computeImportBatchSummary } from "@/lib/policy/importBatchSummary";
import { recordPolicyActivity } from "@/lib/policy/activity";
import { sha256Checksum } from "@/lib/quotationDocuments/storage";
import type { Prisma } from "@/generated/prisma/client";
import type { PolicyImportRowModel } from "@/generated/prisma/models";
import type { NonMotorCoverType } from "@/generated/prisma/enums";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

// Phase 3B: self-contained per this project's existing convention (see
// policy/motor/import/actions.ts's own requirePolicyPermission).
async function requirePolicyPermission() {
  const session = await auth();
  if (!session?.user || !canEdit(session.user, "policy.non_motor")) return null;
  return session;
}

// Rebuilds NonMotorStatusDerivationInput from a persisted PolicyImportRow —
// used by every action below that changes one facet of a row's resolution
// (customer mapping, possible-match accept/reject, duplicate override) and
// needs to recompute status/warnings/includeInImport without re-parsing.
function toDerivationInput(
  row: PolicyImportRowModel,
  overrides: Partial<Pick<NonMotorStatusDerivationInput, "customerMatchStatus" | "duplicateOfPolicyRecordId">> = {}
): NonMotorStatusDerivationInput {
  return {
    customerNameRaw: row.customerNameRaw,
    customerMatchStatus: (overrides.customerMatchStatus ?? row.customerMatchStatus) as NonMotorStatusDerivationInput["customerMatchStatus"],
    insuranceTypeRaw: row.insuranceType,
    resolvedInsuranceType: mapImportTextToNonMotorCoverType(row.insuranceType),
    effectiveDate: row.effectiveDate,
    expiryDate: row.expiryDate,
    clientPremium: row.clientPremium ? Number(row.clientPremium) : null,
    insurerCost: row.insurerCost ? Number(row.insurerCost) : null,
    duplicateOfRowNumbers: row.duplicateOfRowNumbers,
    duplicateOfPolicyRecordId: overrides.duplicateOfPolicyRecordId ?? row.duplicateOfPolicyRecordId,
  };
}

// --- Step 1: upload + parse + preview --------------------------------------
export async function uploadNonMotorWorkbookAction(
  formData: FormData
): Promise<ActionResult<{ batchId: string; totalRows: number; sheetNames: string[]; missingRequiredColumns: string[] }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { success: false, error: "NO_FILE" };
  if (!/\.xlsx?$/i.test(file.name)) return { success: false, error: "INVALID_FILE_TYPE" };

  const buffer = Buffer.from(await file.arrayBuffer());
  const sourceFileHash = sha256Checksum(buffer);

  let parsed: Awaited<ReturnType<typeof parseNonMotorWorkbook>>;
  try {
    parsed = await parseNonMotorWorkbook(buffer);
  } catch (err) {
    console.error("Failed to parse Non-Motor workbook:", err);
    return { success: false, error: "PARSE_FAILED" };
  }

  if (!parsed.usableSheetFound) {
    return { success: false, error: "NON_MOTOR_SHEET_NOT_FOUND" };
  }

  const customers = await prisma.customer.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, companyName: true, projects: { select: { id: true, projectName: true } } },
  });

  const preliminaryRows = buildNonMotorImportPreviewRows(parsed.rows, customers, new Map(), customers);

  // Best-effort exact-duplicate check at upload time (mandatorily re-run at
  // confirm time — see importSelectedNonMotorRowsAction).
  const exactDuplicates = await detectExactDuplicates(
    prisma,
    "NON_MOTOR",
    preliminaryRows.map((r) => ({
      rowNumber: r.rowNumber,
      sourceSheet: parsed.sheetName!,
      registrationNumber: null,
      insuranceType: r.resolvedInsuranceType,
      effectiveDate: r.effectiveDate,
      expiryDate: r.expiryDate,
      matchedCustomerId: r.matchedCustomerId,
      policyNumber: r.policyNumber,
    }))
  );
  const previewRows =
    exactDuplicates.size > 0 ? buildNonMotorImportPreviewRows(parsed.rows, customers, exactDuplicates, customers) : preliminaryRows;

  try {
    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.policyImportBatch.create({
        data: {
          category: "NON_MOTOR",
          sourceFileName: file.name,
          sourceFileHash,
          sourceSheet: parsed.sheetName!,
          status: "PREVIEWED",
          totalRows: previewRows.length,
          createdById: session.user.id,
        },
      });

      await tx.policyImportRow.createMany({
        data: previewRows.map((row) => ({
          importBatchId: created.id,
          originalRowNumber: row.rowNumber,
          processingDate: row.processingDate,
          customerNameRaw: row.customerNameRaw,
          matchedCustomerId: row.matchedCustomerId,
          customerMatchStatus: row.customerMatchStatus,
          insuranceType: row.insuranceTypeRaw,
          insurerName: row.insurerName,
          policyNumber: row.policyNumber,
          effectiveDate: row.effectiveDate,
          expiryDate: row.expiryDate,
          clientPremium: row.clientPremium !== null ? toDecimal(row.clientPremium) : null,
          insurerCost: row.insurerCost !== null ? toDecimal(row.insurerCost) : null,
          // Non-Motor's standard format has no source balance columns at
          // all, so there is nothing to ever mark UNVERIFIED — both stay at
          // their schema default (VERIFIED, no reason).
          calculatedInsurerBalance: toDecimal((row.insurerCost ?? 0) as number),
          calculatedClientBalance: toDecimal((row.clientPremium ?? 0) as number),
          projectNameRaw: row.projectNameRaw,
          matchedProjectId: row.matchedProjectId,
          remarks: row.remarks,
          duplicateOfRowNumbers: row.duplicateOfRowNumbers,
          duplicateOfPolicyRecordId: row.duplicateOfPolicyRecordId,
          status: row.status,
          warnings: row.warnings,
          includeInImport: row.includeInImport,
        })),
      });

      return created;
    });

    return {
      success: true,
      batchId: batch.id,
      totalRows: previewRows.length,
      sheetNames: parsed.sheetNames,
      missingRequiredColumns: [],
    };
  } catch (err) {
    console.error("Failed to persist Non-Motor import preview:", err);
    return { success: false, error: "PREVIEW_SAVE_FAILED" };
  }
}

// --- Customer resolution — identical shape to Motor's actions, reimplemented
//     here per this project's per-category actions-file convention. ---------
export async function applyManualCustomerMappingAction(
  batchId: string,
  customerNameRaw: string,
  customerId: string
): Promise<ActionResult<{ updatedCount: number }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return { success: false, error: "CUSTOMER_NOT_FOUND" };

  const targetNorm = normalizeCustomerNameStrict(customerNameRaw);
  const rows = await prisma.policyImportRow.findMany({ where: { importBatchId: batchId } });
  const matchingRows = rows.filter((r) => normalizeCustomerNameStrict(r.customerNameRaw) === targetNorm && r.status !== "IMPORTED");
  if (matchingRows.length === 0) return { success: false, error: "NO_MATCHING_ROWS" };

  await prisma.$transaction(async (tx) => {
    for (const row of matchingRows) {
      const derived = deriveNonMotorStatusAndWarnings(toDerivationInput(row, { customerMatchStatus: "MANUAL" }));
      await tx.policyImportRow.update({
        where: { id: row.id },
        data: {
          matchedCustomerId: customerId,
          customerMatchStatus: "MANUAL",
          status: derived.status,
          warnings: derived.warnings,
          includeInImport: derived.includeInImport,
        },
      });
    }
  });
  return { success: true, updatedCount: matchingRows.length };
}

export async function createCustomersFromHistoricalNamesAction(
  batchId: string,
  customerNames: string[]
): Promise<ActionResult<{ createdCount: number; mappedRowCount: number }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };
  if (customerNames.length === 0) return { success: false, error: "NO_NAMES_PROVIDED" };

  const batch = await prisma.policyImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { success: false, error: "BATCH_NOT_FOUND" };

  const rows = await prisma.policyImportRow.findMany({ where: { importBatchId: batchId } });
  const existingCompanyNames = new Set(
    (await prisma.customer.findMany({ select: { companyName: true } })).map((c) => normalizeCustomerNameStrict(c.companyName))
  );

  let createdCount = 0;
  let mappedRowCount = 0;

  try {
    await prisma.$transaction(async (tx) => {
      for (const rawName of customerNames) {
        const targetNorm = normalizeCustomerNameStrict(rawName);
        if (existingCompanyNames.has(targetNorm)) continue;

        const matchingRows = rows.filter(
          (r) => normalizeCustomerNameStrict(r.customerNameRaw) === targetNorm && r.status !== "IMPORTED"
        );
        if (matchingRows.length === 0) continue;

        const firstRow = matchingRows.reduce((a, b) => (a.originalRowNumber < b.originalRowNumber ? a : b));
        const customer = await createHistoricalCustomer(tx, {
          companyName: rawName.trim(),
          importBatchId: batchId,
          sourceSheet: batch.sourceSheet,
          originalRowNumber: firstRow.originalRowNumber,
        });
        createdCount++;
        existingCompanyNames.add(targetNorm);

        for (const row of matchingRows) {
          const derived = deriveNonMotorStatusAndWarnings(toDerivationInput(row, { customerMatchStatus: "MANUAL" }));
          await tx.policyImportRow.update({
            where: { id: row.id },
            data: {
              matchedCustomerId: customer.id,
              customerMatchStatus: "MANUAL",
              status: derived.status,
              warnings: derived.warnings,
              includeInImport: derived.includeInImport,
            },
          });
          mappedRowCount++;
        }
      }
    });
    return { success: true, createdCount, mappedRowCount };
  } catch (err) {
    console.error("Failed to create customers from historical names:", err);
    return { success: false, error: "CREATE_CUSTOMERS_FAILED" };
  }
}

export async function skipHistoricalCustomerGroupAction(
  batchId: string,
  customerNameRaw: string
): Promise<ActionResult<{ updatedCount: number }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const targetNorm = normalizeCustomerNameStrict(customerNameRaw);
  const rows = await prisma.policyImportRow.findMany({ where: { importBatchId: batchId } });
  const matchingRows = rows.filter((r) => normalizeCustomerNameStrict(r.customerNameRaw) === targetNorm && r.status !== "IMPORTED");
  if (matchingRows.length === 0) return { success: false, error: "NO_MATCHING_ROWS" };

  await prisma.policyImportRow.updateMany({
    where: { id: { in: matchingRows.map((r) => r.id) } },
    data: { includeInImport: false, isSelectedForImport: false },
  });
  return { success: true, updatedCount: matchingRows.length };
}

export async function acceptPossibleMatchAction(
  batchId: string,
  customerNameRaw: string
): Promise<ActionResult<{ updatedCount: number }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const targetNorm = normalizeCustomerNameStrict(customerNameRaw);
  const rows = await prisma.policyImportRow.findMany({ where: { importBatchId: batchId } });
  const matchingRows = rows.filter(
    (r) => normalizeCustomerNameStrict(r.customerNameRaw) === targetNorm && r.customerMatchStatus === "POSSIBLE"
  );
  if (matchingRows.length === 0) return { success: false, error: "NO_MATCHING_ROWS" };

  await prisma.$transaction(async (tx) => {
    for (const row of matchingRows) {
      const derived = deriveNonMotorStatusAndWarnings(toDerivationInput(row, { customerMatchStatus: "MANUAL" }));
      await tx.policyImportRow.update({
        where: { id: row.id },
        data: {
          customerMatchStatus: "MANUAL",
          status: derived.status,
          warnings: derived.warnings,
          includeInImport: derived.includeInImport,
        },
      });
    }
  });
  return { success: true, updatedCount: matchingRows.length };
}

export async function rejectPossibleMatchAction(
  batchId: string,
  customerNameRaw: string
): Promise<ActionResult<{ updatedCount: number }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const targetNorm = normalizeCustomerNameStrict(customerNameRaw);
  const rows = await prisma.policyImportRow.findMany({ where: { importBatchId: batchId } });
  const matchingRows = rows.filter(
    (r) => normalizeCustomerNameStrict(r.customerNameRaw) === targetNorm && r.customerMatchStatus === "POSSIBLE"
  );
  if (matchingRows.length === 0) return { success: false, error: "NO_MATCHING_ROWS" };

  await prisma.$transaction(async (tx) => {
    for (const row of matchingRows) {
      const derived = deriveNonMotorStatusAndWarnings(toDerivationInput({ ...row, matchedCustomerId: null }, { customerMatchStatus: "UNMATCHED" }));
      await tx.policyImportRow.update({
        where: { id: row.id },
        data: {
          matchedCustomerId: null,
          customerMatchStatus: "UNMATCHED",
          status: derived.status,
          warnings: derived.warnings,
          includeInImport: derived.includeInImport,
          isSelectedForImport: false,
        },
      });
    }
  });
  return { success: true, updatedCount: matchingRows.length };
}

// --- Per-row / per-group include toggles ------------------------------------
export async function toggleImportRowIncludeAction(rowId: string, include: boolean): Promise<ActionResult> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const row = await prisma.policyImportRow.findUnique({ where: { id: rowId } });
  if (!row) return { success: false, error: "ROW_NOT_FOUND" };
  if (include && (row.status === "ERROR" || row.status === "EXACT_DUPLICATE")) {
    return { success: false, error: "ROW_CANNOT_BE_INCLUDED" };
  }

  await prisma.policyImportRow.update({
    where: { id: rowId },
    data: include ? { includeInImport: true } : { includeInImport: false, isSelectedForImport: false },
  });
  return { success: true };
}

export async function toggleDuplicateGroupIncludeAction(
  batchId: string,
  rowNumbers: number[],
  include: boolean
): Promise<ActionResult<{ updatedCount: number }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const rows = await prisma.policyImportRow.findMany({
    where: { importBatchId: batchId, originalRowNumber: { in: rowNumbers } },
  });
  const updatable = rows.filter((r) => r.status !== "EXACT_DUPLICATE" && r.status !== "ERROR");
  if (updatable.length === 0) return { success: false, error: "NO_MATCHING_ROWS" };

  await prisma.policyImportRow.updateMany({
    where: { id: { in: updatable.map((r) => r.id) } },
    data: include ? { includeInImport: true } : { includeInImport: false, isSelectedForImport: false },
  });
  return { success: true, updatedCount: updatable.length };
}

// --- Selection for the controlled "Import Selected" workflow ---------------
function eligibleRowWhere(batchId: string): Prisma.PolicyImportRowWhereInput {
  return {
    importBatchId: batchId,
    includeInImport: true,
    status: { in: ["READY", "WARNING", "POSSIBLE_DUPLICATE"] },
    customerMatchStatus: { not: "POSSIBLE" },
  };
}

export async function toggleRowSelectionAction(rowId: string, selected: boolean): Promise<ActionResult> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const row = await prisma.policyImportRow.findUnique({ where: { id: rowId } });
  if (!row) return { success: false, error: "ROW_NOT_FOUND" };
  if (
    selected &&
    (!row.includeInImport ||
      row.status === "ERROR" ||
      row.status === "EXACT_DUPLICATE" ||
      row.status === "IMPORTED" ||
      row.customerMatchStatus === "POSSIBLE")
  ) {
    return { success: false, error: "ROW_NOT_ELIGIBLE" };
  }

  await prisma.policyImportRow.update({ where: { id: rowId }, data: { isSelectedForImport: selected } });
  return { success: true };
}

export async function clearSelectionAction(batchId: string): Promise<ActionResult<{ updatedCount: number }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const result = await prisma.policyImportRow.updateMany({
    where: { importBatchId: batchId, isSelectedForImport: true },
    data: { isSelectedForImport: false },
  });
  return { success: true, updatedCount: result.count };
}

export async function selectFirstNEligibleAction(batchId: string, n: number): Promise<ActionResult<{ selectedCount: number }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const batch = await prisma.policyImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { success: false, error: "BATCH_NOT_FOUND" };

  const eligible = await prisma.policyImportRow.findMany({
    where: eligibleRowWhere(batchId),
    orderBy: [{ originalRowNumber: "asc" }],
    take: n,
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.policyImportRow.updateMany({ where: { importBatchId: batchId, isSelectedForImport: true }, data: { isSelectedForImport: false } }),
    prisma.policyImportRow.updateMany({ where: { id: { in: eligible.map((r) => r.id) } }, data: { isSelectedForImport: true } }),
  ]);

  return { success: true, selectedCount: eligible.length };
}

export async function selectAllEligibleAction(batchId: string): Promise<ActionResult<{ selectedCount: number }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const result = await prisma.policyImportRow.updateMany({
    where: eligibleRowWhere(batchId),
    data: { isSelectedForImport: true },
  });
  return { success: true, selectedCount: result.count };
}

// --- Batch summary -----------------------------------------------------------
export type { ImportBatchSummary } from "@/lib/policy/importBatchSummary";

export async function getImportBatchSummaryAction(
  batchId: string
): Promise<ActionResult<{ summary: import("@/lib/policy/importBatchSummary").ImportBatchSummary }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const rows = await prisma.policyImportRow.findMany({ where: { importBatchId: batchId } });
  const newlyCreatedCustomers = await prisma.customer.count({ where: { importBatchId: batchId } });

  return { success: true, summary: computeImportBatchSummary(rows, newlyCreatedCustomers) };
}

// --- Import Selected ---------------------------------------------------------
const IMPORT_CHUNK_SIZE = 50;

export type ImportResultReport = {
  policiesCreated: number;
  customersCreated: number;
  customerReceiptsCreated: number;
  providerPaymentsCreated: number;
  rowsImported: number;
  rowsRemaining: number;
  rowsSkippedOrBlocked: number;
  warnings: string[];
};

export async function importSelectedNonMotorRowsAction(
  batchId: string,
  confirmedRowIds: string[]
): Promise<ActionResult<{ report: ImportResultReport }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const batch = await prisma.policyImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { success: false, error: "BATCH_NOT_FOUND" };
  if (batch.status === "COMPLETED") return { success: false, error: "ALREADY_COMPLETED" };

  const selectedRows = await prisma.policyImportRow.findMany({
    where: { importBatchId: batchId, isSelectedForImport: true },
    orderBy: { originalRowNumber: "asc" },
  });
  if (selectedRows.length === 0) return { success: false, error: "NO_ROWS_SELECTED" };

  const actualIds = selectedRows.map((r) => r.id).sort();
  const expectedIds = [...confirmedRowIds].sort();
  if (actualIds.length !== expectedIds.length || actualIds.some((id, i) => id !== expectedIds[i])) {
    return { success: false, error: "SELECTION_CHANGED" };
  }

  // Mandatory final gate: re-check EXACT_DUPLICATE right before importing —
  // same reasoning as Motor's importSelectedRowsAction.
  const freshExactDuplicates = await detectExactDuplicates(
    prisma,
    "NON_MOTOR",
    selectedRows.map((r) => ({
      rowNumber: r.originalRowNumber,
      sourceSheet: batch.sourceSheet,
      registrationNumber: null,
      insuranceType: mapImportTextToNonMotorCoverType(r.insuranceType),
      effectiveDate: r.effectiveDate,
      expiryDate: r.expiryDate,
      matchedCustomerId: r.matchedCustomerId,
      policyNumber: r.policyNumber,
    }))
  );

  const blocking: string[] = [];
  for (const row of selectedRows) {
    if (!row.matchedCustomerId || row.customerMatchStatus === "UNMATCHED" || row.customerMatchStatus === "POSSIBLE") {
      blocking.push(`Row ${row.originalRowNumber}: customer is not resolved.`);
    }
    if (row.status === "EXACT_DUPLICATE" || freshExactDuplicates.has(row.originalRowNumber)) {
      blocking.push(`Row ${row.originalRowNumber}: is an exact duplicate of an existing policy.`);
    }
    const resolvedType = mapImportTextToNonMotorCoverType(row.insuranceType);
    if (
      !resolvedType ||
      !row.effectiveDate ||
      !row.expiryDate ||
      (row.expiryDate && row.effectiveDate && row.expiryDate < row.effectiveDate) ||
      row.clientPremium === null ||
      row.insurerCost === null
    ) {
      blocking.push(`Row ${row.originalRowNumber}: has a blocking validation error.`);
    }
    if (row.status === "IMPORTED") {
      blocking.push(`Row ${row.originalRowNumber}: was already imported.`);
    }
  }
  if (blocking.length > 0) {
    return { success: false, error: "SELECTED_ROWS_NOT_IMPORTABLE" };
  }

  let policiesCreated = 0;
  const customersCreatedForBatch = await prisma.customer.count({ where: { importBatchId: batchId } });

  try {
    for (let i = 0; i < selectedRows.length; i += IMPORT_CHUNK_SIZE) {
      const chunk = selectedRows.slice(i, i + IMPORT_CHUNK_SIZE);
      await prisma.$transaction(async (tx) => {
        for (const row of chunk) {
          await importOneRow(tx, batchId, row, batch.sourceSheet, session.user.id);
          policiesCreated++;
          await tx.policyImportRow.update({
            where: { id: row.id },
            data: { status: "IMPORTED", isSelectedForImport: false },
          });
        }
      });
    }

    const remainingEligible = await prisma.policyImportRow.count({ where: eligibleRowWhere(batchId) });
    const totalRows = await prisma.policyImportRow.count({ where: { importBatchId: batchId } });
    const totalImported = await prisma.policyImportRow.count({ where: { importBatchId: batchId, status: "IMPORTED" } });

    await prisma.policyImportBatch.update({
      where: { id: batchId },
      data: {
        status: remainingEligible > 0 ? "PARTIALLY_IMPORTED" : "COMPLETED",
        importedCount: totalImported,
        completedAt: remainingEligible > 0 ? null : new Date(),
      },
    });

    const summaryResult = await getImportBatchSummaryAction(batchId);
    const warnings = selectedRows.flatMap((r) => r.warnings);

    const report: ImportResultReport = {
      policiesCreated,
      customersCreated: customersCreatedForBatch,
      // Non-Motor's standard import format has no amount-paid/amount-received
      // columns (see nonMotorImportParser.ts) — no receipts/payments are ever
      // created directly from an import row, only the PolicyRecord +
      // NonMotorPolicyDetail. Receipts/payments are added afterward through
      // the normal Financial tab, same as any manually-created record.
      customerReceiptsCreated: 0,
      providerPaymentsCreated: 0,
      rowsImported: policiesCreated,
      rowsRemaining: summaryResult.success ? summaryResult.summary.remainingAfterLatestSelectedImport : totalRows - totalImported,
      rowsSkippedOrBlocked: summaryResult.success ? summaryResult.summary.skippedRows + summaryResult.summary.errorRows : 0,
      warnings,
    };

    revalidatePath("/policy/non-motor");
    return { success: true, report };
  } catch (err) {
    console.error(`Failed to import selected rows for Non-Motor batch ${batchId}:`, err);
    await prisma.policyImportBatch.update({ where: { id: batchId }, data: { status: "FAILED" } });
    return { success: false, error: "IMPORT_FAILED" };
  }
}

async function importOneRow(
  tx: Prisma.TransactionClient,
  batchId: string,
  row: {
    id: string;
    originalRowNumber: number;
    processingDate: Date | null;
    matchedCustomerId: string | null;
    matchedProjectId: string | null;
    insuranceType: string | null;
    insurerName: string | null;
    policyNumber: string | null;
    effectiveDate: Date | null;
    expiryDate: Date | null;
    clientPremium: Prisma.Decimal | null;
    insurerCost: Prisma.Decimal | null;
    remarks: string | null;
  },
  sourceSheet: string,
  createdById: string
): Promise<void> {
  const resolvedType = mapImportTextToNonMotorCoverType(row.insuranceType);
  if (!row.matchedCustomerId || !resolvedType || !row.effectiveDate || !row.expiryDate || row.clientPremium === null || row.insurerCost === null) {
    throw new Error(`Row ${row.originalRowNumber} is missing required fields at import time`);
  }

  const processingDate = row.processingDate ?? row.effectiveDate;
  const businessStatus = computeBusinessStatus(row.effectiveDate, row.expiryDate, "DRAFT");
  const recordNumber = await generatePolicyRecordNumber(tx, "NON_MOTOR");

  const created = await tx.policyRecord.create({
    data: {
      recordNumber,
      category: "NON_MOTOR",
      processingDate,
      customerId: row.matchedCustomerId,
      projectId: row.matchedProjectId,
      insurerName: row.insurerName,
      effectiveDate: row.effectiveDate,
      expiryDate: row.expiryDate,
      businessStatus,
      customerPremium: row.clientPremium,
      insurerCost: row.insurerCost,
      source: "HISTORICAL_IMPORT",
      importBatchId: batchId,
      sourceSheet,
      originalRowNumber: row.originalRowNumber,
      remarks: row.remarks,
      createdById,
      nonMotorDetail: {
        create: {
          insuranceType: resolvedType as NonMotorCoverType,
          policyNumber: row.policyNumber,
        },
      },
    },
  });

  await recordPolicyActivity(tx, {
    policyRecordId: created.id,
    actionType: "HISTORICAL_POLICY_IMPORTED",
    summary: `Non-Motor policy ${recordNumber} imported from historical data`,
    performedById: createdById,
  });
}
