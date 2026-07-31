import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Shared mutable test state (see vitest's vi.mock hoisting: the mock
// factories below close over these `let` bindings by reference, matching
// this project's established convention — see e.g.
// src/lib/integrations/dropbox/__tests__/customerDocumentSync.test.ts). ---

type LogRow = {
  id: string;
  executedByUserId: string;
  executedByNameSnapshot: string;
  status: "RUNNING" | "SUCCESS" | "FAILED";
  startedAt: Date;
  completedAt: Date | null;
  deletedCounts: unknown;
  preservedCountsBefore: unknown;
  preservedCountsAfter: unknown;
  errorSummary: string | null;
  reason: string | null;
};

let logs: LogRow[];
let logIdSeq: number;
let lockAcquired: boolean;
let callOrder: string[];
let deleteManyThrows: string | null;
// [before, after] — a test can make the "after" value differ to simulate
// an unexpected preserved-data drop mid-transaction.
let userCounts: [number, number];
let insuranceTypeCounts: [number, number];
let ledgerCategoryCounts: [number, number];
let migrationJobCounts: [number, number];
let migrationObjectCounts: [number, number];
let settingsExistsAfter: boolean;
let dropboxIntegrationExistsAfter: boolean;
let namespaceConfigExistsAfter: boolean;
let dropboxStatus: string;
let countCallIndex: Record<string, number>;

function resetState() {
  logs = [];
  logIdSeq = 0;
  lockAcquired = true;
  callOrder = [];
  deleteManyThrows = null;
  userCounts = [4, 4];
  insuranceTypeCounts = [20, 20];
  ledgerCategoryCounts = [6, 6];
  migrationJobCounts = [2, 2];
  migrationObjectCounts = [50, 50];
  settingsExistsAfter = true;
  dropboxIntegrationExistsAfter = true;
  namespaceConfigExistsAfter = true;
  dropboxStatus = "CONNECTED";
  countCallIndex = {};
}

function nextCount(key: string, seq: [number, number]): number {
  const i = countCallIndex[key] ?? 0;
  countCallIndex[key] = i + 1;
  return i === 0 ? seq[0] : seq[1];
}

function deleteManyDelegate(modelName: string) {
  return {
    deleteMany: vi.fn(async () => {
      callOrder.push(modelName);
      if (deleteManyThrows === modelName) throw new Error(`simulated failure deleting ${modelName}`);
      return { count: 1 };
    }),
    count: vi.fn(async () => 1),
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(async () => [{ acquired: lockAcquired }]),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockTx)),
    systemInitializationLog: {
      findFirst: vi.fn(async ({ where, orderBy }: { where?: { status?: string }; orderBy?: { startedAt?: string; completedAt?: string } }) => {
        let candidates = logs;
        if (where?.status) candidates = candidates.filter((l) => l.status === where.status);
        if (candidates.length === 0) return null;
        const key = orderBy?.completedAt ? "completedAt" : "startedAt";
        return [...candidates].sort((a, b) => {
          const av = (a[key as "startedAt" | "completedAt"] as Date | null)?.getTime() ?? 0;
          const bv = (b[key as "startedAt" | "completedAt"] as Date | null)?.getTime() ?? 0;
          return bv - av;
        })[0];
      }),
      create: vi.fn(async ({ data }: { data: Partial<LogRow> }) => {
        logIdSeq++;
        const row: LogRow = {
          id: `log-${logIdSeq}`,
          executedByUserId: data.executedByUserId!,
          executedByNameSnapshot: data.executedByNameSnapshot!,
          status: (data.status as LogRow["status"]) ?? "RUNNING",
          startedAt: (data.startedAt as Date) ?? new Date(),
          completedAt: (data.completedAt as Date) ?? null,
          deletedCounts: data.deletedCounts ?? null,
          preservedCountsBefore: data.preservedCountsBefore ?? null,
          preservedCountsAfter: data.preservedCountsAfter ?? null,
          errorSummary: (data.errorSummary as string) ?? null,
          reason: (data.reason as string) ?? null,
        };
        logs.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<LogRow> }) => {
        const row = logs.find((l) => l.id === where.id);
        if (!row) throw new Error("log not found");
        Object.assign(row, data);
        return row;
      }),
    },
    motorClaim: deleteManyDelegate("motorClaim"),
    nonMotorClaim: deleteManyDelegate("nonMotorClaim"),
    task: deleteManyDelegate("task"),
    invoice: deleteManyDelegate("invoice"),
    policyRecord: deleteManyDelegate("policyRecord"),
    quotationCase: deleteManyDelegate("quotationCase"),
    policyImportBatch: deleteManyDelegate("policyImportBatch"),
    customer: deleteManyDelegate("customer"),
    ledgerManualEntry: deleteManyDelegate("ledgerManualEntry"),
    quotationNumberCounter: deleteManyDelegate("quotationNumberCounter"),
    policyRecordNumberCounter: deleteManyDelegate("policyRecordNumberCounter"),
    invoiceNumberCounter: deleteManyDelegate("invoiceNumberCounter"),
    motorClaimNumberCounter: deleteManyDelegate("motorClaimNumberCounter"),
    nonMotorClaimNumberCounter: deleteManyDelegate("nonMotorClaimNumberCounter"),
    // Every other model the preview snapshot reads — plain counters, no
    // deleteMany expected to ever be called on these.
    customerProject: { count: vi.fn(async () => 1) },
    customerDocument: { count: vi.fn(async () => 1) },
    quotation: { count: vi.fn(async () => 1) },
    quotationDocument: { count: vi.fn(async () => 1) },
    policyDocument: { count: vi.fn(async () => 1) },
    motorClaimDocument: { count: vi.fn(async () => 1) },
    nonMotorClaimDocument: { count: vi.fn(async () => 1) },
    policyImportRow: { count: vi.fn(async () => 1) },
    customerDropboxFolder: { count: vi.fn(async () => 1) },
    customerDocumentDropboxSync: { count: vi.fn(async () => 1) },
    quotationDropboxBusinessFile: { count: vi.fn(async () => 1) },
    quotationDropboxVersion: { count: vi.fn(async () => 1) },
    policyDropboxBusinessFile: { count: vi.fn(async () => 1) },
    policyDocumentDropboxSync: { count: vi.fn(async () => 1) },
    invoiceDropboxBusinessFile: { count: vi.fn(async () => 1) },
    invoiceDocumentDropboxSync: { count: vi.fn(async () => 1) },
    motorClaimDropboxBusinessFile: { count: vi.fn(async () => 1) },
    nonMotorClaimDropboxBusinessFile: { count: vi.fn(async () => 1) },
    motorClaimDocumentDropboxSync: { count: vi.fn(async () => 1) },
    nonMotorClaimDocumentDropboxSync: { count: vi.fn(async () => 1) },
    user: { count: vi.fn(async () => nextCount("user", userCounts)) },
    insuranceType: { count: vi.fn(async () => nextCount("insuranceType", insuranceTypeCounts)) },
    ledgerCategory: { count: vi.fn(async () => nextCount("ledgerCategory", ledgerCategoryCounts)) },
    dropboxMigrationJob: { count: vi.fn(async () => nextCount("dropboxMigrationJob", migrationJobCounts)) },
    dropboxMigrationObjectLedger: { count: vi.fn(async () => nextCount("dropboxMigrationObjectLedger", migrationObjectCounts)) },
    systemSettings: {
      findUnique: vi.fn(async () => {
        const i = (countCallIndex.systemSettings ?? 0) + 1;
        countCallIndex.systemSettings = i;
        return i === 1 ? { id: "singleton" } : settingsExistsAfter ? { id: "singleton" } : null;
      }),
    },
    dropboxIntegration: {
      findUnique: vi.fn(async ({ select }: { select?: { status?: boolean } }) => {
        if (select?.status) return { status: dropboxStatus };
        const i = (countCallIndex.dropboxIntegration ?? 0) + 1;
        countCallIndex.dropboxIntegration = i;
        return i === 1 ? { id: "singleton" } : dropboxIntegrationExistsAfter ? { id: "singleton" } : null;
      }),
    },
    dropboxNamespaceConfig: {
      findUnique: vi.fn(async () => {
        const i = (countCallIndex.dropboxNamespaceConfig ?? 0) + 1;
        countCallIndex.dropboxNamespaceConfig = i;
        return i === 1 ? { id: "singleton" } : namespaceConfigExistsAfter ? { id: "singleton" } : null;
      }),
    },
  },
}));

