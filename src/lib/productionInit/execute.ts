// Production Initialization — the actual deletion. See the schema's own
// doc comment on SystemInitializationLog for the feature's purpose.
//
// Deletion order (derived from this schema's REAL onDelete relations, not
// assumed — see the Phase-8.x audit this feature was built from):
//   1. MotorClaim / NonMotorClaim  — cascade participants/updates/documents/
//      dropbox rows; must precede Customer/CustomerProject (Restrict).
//   2. Task                        — cascade participants/steps. No FK to
//      Customer at all; deleted regardless of category (DAILY_TASK and any
//      legacy MOTOR_CLAIM/NON_MOTOR_CLAIM rows predating the dedicated
//      Claim models — see this feature's audit, Part 8 risk #4).
//   3. Invoice                     — cascade InvoiceItem/DropboxBusinessFile/
//      DocumentDropboxSync. MUST precede PolicyRecord: InvoiceItem ->
//      PolicyRecord is onDelete: Restrict.
//   4. PolicyRecord                — cascade all 4 category detail models,
//      CustomerReceipt/ProviderPayment/Document/Activity/DropboxSync. Must
//      precede Customer/CustomerProject (Restrict).
//   5. QuotationCase                — cascade every Quotation revision and
//      its sections/detail rows, QuotationCaseActivity, QuotationDocument,
//      QuotationDropboxBusinessFile/Version. Must precede Customer/
//      CustomerProject (Restrict).
//   6. PolicyImportBatch            — cascade PolicyImportRow. References
//      Customer/PolicyRecord only via onDelete: SetNull, so order relative
//      to them doesn't matter for correctness; placed after both anyway.
//   7. Customer                     — LAST. Cascades CustomerProject/
//      CustomerDocument/CustomerDropboxFolder/CustomerDocumentDropboxSync.
//      Safe only once every Restrict-referencing model above is gone.
//   8. LedgerManualEntry            — no FK to any of the above at all;
//      order-independent, placed last for clarity.
//   9. The five *NumberCounter tables — row data cleared, tables kept.
//
// Never touched: User, SystemSettings, DropboxIntegration,
// DropboxNamespaceConfig, InsuranceType, LedgerCategory,
// DropboxMigrationJob, DropboxMigrationObjectLedger, SystemInitializationLog
// itself, and (this module never imports any Dropbox SDK client at all, so
// it is structurally incapable of calling a Dropbox delete API — verified
// by this file having zero import from src/lib/integrations/dropbox/service
// or any *DocumentSync module).
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { getProductionInitializationPreview } from "./preview";
import { getProductionInitializationStatus } from "./status";
import { ADVISORY_LOCK_KEY, CONFIRMATION_TEXT, COOLDOWN_MS, STALE_RUNNING_THRESHOLD_MS, isProductionInitializationEnabled, isValidProductionInitReason } from "./constants";
import { SYSTEM_SETTINGS_ID } from "@/lib/settings/constants";
import { DROPBOX_INTEGRATION_ID, DROPBOX_NAMESPACE_CONFIG_ID } from "@/lib/integrations/dropbox/constants";
import packageJson from "../../../package.json";
import type { Prisma } from "@/generated/prisma/client";
import type { ProductionInitDeleteCounts, ProductionInitPreservedCounts } from "./types";

export type ExecuteProductionInitializationInput = {
  confirmationText: string;
  backupConfirmed: boolean;
  // Raw, unvalidated client input — checked against PRODUCTION_INIT_REASONS
  // below, never trusted or stored as-is if it fails that check. Purely
  // descriptive: never read by the deletion/rollback logic itself.
  reason: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  // Injectable for tests only (Part 9: "不要让自动化测试真实等待24小时") —
  // production callers always omit this and get the real current time.
  now?: Date;
};

export type ExecuteProductionInitializationSuccess = {
  success: true;
  deletedCounts: ProductionInitDeleteCounts;
  preservedCountsAfter: ProductionInitPreservedCounts;
  startedAt: string;
  completedAt: string;
  nextAvailableAt: string;
  dropboxConnectionStatus: string;
};

export type ExecuteProductionInitializationFailure = {
  success: false;
  error: "DISABLED" | "FORBIDDEN" | "INVALID_CONFIRMATION" | "BACKUP_NOT_CONFIRMED" | "INVALID_REASON" | "ALREADY_RUNNING" | "COOLDOWN_ACTIVE" | "TRANSACTION_FAILED";
  message: string;
  nextAvailableAt?: string;
};

export type ExecuteProductionInitializationResult = ExecuteProductionInitializationSuccess | ExecuteProductionInitializationFailure;

class AlreadyRunningError extends Error {}
class PreservedDataMismatchError extends Error {
  constructor(public readonly field: string) {
    super(`Preserved data mismatch: ${field}`);
  }
}

