// Production Initialization — Phase 7 Part C: Selective (per-module)
// execution. Reuses the exact same safety machinery as the existing
// all-or-nothing runProductionInitialization (feature flag, Admin
// re-verification, exact confirmation text, backup checkbox, reason
// whitelist, 24h cooldown, Postgres advisory mutex, RUNNING/SUCCESS/FAILED
// audit trail via SystemInitializationLog) — deliberately NOT by importing
// from execute.ts (that file is left completely untouched, per this phase's
// "不要改坏已验证通过的功能"), but by re-implementing the same small
// acquire-mutex helper here. This is an intentional, documented duplication
// (~30 lines) rather than a shared refactor, to keep the blast radius of
// this change at zero for the already-audited, already-tested full-wipe
// path.
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/authz";
import { isAdminRole } from "@/lib/permissions";
import { getProductionInitializationStatus } from "./status";
import { isModuleAvailable, type InitializationModule, type DependencyViolation } from "./modules";
import { validateInitializationSelection } from "./validateSelection";
import { ADVISORY_LOCK_KEY, CONFIRMATION_TEXT, COOLDOWN_MS, STALE_RUNNING_THRESHOLD_MS, isProductionInitializationEnabled, isValidProductionInitReason } from "./constants";
import packageJson from "../../../package.json";
import type { Prisma } from "@/generated/prisma/client";
import type { ProductionInitDeleteCounts } from "./types";

export type ExecuteSelectiveInitializationInput = {
  modules: unknown; // raw client input — validated below, never trusted as InitializationModule[] as-is
  confirmationText: string;
  backupConfirmed: boolean;
  reason: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  now?: Date;
};

export type ExecuteSelectiveInitializationSuccess = {
  success: true;
  modules: InitializationModule[];
  deletedCounts: ProductionInitDeleteCounts;
  usersDeleted: number;
  startedAt: string;
  completedAt: string;
  nextAvailableAt: string;
};

export type ExecuteSelectiveInitializationFailure =
  | { success: false; error: "DISABLED" | "FORBIDDEN" | "INVALID_CONFIRMATION" | "BACKUP_NOT_CONFIRMED" | "INVALID_REASON" | "ALREADY_RUNNING" | "COOLDOWN_ACTIVE" | "TRANSACTION_FAILED"; message: string; nextAvailableAt?: string }
  | { success: false; error: "NO_MODULES_SELECTED" | "INVALID_MODULE" | "MODULE_UNAVAILABLE"; message: string }
  | { success: false; error: "DEPENDENCY_VIOLATION"; message: string; violations: DependencyViolation[] };

export type ExecuteSelectiveInitializationResult = ExecuteSelectiveInitializationSuccess | ExecuteSelectiveInitializationFailure;

const VALID_MODULES: InitializationModule[] = ["CUSTOMER", "QUOTATION", "POLICY", "INVOICE", "LEDGER", "TASK", "REMINDER", "USERS", "SETTINGS"];

function parseModules(raw: unknown): InitializationModule[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const unique = Array.from(new Set(raw));
  for (const m of unique) {
    if (typeof m !== "string" || !VALID_MODULES.includes(m as InitializationModule)) return null;
  }
  return unique as InitializationModule[];
}

class AlreadyRunningError extends Error {}