// mockTx is just the same object as prisma's exported mock — the tests
// here aren't exercising real transactional isolation (that's a Postgres
// guarantee, verified separately by this feature's schema audit — see
// execute.ts's own doc comment for the full onDelete Restrict/Cascade/
// SetNull reasoning), only the application-level call order and logic.
import { prisma as mockTx } from "@/lib/prisma";

const requireAdminMock = vi.fn();
vi.mock("@/lib/authz", () => ({ requireAdmin: (...args: unknown[]) => requireAdminMock(...args) }));

const ADMIN_SESSION = { user: { id: "admin-1", name: "Admin User", username: "admin", role: "ADMIN", status: "ACTIVE", permissions: [] } };

describe("runProductionInitialization", () => {
  const originalFlag = process.env.ENABLE_PRODUCTION_INITIALIZATION;

  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    process.env.ENABLE_PRODUCTION_INITIALIZATION = "true";
    requireAdminMock.mockResolvedValue(ADMIN_SESSION);
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.ENABLE_PRODUCTION_INITIALIZATION;
    else process.env.ENABLE_PRODUCTION_INITIALIZATION = originalFlag;
  });

  const validInput = { confirmationText: "INITIALIZE SYSTEM", backupConfirmed: true, reason: "PRODUCTION_GO_LIVE", ipAddress: "127.0.0.1", userAgent: "vitest" };

  it("scenario 1/2 (disabled): returns DISABLED and never checks admin when the env flag is off", async () => {
    process.env.ENABLE_PRODUCTION_INITIALIZATION = "false";
    const { runProductionInitialization } = await import("../execute");
    const result = await runProductionInitialization(validInput);
    expect(result).toEqual({ success: false, error: "DISABLED", message: expect.any(String) });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("scenario 5 (non-admin/unauthenticated): returns FORBIDDEN when requireAdmin() resolves null", async () => {
    requireAdminMock.mockResolvedValue(null);
    const { runProductionInitialization } = await import("../execute");
    const result = await runProductionInitialization(validInput);
    expect(result).toEqual({ success: false, error: "FORBIDDEN", message: expect.any(String) });
  });

  it("scenario 9 (wrong confirmation text): rejects and never touches the database", async () => {
    const { runProductionInitialization } = await import("../execute");
    const result = await runProductionInitialization({ ...validInput, confirmationText: "initialize system" });
    expect(result).toEqual({ success: false, error: "INVALID_CONFIRMATION", message: expect.any(String) });
    expect(callOrder).toEqual([]);
  });

  it("scenario 10 (case mismatch): rejects lowercase/partial variants", async () => {
    const { runProductionInitialization } = await import("../execute");
    for (const bad of ["Initialize System", "INITIALIZE  SYSTEM", "INITIALIZESYSTEM", "INITIALIZE SYSTEM "]) {
      const result = await runProductionInitialization({ ...validInput, confirmationText: bad });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toBe("INVALID_CONFIRMATION");
    }
  });

  it("scenario 11 (extra whitespace): rejects a value with trailing/leading/internal extra spaces, never trims to match", async () => {
    const { runProductionInitialization } = await import("../execute");
    const result = await runProductionInitialization({ ...validInput, confirmationText: " INITIALIZE SYSTEM" });
    expect(result).toEqual({ success: false, error: "INVALID_CONFIRMATION", message: expect.any(String) });
  });

  it("scenario 12 (backup not confirmed): rejects when backupConfirmed is not exactly true", async () => {
    const { runProductionInitialization } = await import("../execute");
    const result = await runProductionInitialization({ ...validInput, backupConfirmed: false });
    expect(result).toEqual({ success: false, error: "BACKUP_NOT_CONFIRMED", message: expect.any(String) });
    expect(callOrder).toEqual([]);
  });

  it("reason: missing reason (undefined) is rejected and never touches the database", async () => {
    const { runProductionInitialization } = await import("../execute");
    const { reason: _omit, ...withoutReason } = validInput;
    void _omit;
    const result = await runProductionInitialization(withoutReason as never);
    expect(result).toEqual({ success: false, error: "INVALID_REASON", message: expect.any(String) });
    expect(callOrder).toEqual([]);
    expect(logs).toHaveLength(0);
  });

  it.each(["", "production_go_live", "PRODUCTION-GO-LIVE", "ANYTHING_ELSE", null, 123, {}])("reason: rejects the invalid/arbitrary value %j (whitelist-only, never a free-text string)", async (bad) => {
    const { runProductionInitialization } = await import("../execute");
    const result = await runProductionInitialization({ ...validInput, reason: bad });
    expect(result).toEqual({ success: false, error: "INVALID_REASON", message: expect.any(String) });
    expect(callOrder).toEqual([]);
  });

  it.each(["PRODUCTION_GO_LIVE", "SYSTEM_RESET", "TESTING", "OTHER"])("reason: accepts the valid whitelisted value %s and stores it on the log", async (validReason) => {
    resetState();
    const { runProductionInitialization } = await import("../execute");
    const result = await runProductionInitialization({ ...validInput, reason: validReason });
    expect(result.success).toBe(true);
    expect(logs[0]!.reason).toBe(validReason);
  });

  it("reason: a FAILED run also persists the reason it was started with", async () => {
    deleteManyThrows = "policyRecord";
    const { runProductionInitialization } = await import("../execute");
    const result = await runProductionInitialization({ ...validInput, reason: "TESTING" });
    expect(result.success).toBe(false);
    expect(logs[0]!.status).toBe("FAILED");
    expect(logs[0]!.reason).toBe("TESTING");
  });

  it("reason: never appears in any deleteMany where-clause and never influences deletion order (purely descriptive)", async () => {
    const { runProductionInitialization } = await import("../execute");
    await runProductionInitialization({ ...validInput, reason: "SYSTEM_RESET" });
    for (const model of ["motorClaim", "nonMotorClaim", "task", "invoice", "policyRecord", "quotationCase", "policyImportBatch", "customer", "ledgerManualEntry"]) {
      const delegate = (mockTx as unknown as Record<string, { deleteMany: ReturnType<typeof vi.fn> }>)[model];
      for (const call of delegate.deleteMany.mock.calls) {
        expect(JSON.stringify(call[0] ?? {})).not.toMatch(/reason|SYSTEM_RESET/);
      }
    }
    // Order is identical to the no-reason-variance baseline already covered
    // by the "scenarios 13-21" test above.
    expect(callOrder.indexOf("invoice")).toBeLessThan(callOrder.indexOf("policyRecord"));
  });

  it("scenarios 13-21 (deletion order): deletes in the exact dependency-safe order derived from the schema audit", async () => {
    const { runProductionInitialization } = await import("../execute");
    const result = await runProductionInitialization(validInput);
    expect(result.success).toBe(true);

    const order = callOrder;
    // Invoice strictly before PolicyRecord (InvoiceItem -> PolicyRecord is Restrict).
    expect(order.indexOf("invoice")).toBeLessThan(order.indexOf("policyRecord"));
    // PolicyRecord/QuotationCase/MotorClaim/NonMotorClaim strictly before Customer (Restrict).
    for (const model of ["motorClaim", "nonMotorClaim", "policyRecord", "quotationCase"]) {
      expect(order.indexOf(model)).toBeLessThan(order.indexOf("customer"));
    }
    // Every top-level model was actually deleted.
    for (const model of ["motorClaim", "nonMotorClaim", "task", "invoice", "policyRecord", "quotationCase", "policyImportBatch", "customer", "ledgerManualEntry"]) {
      expect(order).toContain(model);
    }
  });

  it("scenario 17 (Task including legacy claim categories): Task.deleteMany is called with no category filter", async () => {
    const { runProductionInitialization } = await import("../execute");
    await runProductionInitialization(validInput);
    const call = (mockTx.task.deleteMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).toEqual({}); // no `where: { category: "DAILY_TASK" }` narrowing
  });

  it("scenario 22 (counters cleared): all five NumberCounter tables get deleteMany called", async () => {
    const { runProductionInitialization } = await import("../execute");
    await runProductionInitialization(validInput);
    for (const model of ["quotationNumberCounter", "policyRecordNumberCounter", "invoiceNumberCounter", "motorClaimNumberCounter", "nonMotorClaimNumberCounter"]) {
      expect(callOrder).toContain(model);
    }
  });

  it("scenario 40 (Customer sequence untouched): never issues a raw ALTER SEQUENCE / RESTART call", async () => {
    const { runProductionInitialization } = await import("../execute");
    await runProductionInitialization(validInput);
    const queryRawCalls = (mockTx.$queryRaw as ReturnType<typeof vi.fn>).mock.calls;
    for (const call of queryRawCalls) {
      const sql = String(call[0]);
      expect(sql.toUpperCase()).not.toMatch(/ALTER SEQUENCE|RESTART/);
    }
  });

  it("scenario 33/34 (rollback on failure): a deleteMany failure stops later deletes and marks the log FAILED, not SUCCESS", async () => {
    deleteManyThrows = "policyRecord";
    const { runProductionInitialization } = await import("../execute");
    const result = await runProductionInitialization(validInput);
    expect(result).toEqual({ success: false, error: "TRANSACTION_FAILED", message: expect.any(String) });
    // quotationCase/policyImportBatch/customer/ledgerManualEntry/counters all come after policyRecord in
    // the real deletion order — none of them should have run once policyRecord threw.
    expect(callOrder).not.toContain("quotationCase");
    expect(callOrder).not.toContain("customer");

    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe("FAILED");
    expect(logs[0]!.errorSummary).toBeTruthy();
    expect(logs[0]!.errorSummary).not.toMatch(/simulated failure/); // raw error text never stored
  });

  it("scenario 34 (preserved-data verification failure also rolls back and fails): a User count drop marks FAILED", async () => {
    userCounts = [4, 3]; // "before" 4, "after" 3 — an impossible drop this feature must catch
    const { runProductionInitialization } = await import("../execute");
    const result = await runProductionInitialization(validInput);
    expect(result.success).toBe(false);
    expect(logs[0]!.status).toBe("FAILED");
    expect(logs[0]!.errorSummary).toMatch(/User/);
  });

  it("scenario 34b: DropboxIntegration disappearing is caught as a preserved-data failure", async () => {
    dropboxIntegrationExistsAfter = false;
    const { runProductionInitialization } = await import("../execute");
    const result = await runProductionInitialization(validInput);
    expect(result.success).toBe(false);
    expect(logs[0]!.errorSummary).toMatch(/DropboxIntegration/);
  });

  it("scenario 35/36 (audit log status): SUCCESS is recorded with deletedCounts/preservedCounts populated", async () => {
    const { runProductionInitialization } = await import("../execute");
    const result = await runProductionInitialization(validInput);
    expect(result.success).toBe(true);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe("SUCCESS");
    expect(logs[0]!.deletedCounts).toBeTruthy();
    expect(logs[0]!.preservedCountsBefore).toBeTruthy();
    expect(logs[0]!.preservedCountsAfter).toBeTruthy();
    expect(logs[0]!.completedAt).toBeInstanceOf(Date);
  });

  it("never records a Dropbox token/credential value anywhere in the audit log", async () => {
    const { runProductionInitialization } = await import("../execute");
    await runProductionInitialization(validInput);
    const serialized = JSON.stringify(logs);
    expect(serialized.toLowerCase()).not.toMatch(/refreshtoken|accesstoken|encryptedrefreshtoken/);
  });

  it("scenario 37 (concurrent execution blocked): a second call while the advisory lock is held returns ALREADY_RUNNING", async () => {
    lockAcquired = false;
    const { runProductionInitialization } = await import("../execute");
    const result = await runProductionInitialization(validInput);
    expect(result).toEqual({ success: false, error: "ALREADY_RUNNING", message: expect.any(String) });
    expect(callOrder).toEqual([]);
  });

  it("scenario 37b: a fresh (non-stale) existing RUNNING row also blocks with ALREADY_RUNNING", async () => {
    logs.push({
      id: "log-existing",
      executedByUserId: "admin-1",
      executedByNameSnapshot: "Admin User",
      status: "RUNNING",
      startedAt: new Date(),
      completedAt: null,
      deletedCounts: null,
      preservedCountsBefore: null,
      preservedCountsAfter: null,
      errorSummary: null,
      reason: "PRODUCTION_GO_LIVE",
    });
    const { runProductionInitialization } = await import("../execute");
    const result = await runProductionInitialization(validInput);
    expect(result).toEqual({ success: false, error: "ALREADY_RUNNING", message: expect.any(String) });
  });

  it("scenario 38 (cooldown blocks a second run within 24h)", async () => {
    logs.push({
      id: "log-prev-success",
      executedByUserId: "admin-1",
      executedByNameSnapshot: "Admin User",
      status: "SUCCESS",
      startedAt: new Date("2026-01-01T00:00:00Z"),
      completedAt: new Date("2026-01-01T00:00:10Z"),
      deletedCounts: {},
      preservedCountsBefore: {},
      preservedCountsAfter: {},
      errorSummary: null,
      reason: "PRODUCTION_GO_LIVE",
    });
    const { runProductionInitialization } = await import("../execute");
    const now = new Date("2026-01-01T12:00:00Z"); // 12h later, still in cooldown
    const result = await runProductionInitialization({ ...validInput, now });
    expect(result).toEqual({
      success: false,
      error: "COOLDOWN_ACTIVE",
      message: expect.any(String),
      nextAvailableAt: new Date("2026-01-02T00:00:10Z").toISOString(),
    });
    expect(callOrder).toEqual([]);
  });

  it("scenario 39 (cooldown lifts after 24h): a run exactly 24h+ after the last success succeeds", async () => {
    logs.push({
      id: "log-prev-success",
      executedByUserId: "admin-1",
      executedByNameSnapshot: "Admin User",
      status: "SUCCESS",
      startedAt: new Date("2026-01-01T00:00:00Z"),
      completedAt: new Date("2026-01-01T00:00:10Z"),
      deletedCounts: {},
      preservedCountsBefore: {},
      preservedCountsAfter: {},
      errorSummary: null,
      reason: "PRODUCTION_GO_LIVE",
    });
    const { runProductionInitialization } = await import("../execute");
    const now = new Date("2026-01-02T00:00:11Z"); // just past 24h
    const result = await runProductionInitialization({ ...validInput, now });
    expect(result.success).toBe(true);
  });

  it("scenario 48 (stale RUNNING auto-recovers): an old RUNNING row is auto-failed and a fresh run proceeds", async () => {
    logs.push({
      id: "log-stale",
      executedByUserId: "someone-else",
      executedByNameSnapshot: "Someone Else",
      status: "RUNNING",
      startedAt: new Date("2026-01-01T00:00:00Z"), // way older than the 10-minute stale threshold
      completedAt: null,
      deletedCounts: null,
      preservedCountsBefore: null,
      preservedCountsAfter: null,
      errorSummary: null,
      reason: "SYSTEM_RESET",
    });
    const { runProductionInitialization } = await import("../execute");
    const now = new Date("2026-01-01T01:00:00Z"); // 1 hour later
    const result = await runProductionInitialization({ ...validInput, now });
    expect(result.success).toBe(true);
    const stale = logs.find((l) => l.id === "log-stale")!;
    expect(stale.status).toBe("FAILED");
    expect(stale.errorSummary).toMatch(/superseded/i);
  });

  it("scenario 43 (Dropbox stays Connected): success result reports the (untouched) DropboxIntegration status", async () => {
    dropboxStatus = "CONNECTED";
    const { runProductionInitialization } = await import("../execute");
    const result = await runProductionInitialization(validInput);
    expect(result.success).toBe(true);
    if (result.success) expect(result.dropboxConnectionStatus).toBe("CONNECTED");
  });

  it("scenario 32 (no Dropbox delete API called): this module never imports any Dropbox SDK/service", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(path.join(__dirname, "..", "execute.ts"), "utf8");
    // Checks actual import specifiers / SDK method calls, not prose — this
    // file's own doc comments legitimately mention the Dropbox service
    // path in English while explaining that it's NOT imported. Importing
    // `integrations/dropbox/constants` (plain string ids, e.g.
    // DROPBOX_INTEGRATION_ID) is fine and expected — only an import that
    // could provide actual Dropbox API/delete capability is disallowed.
    const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    for (const line of importLines) {
      if (/dropbox/i.test(line)) {
        expect(line).toMatch(/integrations\/dropbox\/constants/);
      }
    }
    expect(source).not.toMatch(/from "dropbox"|filesDeleteV2|filesPermanentlyDelete|\.filesDelete\(/);
  });
});