// Snapshot of preserved-data counts/existence, read the SAME way both
// before and after deletion (Part 12) — deliberately excludes any field
// that legitimately changes on its own (updatedAt, connection status,
// token values) so this can never fail just because an unrelated admin
// action (e.g. testing the Dropbox connection) happened around the same
// time; only COUNT and EXISTENCE are asserted equal.
async function snapshotPreserved(client: Prisma.TransactionClient): Promise<ProductionInitPreservedCounts> {
  const [users, systemSettings, dropboxIntegration, dropboxNamespaceConfig, insuranceTypes, ledgerCategories, dropboxMigrationJobs, dropboxMigrationObjectLedgers] = await Promise.all([
    client.user.count(),
    client.systemSettings.findUnique({ where: { id: SYSTEM_SETTINGS_ID }, select: { id: true } }),
    client.dropboxIntegration.findUnique({ where: { id: DROPBOX_INTEGRATION_ID }, select: { id: true } }),
    client.dropboxNamespaceConfig.findUnique({ where: { id: DROPBOX_NAMESPACE_CONFIG_ID }, select: { id: true } }),
    client.insuranceType.count(),
    client.ledgerCategory.count(),
    client.dropboxMigrationJob.count(),
    client.dropboxMigrationObjectLedger.count(),
  ]);
  return {
    users,
    systemSettingsExists: !!systemSettings,
    dropboxIntegrationExists: !!dropboxIntegration,
    dropboxNamespaceConfigExists: !!dropboxNamespaceConfig,
    insuranceTypes,
    ledgerCategories,
    dropboxMigrationJobs,
    dropboxMigrationObjectLedgers,
  };
}

function assertPreservedUnchanged(before: ProductionInitPreservedCounts, after: ProductionInitPreservedCounts) {
  if (after.users !== before.users) throw new PreservedDataMismatchError("User");
  if (after.insuranceTypes !== before.insuranceTypes) throw new PreservedDataMismatchError("InsuranceType");
  if (after.ledgerCategories !== before.ledgerCategories) throw new PreservedDataMismatchError("LedgerCategory");
  if (after.dropboxMigrationJobs !== before.dropboxMigrationJobs) throw new PreservedDataMismatchError("DropboxMigrationJob");
  if (after.dropboxMigrationObjectLedgers !== before.dropboxMigrationObjectLedgers) throw new PreservedDataMismatchError("DropboxMigrationObjectLedger");
  if (!after.systemSettingsExists) throw new PreservedDataMismatchError("SystemSettings");
  if (!after.dropboxIntegrationExists) throw new PreservedDataMismatchError("DropboxIntegration");
  if (!after.dropboxNamespaceConfigExists) throw new PreservedDataMismatchError("DropboxNamespaceConfig");
}

