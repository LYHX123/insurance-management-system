"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { toDecimal } from "@/lib/money";
import { generatePolicyRecordNumber } from "@/lib/policy/recordNumber";
import { computeBusinessStatus } from "@/lib/policy/status";
import { normalizeCustomerNameStrict } from "@/lib/policy/normalize";
import { parseMotorWorkbook, MOTOR_SHEET_NAME } from "@/lib/policy/motorImportParser";
import { buildImportPreviewRows, deriveStatusAndWarnings, type StatusDerivationInput } from "@/lib/policy/importPreviewBuilder";
import { detectExactDuplicates } from "@/lib/policy/exactDuplicateCheck";
import { createHistoricalCustomer } from "@/lib/policy/historicalCustomer";
import { computeImportBatchSummary } from "@/lib/policy/importBatchSummary";
import { recordPolicyActivity } from "@/lib/policy/activity";
import { sha256Checksum } from "@/lib/quotationDocuments/storage";
import type { Prisma } from "@/generated/prisma/client";
import type { PolicyImportRowModel } from "@/generated/prisma/models";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

async function requirePolicyPermission() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "policy.motor")) return null;
  return session;
}

// Rebuilds StatusDerivationInput from a persisted PolicyImportRow — used by
// every action below that changes one facet of a row's resolution
// (customer mapping, possible-match accept/reject, duplicate override) and
// needs to recompute status/warnings/includeInImport for the CURRENT state
// without re-parsing the workbook. commissionWasRateValue isn't persisted
// (only matters at initial parse time — see importPreviewBuilder's doc
// comment), so it's simply omitted here.
function toDerivationInput(
  row: PolicyImportRowModel,
  overrides: Partial<Pick<StatusDerivationInput, "customerMatchStatus" | "duplicateOfPolicyRecordId">> = {}
): StatusDerivationInput {
  return {
    customerNameRaw: row.customerNameRaw,
    customerMatchStatus: overrides.customerMatchStatus ?? row.customerMatchStatus,
    registrationNumber: row.registrationNumber,
    effectiveDate: row.effectiveDate,
    expiryDate: row.expiryDate,
    insurerName: row.insurerName,
    insuranceType: row.insuranceType,
    vehicleValue: row.vehicleValue ? Number(row.vehicleValue) : null,
    commissionReceivedDate: row.commissionReceivedDate,
    commissionReceived: row.commissionReceived,
    insurerCost: row.insurerCost ? Number(row.insurerCost) : null,
    amountPaidToInsurer: row.amountPaidToInsurer ? Number(row.amountPaidToInsurer) : null,
    originalInsurerBalance: row.originalInsurerBalance ? Number(row.originalInsurerBalance) : null,
    insurerBalanceWarningReason: row.insurerBalanceWarningReason,
    clientPremium: row.clientPremium ? Number(row.clientPremium) : null,
    amountReceivedFromClient: row.amountReceivedFromClient ? Number(row.amountReceivedFromClient) : null,
    originalClientBalance: row.originalClientBalance ? Number(row.originalClientBalance) : null,
    clientBalanceWarningReason: row.clientBalanceWarningReason,
    duplicateOfRowNumbers: row.duplicateOfRowNumbers,
    duplicateOfPolicyRecordId: overrides.duplicateOfPolicyRecordId ?? row.duplicateOfPolicyRecordId,
  };
}