// Identical structure to execute.ts's own acquireRunningLog — see that
// file's doc comment for the full rationale (short transaction, advisory
// xact lock auto-releases at commit, stale RUNNING rows auto-fail rather
// than permanently locking the feature out). Shares the SAME
// ADVISORY_LOCK_KEY, so a full-wipe run and a selective run can never race
// each other — only one Production Initialization of either kind runs at a
// time.
async function acquireRunningLog(userId: string, userName: string, reason: string, ipAddress: string | null, userAgent: string | null, now: Date): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}::bigint) AS acquired`;
    if (!lockRows[0]?.acquired) throw new AlreadyRunningError();

    const running = await tx.systemInitializationLog.findFirst({ where: { status: "RUNNING" }, orderBy: { startedAt: "desc" } });
    if (running) {
      const ageMs = now.getTime() - running.startedAt.getTime();
      if (ageMs < STALE_RUNNING_THRESHOLD_MS) throw new AlreadyRunningError();
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

// Deletes every User row EXCEPT Admin-role accounts (any status) — see
// modules.ts's own doc comment and this phase's spec, Part 八: "Users 默认
// 不勾选... 保留 protected administrator accounts". Because
// runSelectiveProductionInitialization requires requireAdmin() before this
// is ever reached, the acting caller is themselves an Admin, so at least one
// Admin (the caller) is always excluded — this never depends on which row
// happens to be "first"/"last"; every Admin-role row survives, full stop.
// No relation in this schema references User via a real FK (every
// reference — createdById, performedById, executedByUserId, ... — is a
// plain unenforced id string, this codebase's deliberate convention), so
// this delete is unconditionally FK-safe regardless of order.
async function deleteNonAdminUsers(tx: Prisma.TransactionClient): Promise<number> {
  const users = await tx.user.findMany({ select: { id: true, role: true } });
  const nonAdminIds = users.filter((u) => !isAdminRole(u.role)).map((u) => u.id);
  if (nonAdminIds.length === 0) return 0;
  const result = await tx.user.deleteMany({ where: { id: { in: nonAdminIds } } });
  return result.count;
}

function emptyDeleteCounts(): ProductionInitDeleteCounts {
  return {
    customers: 0,
    customerProjects: 0,
    customerDocuments: 0,
    quotationCases: 0,
    quotationRevisions: 0,
    policies: 0,
    invoices: 0,
    tasks: 0,
    motorClaims: 0,
    nonMotorClaims: 0,
    manualLedgerEntries: 0,
    policyImportBatches: 0,
    policyImportRows: 0,
    quotationDocuments: 0,
    policyDocuments: 0,
    motorClaimDocuments: 0,
    nonMotorClaimDocuments: 0,
    businessDocumentRecordsTotal: 0,
    dropboxMappingRecords: 0,
    numberCounterRows: 0,
  };
}

export async function runSelectiveProductionInitialization(input: ExecuteSelectiveInitializationInput): Promise<ExecuteSelectiveInitializationResult> {
  if (!isProductionInitializationEnabled()) {
    return { success: false, error: "DISABLED", message: "Production Initialization is not enabled on this deployment." };
  }

  const session = await requireAdmin();
  if (!session) {
    return { success: false, error: "FORBIDDEN", message: "Administrator privileges are required." };
  }

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

  const modules = parseModules(input.modules);
  if (!modules) {
    return { success: false, error: "NO_MODULES_SELECTED", message: "Select at least one module to initialize." };
  }
  const unavailable = modules.find((m) => !isModuleAvailable(m));
  if (unavailable) {
    return { success: false, error: "MODULE_UNAVAILABLE", message: `${unavailable} is not available for selective initialization.` };
  }

  const now = input.now ?? new Date();

  const status = await getProductionInitializationStatus(now);
  if (status.cooldownUntil) {
    return { success: false, error: "COOLDOWN_ACTIVE", message: "Production Initialization was run recently and is in its 24-hour cooldown period.", nextAvailableAt: status.cooldownUntil };
  }

  // Server-side dependency validation BEFORE ever acquiring the mutex/
  // creating a RUNNING row — a rejected selection must never touch the
  // audit trail or block a later legitimate run (this phase's spec, Part
  // 十一: "Server-side dependency validation — 不只靠前端 checkbox"). Re-run
  // again, authoritatively, inside the deletion transaction below under the
  // row lock, since data can change between this check and execution.
  const preValidation = await validateInitializationSelection(new Set(modules));
  if (!preValidation.ok) {
    return { success: false, error: "DEPENDENCY_VIOLATION", message: "The selected modules have unresolved dependencies.", violations: preValidation.violations };
  }

  const userId = session.user.id;
  const userName = session.user.name || session.user.username;

  let logId: string;
  try {
    logId = await acquireRunningLog(userId, userName, reason, input.ipAddress, input.userAgent, now);
  } catch (err) {
    if (err instanceof AlreadyRunningError) {
      return { success: false, error: "ALREADY_RUNNING", message: "A Production Initialization is already in progress." };
    }
    console.error("[production-init-selective] failed to acquire run lock", err);
    return { success: false, error: "TRANSACTION_FAILED", message: "Could not start Production Initialization. Please try again." };
  }

  try {
    const { deletedCounts, usersDeleted } = await prisma.$transaction(
      async (tx) => {
        // Authoritative re-check, fresh, under the same advisory-lock-
        // protected window every subsequent request serializes behind (see
        // acquireRunningLog) — never trusts the pre-check above alone.
        const revalidation = await validateInitializationSelection(new Set(modules), tx);
        if (!revalidation.ok) {
          throw new DependencyViolationError(revalidation.violations);
        }

        const selected = new Set(modules);
        const counts = emptyDeleteCounts();
        let usersDeletedCount = 0;

        // Deletion order mirrors execute.ts's own audited order exactly —
        // downstream (Restrict-referencing) tables first, Customer last —
        // just conditional on which modules were actually selected. USERS
        // has zero FK dependency on anything (see deleteNonAdminUsers's own
        // doc comment) so its position doesn't matter; placed last for
        // clarity.
        if (selected.has("TASK")) {
          const [motor, nonMotor, task] = await Promise.all([tx.motorClaim.deleteMany({}), tx.nonMotorClaim.deleteMany({}), tx.task.deleteMany({})]);
          counts.motorClaims = motor.count;
          counts.nonMotorClaims = nonMotor.count;
          counts.tasks = task.count;
        }
        if (selected.has("INVOICE")) {
          const invoice = await tx.invoice.deleteMany({});
          counts.invoices = invoice.count;
          await tx.invoiceNumberCounter.deleteMany({});
        }
        if (selected.has("POLICY")) {
          const [policy, importRows, importBatches] = await Promise.all([tx.policyRecord.deleteMany({}), tx.policyImportRow.deleteMany({}), tx.policyImportBatch.deleteMany({})]);
          counts.policies = policy.count;
          counts.policyImportRows = importRows.count;
          counts.policyImportBatches = importBatches.count;
          await tx.policyRecordNumberCounter.deleteMany({});
        }
        if (selected.has("QUOTATION")) {
          const quotationRevisions = await tx.quotation.count();
          const quotationCase = await tx.quotationCase.deleteMany({});
          counts.quotationCases = quotationCase.count;
          counts.quotationRevisions = quotationRevisions;
          await tx.quotationNumberCounter.deleteMany({});
        }
        if (selected.has("CUSTOMER")) {
          const customer = await tx.customer.deleteMany({});
          counts.customers = customer.count;
        }
        if (selected.has("LEDGER")) {
          const ledger = await tx.ledgerManualEntry.deleteMany({});
          counts.manualLedgerEntries = ledger.count;
        }
        if (selected.has("USERS")) {
          usersDeletedCount = await deleteNonAdminUsers(tx);
        }
        // REMINDER: nothing to delete (no persisted table — see modules.ts).
        // SETTINGS: rejected earlier by the isModuleAvailable() check; never
        // reachable here.

        return { deletedCounts: counts, usersDeleted: usersDeletedCount };
      },
      { timeout: 120_000, maxWait: 15_000 }
    );

    const completedAt = new Date();
    const nextAvailableAt = new Date(completedAt.getTime() + COOLDOWN_MS);

    await prisma.systemInitializationLog.update({
      where: { id: logId },
      data: {
        status: "SUCCESS",
        completedAt,
        // Extra `selectiveModules`/`usersDeleted` keys alongside the
        // standard ProductionInitDeleteCounts fields — the existing
        // status.ts cast (`as ProductionInitDeleteCounts`) simply ignores
        // unknown JSON keys, so the full-wipe's own "Last Initialization"
        // card continues to render correctly and unmodified for either
        // kind of run; this selective feature's own history view (Part C
        // UI) reads the extra keys directly.
        deletedCounts: { ...deletedCounts, selectiveModules: modules, usersDeleted } as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      success: true,
      modules,
      deletedCounts,
      usersDeleted,
      startedAt: now.toISOString(),
      completedAt: completedAt.toISOString(),
      nextAvailableAt: nextAvailableAt.toISOString(),
    };
  } catch (err) {
    if (err instanceof DependencyViolationError) {
      console.error("[production-init-selective] dependency revalidation failed under lock", err.violations);
      await prisma.systemInitializationLog.update({
        where: { id: logId },
        data: { status: "FAILED", completedAt: new Date(), errorSummary: "Dependency validation failed during execution — all changes were rolled back." },
      });
      return { success: false, error: "DEPENDENCY_VIOLATION", message: "The selected modules have unresolved dependencies.", violations: err.violations };
    }

    console.error("[production-init-selective] deletion transaction failed and was rolled back", err);
    await prisma.systemInitializationLog.update({
      where: { id: logId },
      data: { status: "FAILED", completedAt: new Date(), errorSummary: "Selective business data deletion failed and was fully rolled back." },
    });
    return { success: false, error: "TRANSACTION_FAILED", message: "Selective business data deletion failed and was fully rolled back." };
  }
}

class DependencyViolationError extends Error {
  constructor(public readonly violations: DependencyViolation[]) {
    super("Dependency validation failed");
  }
}