// Acquires the mutex and creates the RUNNING audit row, inside one short
// transaction. The Postgres advisory xact lock only needs to protect THIS
// check-then-insert critical section — once committed, the persisted
// RUNNING row itself is what every subsequent request's status check sees,
// so the lock can safely auto-release at commit (Part 8: no manual
// release/no stale-session-lock risk, since it's never held across the
// long deletion transaction that follows).
async function acquireRunningLog(userId: string, userName: string, reason: string, ipAddress: string | null, userAgent: string | null, now: Date): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}::bigint) AS acquired`;
    if (!lockRows[0]?.acquired) throw new AlreadyRunningError();

    const running = await tx.systemInitializationLog.findFirst({ where: { status: "RUNNING" }, orderBy: { startedAt: "desc" } });
    if (running) {
      const ageMs = now.getTime() - running.startedAt.getTime();
      if (ageMs < STALE_RUNNING_THRESHOLD_MS) {
        throw new AlreadyRunningError();
      }
      // Part 17: a stale RUNNING row (crashed process / killed container)
      // must never permanently lock this feature out — auto-fail it and
      // proceed, still inside the advisory-lock-protected section so this
      // can't race with another request doing the same thing.
      await tx.systemInitializationLog.update({
        where: { id: running.id },
        data: { status: "FAILED", completedAt: now, errorSummary: "Superseded: the previous run exceeded its expected duration and was automatically marked as failed." },
      });
    }

    const created = await tx.systemInitializationLog.create({
      data: {
        executedByUserId: userId,
        executedByNameSnapshot: userName,
        status: "RUNNING",
        startedAt: now,
        reason,
        ipAddress: ipAddress ?? undefined,
        userAgent: userAgent ?? undefined,
        appVersion: packageJson.version,
      },
    });
    return created.id;
  });
}

export async function runProductionInitialization(input: ExecuteProductionInitializationInput): Promise<ExecuteProductionInitializationResult> {
  // 1. Feature flag — checked first and independently of everything else,
  // so a disabled deployment never leaks whether the caller is even an
  // admin (Part 3: "环境变量关闭时，应优先返回功能不可用，不暴露相关业务实现细节").
  if (!isProductionInitializationEnabled()) {
    return { success: false, error: "DISABLED", message: "Production Initialization is not enabled on this deployment." };
  }

  // 2. Admin re-verification — never trust that the route handler alone
  // gated this (this codebase's established convention, see e.g.
  // deletePolicyRecord).
  const session = await requireAdmin();
  if (!session) {
    return { success: false, error: "FORBIDDEN", message: "Administrator privileges are required." };
  }

  // 3. Strict confirmation — exact match only, never trimmed/normalized.
  if (input.confirmationText !== CONFIRMATION_TEXT) {
    return { success: false, error: "INVALID_CONFIRMATION", message: "The confirmation text does not match exactly." };
  }
  if (input.backupConfirmed !== true) {
    return { success: false, error: "BACKUP_NOT_CONFIRMED", message: "You must confirm the production database has been backed up." };
  }
  if (!isValidProductionInitReason(input.reason)) {
    return { success: false, error: "INVALID_REASON", message: "A valid reason must be selected." };
  }
  const reason = input.reason;

  const now = input.now ?? new Date();

  // 4. Cooldown — checked before attempting the mutex, so a cooldown-
  // blocked request never creates/touches a RUNNING row at all.
  const status = await getProductionInitializationStatus(now);
  if (status.cooldownUntil) {
    return {
      success: false,
      error: "COOLDOWN_ACTIVE",
      message: "Production Initialization was run recently and is in its 24-hour cooldown period.",
      nextAvailableAt: status.cooldownUntil,
    };
  }

  const userId = session.user.id;
  const userName = session.user.name || session.user.username;

  // 5. Acquire the mutex / create the RUNNING audit row.
  let logId: string;
  try {
    logId = await acquireRunningLog(userId, userName, reason, input.ipAddress, input.userAgent, now);
  } catch (err) {
    if (err instanceof AlreadyRunningError) {
      return { success: false, error: "ALREADY_RUNNING", message: "A Production Initialization is already in progress." };
    }
    console.error("[production-init] failed to acquire run lock", err);
    return { success: false, error: "TRANSACTION_FAILED", message: "Could not start Production Initialization. Please try again." };
  }

  // 6. The actual deletion + preserved-data verification, in its own
  // transaction — deliberately separate from the acquire step above so the
  // RUNNING row (and the audit trail of ever having started) survives even
  // if this transaction fails and rolls back every business-data delete.
  try {
    const { deletedCounts, preservedCountsBefore, preservedCountsAfter } = await prisma.$transaction(
      async (tx) => {
        const preview = await getProductionInitializationPreview(tx);
        const preservedBefore = preview.toPreserve;

        await tx.motorClaim.deleteMany({});
        await tx.nonMotorClaim.deleteMany({});
        await tx.task.deleteMany({});
        await tx.invoice.deleteMany({});
        await tx.policyRecord.deleteMany({});
        await tx.quotationCase.deleteMany({});
        await tx.policyImportBatch.deleteMany({});
        await tx.customer.deleteMany({});
        await tx.ledgerManualEntry.deleteMany({});
        await tx.quotationNumberCounter.deleteMany({});
        await tx.policyRecordNumberCounter.deleteMany({});
        await tx.invoiceNumberCounter.deleteMany({});
        await tx.motorClaimNumberCounter.deleteMany({});
        await tx.nonMotorClaimNumberCounter.deleteMany({});

        const preservedAfter = await snapshotPreserved(tx);
        assertPreservedUnchanged(preservedBefore, preservedAfter);

        return { deletedCounts: preview.toDelete, preservedCountsBefore: preservedBefore, preservedCountsAfter: preservedAfter };
      },
      { timeout: 120_000, maxWait: 15_000 }
    );

    const completedAt = new Date();
    const nextAvailableAt = new Date(completedAt.getTime() + COOLDOWN_MS);
    const dropboxIntegration = await prisma.dropboxIntegration.findUnique({ where: { id: DROPBOX_INTEGRATION_ID }, select: { status: true } });

    await prisma.systemInitializationLog.update({
      where: { id: logId },
      data: {
        status: "SUCCESS",
        completedAt,
        deletedCounts: deletedCounts as unknown as Prisma.InputJsonValue,
        preservedCountsBefore: preservedCountsBefore as unknown as Prisma.InputJsonValue,
        preservedCountsAfter: preservedCountsAfter as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      success: true,
      deletedCounts,
      preservedCountsAfter,
      startedAt: now.toISOString(),
      completedAt: completedAt.toISOString(),
      nextAvailableAt: nextAvailableAt.toISOString(),
      dropboxConnectionStatus: dropboxIntegration?.status ?? "UNKNOWN",
    };
  } catch (err) {
    // Full technical detail to server logs only — never into the DB or the
    // HTTP response (Part 14/17).
    console.error("[production-init] deletion transaction failed and was rolled back", err);
    const safeSummary = err instanceof PreservedDataMismatchError ? `Preserved configuration check failed (${err.field}) — all business data changes were rolled back.` : "Business data deletion failed and was fully rolled back.";

    // Deliberately outside the failed transaction (which already rolled
    // back every business-data delete) — this update must survive so the
    // audit trail records the failure (Part 9/14).
    await prisma.systemInitializationLog.update({
      where: { id: logId },
      data: { status: "FAILED", completedAt: new Date(), errorSummary: safeSummary },
    });

    return { success: false, error: "TRANSACTION_FAILED", message: safeSummary };
  }
}