// --- Step 1: upload + parse + preview --------------------------------------
export async function uploadMotorWorkbookAction(
  formData: FormData
): Promise<ActionResult<{ batchId: string; totalRows: number; sheetNames: string[]; headerMismatches: unknown[] }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const file = formData.get("file");
  if (!(file instanceof File)) return { success: false, error: "NO_FILE" };
  if (!/\.xlsx?$/i.test(file.name)) return { success: false, error: "INVALID_FILE_TYPE" };

  const buffer = Buffer.from(await file.arrayBuffer());
  const sourceFileHash = sha256Checksum(buffer);

  let parsed: Awaited<ReturnType<typeof parseMotorWorkbook>>;
  try {
    parsed = await parseMotorWorkbook(buffer);
  } catch (err) {
    console.error("Failed to parse Motor workbook:", err);
    return { success: false, error: "PARSE_FAILED" };
  }

  if (!parsed.motorSheetFound) {
    return { success: false, error: "MOTOR_SHEET_NOT_FOUND" };
  }

  const customers = await prisma.customer.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, companyName: true },
  });

  const preliminaryRows = buildImportPreviewRows(parsed.rows, customers);

  // Best-effort exact-duplicate check at upload time, using whatever
  // customer matches already resolved (most rows are UNMATCHED on first
  // upload — this check is re-run, mandatorily, at confirm time once
  // customer mapping is complete; see confirmMotorImportAction).
  const exactDuplicates = await detectExactDuplicates(
    prisma,
    "MOTOR",
    preliminaryRows.map((r) => ({
      rowNumber: r.rowNumber,
      sourceSheet: MOTOR_SHEET_NAME,
      registrationNumber: r.registrationNumber,
      insuranceType: r.insuranceType,
      effectiveDate: r.effectiveDate,
      expiryDate: r.expiryDate,
      matchedCustomerId: r.matchedCustomerId,
    }))
  );
  const previewRows = exactDuplicates.size > 0 ? buildImportPreviewRows(parsed.rows, customers, exactDuplicates) : preliminaryRows;

  try {
    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.policyImportBatch.create({
        data: {
          category: "MOTOR",
          sourceFileName: file.name,
          sourceFileHash,
          sourceSheet: MOTOR_SHEET_NAME,
          status: "PREVIEWED",
          totalRows: previewRows.length,
          createdById: session.user.id,
        },
      });

      // createMany in one call — 1,436 rows is comfortably within a single
      // statement, and this only ever runs once per uploaded workbook.
      await tx.policyImportRow.createMany({
        data: previewRows.map((row) => ({
          importBatchId: created.id,
          originalRowNumber: row.rowNumber,
          processingDate: row.processingDate,
          customerNameRaw: row.customerNameRaw,
          matchedCustomerId: row.matchedCustomerId,
          customerMatchStatus: row.customerMatchStatus,
          insuranceType: row.insuranceType,
          registrationNumber: row.registrationNumber,
          insurerName: row.insurerName,
          effectiveDate: row.effectiveDate,
          expiryDate: row.expiryDate,
          insurerCost: row.insurerCost !== null ? toDecimal(row.insurerCost) : null,
          amountPaidToInsurer: row.amountPaidToInsurer !== null ? toDecimal(row.amountPaidToInsurer) : null,
          insurerPaymentDate: row.insurerPaymentDate,
          calculatedInsurerBalance: toDecimal(row.calculatedInsurerBalance),
          originalInsurerBalance: row.originalInsurerBalance !== null ? toDecimal(row.originalInsurerBalance) : null,
          originalInsurerBalanceRaw: row.originalInsurerBalanceRaw,
          insurerBalanceVerification: row.insurerBalanceVerification,
          insurerBalanceWarningReason: row.insurerBalanceWarningReason,
          clientPremium: row.clientPremium !== null ? toDecimal(row.clientPremium) : null,
          amountReceivedFromClient: row.amountReceivedFromClient !== null ? toDecimal(row.amountReceivedFromClient) : null,
          clientReceiptDate: row.clientReceiptDate,
          calculatedClientBalance: toDecimal(row.calculatedClientBalance),
          originalClientBalance: row.originalClientBalance !== null ? toDecimal(row.originalClientBalance) : null,
          originalClientBalanceRaw: row.originalClientBalanceRaw,
          clientBalanceVerification: row.clientBalanceVerification,
          clientBalanceWarningReason: row.clientBalanceWarningReason,
          vehicleValue: row.vehicleValue !== null ? toDecimal(row.vehicleValue) : null,
          commissionReceived: row.commissionReceived,
          commissionReceivedDate: row.commissionReceivedDate,
          historicalNetProfit: row.historicalNetProfit !== null ? toDecimal(row.historicalNetProfit) : null,
          // Column M ("RECEIPT") is a legacy Y/N flag, not a receipt number
          // (see motorImportParser's doc comment) — only appended when a
          // source value actually exists, kept in remarks for post-import
          // audit visibility (also surfaced as a preview warning, see
          // deriveStatusAndWarnings).
          remarks: row.columnMReceiptFlag
            ? `${row.remarks ? row.remarks + " | " : ""}Receipt flag (source column M): ${row.columnMReceiptFlag}`
            : row.remarks,
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
      headerMismatches: parsed.headerMismatches,
    };
  } catch (err) {
    console.error("Failed to persist Motor import preview:", err);
    return { success: false, error: "PREVIEW_SAVE_FAILED" };
  }
}

// --- Customer resolution: map to an existing customer -----------------------
// Applies to every row in the batch sharing the same raw historical customer
// name (normalized), per the Phase 1A spec — one mapping decision resolves
// every repeated occurrence at once instead of row-by-row.
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

  try {
    await prisma.$transaction(async (tx) => {
      for (const row of matchingRows) {
        const derived = deriveStatusAndWarnings(toDerivationInput(row, { customerMatchStatus: "MANUAL" }));
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
  } catch (err) {
    console.error("Failed to apply manual customer mapping:", err);
    return { success: false, error: "MAPPING_FAILED" };
  }
}

// --- Customer resolution: create a new Customer from historical name(s) ----
// Handles all three UI actions from the Phase 1A.1 spec with one function:
// "create one", "create all currently unmatched", and "create several
// selected" are all just different-length `customerNames` arrays. Each
// distinct name becomes exactly one new Customer (never one per row), and
// every row sharing that normalized name gets mapped to it in the same
// transaction — a failure partway through must not leave a customer created
// with no rows mapped to it, or vice versa.
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
        // A name that now exactly matches a real Customer (created by a
        // concurrent action, or already resolved) is skipped rather than
        // creating a duplicate company — the row should be mapped via
        // applyManualCustomerMappingAction instead in that case.
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
          const derived = deriveStatusAndWarnings(toDerivationInput(row, { customerMatchStatus: "MANUAL" }));
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

// --- Customer resolution: skip every row for a historical name --------------
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

// --- Customer resolution: accept / reject a POSSIBLE match -----------------
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
      const derived = deriveStatusAndWarnings(toDerivationInput(row, { customerMatchStatus: "MANUAL" }));
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
      const derived = deriveStatusAndWarnings(toDerivationInput({ ...row, matchedCustomerId: null }, { customerMatchStatus: "UNMATCHED" }));
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

  // Excluding a row also drops any existing selection — a row that can no
  // longer be imported at all must never stay selected (see
  // isSelectedForImport's schema comment).
  await prisma.policyImportRow.update({
    where: { id: rowId },
    data: include ? { includeInImport: true } : { includeInImport: false, isSelectedForImport: false },
  });
  return { success: true };
}

// Includes/excludes an entire POSSIBLE_DUPLICATE group at once (the row the
// user is looking at, plus every row it lists in duplicateOfRowNumbers) —
// EXACT_DUPLICATE rows are silently skipped since they can never be
// overridden (see PolicyImportRowStatus's schema comment).
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

// --- Phase 1A.2: row selection for the controlled "Import Selected"
//     workflow. Selection is a real DB column (isSelectedForImport), never
//     only React state — see that field's schema comment. Every action here
//     only ever selects rows that are CURRENTLY eligible (includeInImport
//     true, not ERROR/EXACT_DUPLICATE/IMPORTED, and not an unresolved
//     POSSIBLE customer match); nothing here forces a row into eligibility.
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

// Deterministic ordering per the spec: source sheet, then original row
// number. Replaces the current selection rather than adding to it — this is
// a "quick pick" preset, not an accumulator.
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

// --- Batch summary — shared, category-agnostic counting logic lives in
//     computeImportBatchSummary (see src/lib/policy/importBatchSummary.ts);
//     this action only supplies the Motor-specific Prisma fetch. Used both
//     as the pre-import summary and, after importing, to show what's left.
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

// --- Import Selected (Phase 1A.2) --------------------------------------------
// Replaces the earlier "confirm the whole batch" flow — only rows the user
// explicitly selected (isSelectedForImport, a persisted DB column) are ever
// imported; rows not selected simply stay in the batch, available for a
// later selected-import run (see PolicyImportBatchStatus.PARTIALLY_IMPORTED).
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

export async function importSelectedRowsAction(
  batchId: string,
  confirmedRowIds: string[]
): Promise<ActionResult<{ report: ImportResultReport }>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const batch = await prisma.policyImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { success: false, error: "BATCH_NOT_FOUND" };
  // A batch already fully COMPLETED has nothing left to import; PARTIALLY_IMPORTED,
  // PREVIEWED, and UPLOADED can all still accept another selected-import run.
  if (batch.status === "COMPLETED") return { success: false, error: "ALREADY_COMPLETED" };

  const selectedRows = await prisma.policyImportRow.findMany({
    where: { importBatchId: batchId, isSelectedForImport: true },
    orderBy: { originalRowNumber: "asc" },
  });
  if (selectedRows.length === 0) return { success: false, error: "NO_ROWS_SELECTED" };

  // Staleness gate: the confirmation dialog the user just reviewed was built
  // from a specific set of row ids — if the persisted selection has since
  // changed (another tab, a concurrent action), refuse rather than import
  // a different set than what was actually confirmed.
  const actualIds = selectedRows.map((r) => r.id).sort();
  const expectedIds = [...confirmedRowIds].sort();
  if (actualIds.length !== expectedIds.length || actualIds.some((id, i) => id !== expectedIds[i])) {
    return { success: false, error: "SELECTION_CHANGED" };
  }

  // Mandatory final gate: re-check EXACT_DUPLICATE against the database
  // right before importing, not just at upload/preview time — customer
  // mapping may have resolved rows since then, revealing collisions that
  // weren't checkable before, and another import may have landed real
  // PolicyRecords in the meantime.
  const freshExactDuplicates = await detectExactDuplicates(
    prisma,
    "MOTOR",
    selectedRows.map((r) => ({
      rowNumber: r.originalRowNumber,
      sourceSheet: batch.sourceSheet,
      registrationNumber: r.registrationNumber,
      insuranceType: r.insuranceType,
      effectiveDate: r.effectiveDate,
      expiryDate: r.expiryDate,
      matchedCustomerId: r.matchedCustomerId,
    }))
  );

  // Every selected row must currently be genuinely importable — refuse the
  // whole action rather than silently dropping any (see this phase's spec:
  // "must refuse to run when ... any selected row has ..."). Selection
  // actions only ever select eligible rows, so this only fires if something
  // changed the underlying row state after selection.
  const blocking: string[] = [];
  for (const row of selectedRows) {
    if (!row.matchedCustomerId || row.customerMatchStatus === "UNMATCHED" || row.customerMatchStatus === "POSSIBLE") {
      blocking.push(`Row ${row.originalRowNumber}: customer is not resolved.`);
    }
    if (row.status === "EXACT_DUPLICATE" || freshExactDuplicates.has(row.originalRowNumber)) {
      blocking.push(`Row ${row.originalRowNumber}: is an exact duplicate of an existing policy.`);
    }
    if (!row.registrationNumber || !row.effectiveDate || !row.expiryDate || (row.expiryDate && row.effectiveDate && row.expiryDate < row.effectiveDate)) {
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
  let customerReceiptsCreated = 0;
  let providerPaymentsCreated = 0;
  // Customers are created earlier, in the customer-resolution panel (see
  // createCustomersFromHistoricalNamesAction) — never during this import
  // step itself. Reported here as this batch's running total for context,
  // not as "created by this specific click".
  const customersCreatedForBatch = await prisma.customer.count({ where: { importBatchId: batchId } });

  try {
    for (let i = 0; i < selectedRows.length; i += IMPORT_CHUNK_SIZE) {
      const chunk = selectedRows.slice(i, i + IMPORT_CHUNK_SIZE);
      await prisma.$transaction(async (tx) => {
        for (const row of chunk) {
          const created = await importOneRow(tx, batchId, row, session.user.id);
          policiesCreated++;
          if (created.receiptCreated) customerReceiptsCreated++;
          if (created.paymentCreated) providerPaymentsCreated++;
          await tx.policyImportRow.update({
            where: { id: row.id },
            data: { status: "IMPORTED", isSelectedForImport: false },
          });
        }
      });
    }

    // Batch status: COMPLETED only once nothing eligible remains to import
    // later — otherwise PARTIALLY_IMPORTED, so the batch stays reachable for
    // another selected-import run (see this phase's spec).
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
      customerReceiptsCreated,
      providerPaymentsCreated,
      rowsImported: policiesCreated,
      rowsRemaining: summaryResult.success ? summaryResult.summary.remainingAfterLatestSelectedImport : totalRows - totalImported,
      rowsSkippedOrBlocked: summaryResult.success ? summaryResult.summary.skippedRows + summaryResult.summary.errorRows : 0,
      warnings,
    };

    revalidatePath("/policy/motor");
    return { success: true, report };
  } catch (err) {
    console.error(`Failed to import selected rows for Motor batch ${batchId}:`, err);
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
    insuranceType: string | null;
    registrationNumber: string | null;
    insurerName: string | null;
    effectiveDate: Date | null;
    expiryDate: Date | null;
    insurerCost: Prisma.Decimal | null;
    amountPaidToInsurer: Prisma.Decimal | null;
    insurerPaymentDate: Date | null;
    clientPremium: Prisma.Decimal | null;
    amountReceivedFromClient: Prisma.Decimal | null;
    clientReceiptDate: Date | null;
    vehicleValue: Prisma.Decimal | null;
    commissionReceived: boolean;
    commissionReceivedDate: Date | null;
    historicalNetProfit: Prisma.Decimal | null;
    remarks: string | null;
    insurerBalanceVerification: "VERIFIED" | "UNVERIFIED";
    insurerBalanceWarningReason: "BROKEN_SOURCE_FORMULA" | "BLANK_SOURCE_BALANCE" | "OTHER_UNREADABLE_BALANCE" | null;
    clientBalanceVerification: "VERIFIED" | "UNVERIFIED";
    clientBalanceWarningReason: "BROKEN_SOURCE_FORMULA" | "BLANK_SOURCE_BALANCE" | "OTHER_UNREADABLE_BALANCE" | null;
  },
  createdById: string
): Promise<{ receiptCreated: boolean; paymentCreated: boolean }> {
  // Every ERROR-status row (missing customer/registration/dates) is already
  // excluded by importSelectedRowsAction's validation gate — these are
  // last-resort guards, not the primary validation path.
  if (!row.matchedCustomerId || !row.registrationNumber || !row.effectiveDate || !row.expiryDate) {
    throw new Error(`Row ${row.originalRowNumber} is missing required fields at import time`);
  }

  const processingDate = row.processingDate ?? row.effectiveDate;
  const businessStatus = computeBusinessStatus(row.effectiveDate, row.expiryDate, "DRAFT");
  const recordNumber = await generatePolicyRecordNumber(tx, "MOTOR");

  const created = await tx.policyRecord.create({
    data: {
      recordNumber,
      category: "MOTOR",
      processingDate,
      customerId: row.matchedCustomerId,
      insurerName: row.insurerName,
      effectiveDate: row.effectiveDate,
      expiryDate: row.expiryDate,
      businessStatus,
      customerPremium: row.clientPremium ?? toDecimal(0),
      insurerCost: row.insurerCost ?? toDecimal(0),
      commissionReceived: row.commissionReceived,
      commissionReceivedDate: row.commissionReceivedDate,
      historicalNetProfit: row.historicalNetProfit,
      // Never silently "verified" — carried straight from the import row's
      // own balance-verification fields (see this phase's spec).
      insurerBalanceVerification: row.insurerBalanceVerification,
      insurerBalanceWarningReason: row.insurerBalanceWarningReason,
      clientBalanceVerification: row.clientBalanceVerification,
      clientBalanceWarningReason: row.clientBalanceWarningReason,
      source: "HISTORICAL_IMPORT",
      importBatchId: batchId,
      sourceSheet: MOTOR_SHEET_NAME,
      originalRowNumber: row.originalRowNumber,
      remarks: row.remarks,
      createdById,
      motorDetail: {
        create: {
          insuranceType: row.insuranceType ?? "UNKNOWN",
          registrationNumber: row.registrationNumber.toUpperCase(),
          vehicleValue: row.vehicleValue,
          // Phase 2B: taxClass intentionally omitted — the historical
          // BUSINESS RECORD(MOTOR) workbook has no column that reliably maps
          // to Private/Commercial/SPV/Special Use (see motorImportParser.ts's
          // EXPECTED_HEADERS), so every imported row leaves this null rather
          // than guessing from TYPE OF COVER or anything else. If a future
          // workbook revision adds a real, unambiguous source column, map it
          // here explicitly — never infer it.
        },
      },
    },
  });

  await recordPolicyActivity(tx, {
    policyRecordId: created.id,
    actionType: "HISTORICAL_POLICY_IMPORTED",
    summary: `Motor policy ${recordNumber} imported from historical data`,
    performedById: createdById,
  });

  let paymentCreated = false;
  if (row.amountPaidToInsurer && Number(row.amountPaidToInsurer) > 0) {
    await tx.policyProviderPayment.create({
      data: {
        policyRecordId: created.id,
        paymentDate: row.insurerPaymentDate ?? processingDate,
        amount: row.amountPaidToInsurer,
        source: "HISTORICAL_IMPORT",
        originalRowNumber: row.originalRowNumber,
        createdById,
      },
    });
    paymentCreated = true;
  }

  let receiptCreated = false;
  if (row.amountReceivedFromClient && Number(row.amountReceivedFromClient) > 0) {
    await tx.policyCustomerReceipt.create({
      data: {
        policyRecordId: created.id,
        receiptDate: row.clientReceiptDate ?? processingDate,
        amount: row.amountReceivedFromClient,
        source: "HISTORICAL_IMPORT",
        originalRowNumber: row.originalRowNumber,
        createdById,
      },
    });
    receiptCreated = true;
  }

  return { receiptCreated, paymentCreated };
}
