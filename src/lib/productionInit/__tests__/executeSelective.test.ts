import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Phase 7 Part C — Selective Initialization. Mirrors execute.test.ts's own
// mocking convention exactly (same shared-mutable-state-closed-over-by-
// vi.mock pattern) so both suites read/verify consistently, but only mocks
// what executeSelective.ts actually touches.

type LogRow = {
  id: string;
  executedByUserId: string;
  executedByNameSnapshot: string;
  status: "RUNNING" | "SUCCESS" | "FAILED";
  startedAt: Date;
  completedAt: Date | null;
  deletedCounts: unknown;
  errorSummary: string | null;
  reason: string | null;
};

let logs: LogRow[];
let logIdSeq: number;
let lockAcquired: boolean;
let callOrder: string[];
let deleteManyThrows: string | null;
let quotationCaseCount: number;
let policyRecordCount: number;
let policyRecordWithQuotationCount: number;
let invoiceItemCount: number;
let motorClaimCount: number;
let nonMotorClaimCount: number;
let motorClaimWithPolicyCount: number;
let nonMotorClaimWithPolicyCount: number;
let invoiceCount: number;
let users: { id: string; role: string }[];

function resetState() {
  logs = [];
  logIdSeq = 0;
  lockAcquired = true;
  callOrder = [];
  deleteManyThrows = null;
  quotationCaseCount = 0;
  policyRecordCount = 0;
  policyRecordWithQuotationCount = 0;
  invoiceItemCount = 0;
  motorClaimCount = 0;
  nonMotorClaimCount = 0;
  motorClaimWithPolicyCount = 0;
  nonMotorClaimWithPolicyCount = 0;
  invoiceCount = 0;
  users = [
    { id: "admin-1", role: "Admin" },
    { id: "staff-1", role: "Staff" },
    { id: "staff-2", role: "Staff" },
  ];
}

function deleteManyDelegate(modelName: string) {
  return vi.fn(async () => {
    callOrder.push(modelName);
    if (deleteManyThrows === modelName) throw new Error(`simulated failure deleting ${modelName}`);
    return { count: 1 };
  });
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
    motorClaim: {
      deleteMany: deleteManyDelegate("motorClaim"),
      count: vi.fn(async ({ where }: { where?: { policyRecordId?: unknown } } = {}) => (where?.policyRecordId ? motorClaimWithPolicyCount : motorClaimCount)),
    },
    nonMotorClaim: {
      deleteMany: deleteManyDelegate("nonMotorClaim"),
      count: vi.fn(async ({ where }: { where?: { policyRecordId?: unknown } } = {}) => (where?.policyRecordId ? nonMotorClaimWithPolicyCount : nonMotorClaimCount)),
    },
    task: { deleteMany: deleteManyDelegate("task") },
    invoice: { deleteMany: deleteManyDelegate("invoice"), count: vi.fn(async () => invoiceCount) },
    invoiceItem: { count: vi.fn(async () => invoiceItemCount) },
    policyRecord: {
      deleteMany: deleteManyDelegate("policyRecord"),
      count: vi.fn(async ({ where }: { where?: { sourceQuotationId?: unknown } } = {}) => (where?.sourceQuotationId ? policyRecordWithQuotationCount : policyRecordCount)),
    },
    policyImportRow: { deleteMany: deleteManyDelegate("policyImportRow") },
    policyImportBatch: { deleteMany: deleteManyDelegate("policyImportBatch") },
    quotation: { count: vi.fn(async () => 0) },
    quotationCase: { deleteMany: deleteManyDelegate("quotationCase"), count: vi.fn(async () => quotationCaseCount) },
    customer: { deleteMany: deleteManyDelegate("customer") },
    ledgerManualEntry: { deleteMany: deleteManyDelegate("ledgerManualEntry") },
    quotationNumberCounter: { deleteMany: deleteManyDelegate("quotationNumberCounter") },
    policyRecordNumberCounter: { deleteMany: deleteManyDelegate("policyRecordNumberCounter") },
    invoiceNumberCounter: { deleteMany: deleteManyDelegate("invoiceNumberCounter") },
    user: {
      findMany: vi.fn(async () => users),
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        callOrder.push("user");
        if (deleteManyThrows === "user") throw new Error("simulated failure deleting user");
        const before = users.length;
        users = users.filter((u) => !where.id.in.includes(u.id));
        return { count: before - users.length };
      }),
    },
  },
}));

import { prisma as mockTx } from "@/lib/prisma";

const requireAdminMock = vi.fn();
vi.mock("@/lib/authz", () => ({ requireAdmin: (...args: unknown[]) => requireAdminMock(...args) }));

const ADMIN_SESSION = { user: { id: "admin-1", name: "Admin User", username: "admin", role: "Admin", status: "ACTIVE", permissions: [] } };

describe("validateInitializationSelection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  it("Case 7: an independent module (LEDGER alone) has no violations", async () => {
    const { validateInitializationSelection } = await import("../validateSelection");
    const result = await validateInitializationSelection(new Set(["LEDGER"]));
    expect(result).toEqual({ ok: true });
  });

  it("Case 10: CUSTOMER alone is blocked when linked Quotation data exists", async () => {
    quotationCaseCount = 3;
    const { validateInitializationSelection } = await import("../validateSelection");
    const result = await validateInitializationSelection(new Set(["CUSTOMER"]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].module).toBe("CUSTOMER");
      expect(result.violations[0].requiredModules).toContain("QUOTATION");
    }
  });

  it("Case 11: POLICY alone is blocked when linked Invoice data exists", async () => {
    invoiceItemCount = 5;
    const { validateInitializationSelection } = await import("../validateSelection");
    const result = await validateInitializationSelection(new Set(["POLICY"]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations[0]).toEqual({ module: "POLICY", requiredModules: ["INVOICE"], reason: expect.any(String) });
    }
  });

  it("Case 9: selecting the full dependency chain succeeds", async () => {
    quotationCaseCount = 3;
    policyRecordCount = 5;
    invoiceItemCount = 2;
    motorClaimCount = 1;
    const { validateInitializationSelection } = await import("../validateSelection");
    const result = await validateInitializationSelection(new Set(["CUSTOMER", "QUOTATION", "POLICY", "INVOICE", "TASK"]));
    expect(result).toEqual({ ok: true });
  });

  it("QUOTATION alone is blocked when Policy records still trace back to it (SetNull, not a hard DB error, but still blocked)", async () => {
    policyRecordWithQuotationCount = 2;
    const { validateInitializationSelection } = await import("../validateSelection");
    const result = await validateInitializationSelection(new Set(["QUOTATION"]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations[0]).toEqual({ module: "QUOTATION", requiredModules: ["POLICY"], reason: expect.any(String) });
  });

  it("POLICY alone is blocked when Claims still link to it, even with no Invoice", async () => {
    motorClaimWithPolicyCount = 1;
    const { validateInitializationSelection } = await import("../validateSelection");
    const result = await validateInitializationSelection(new Set(["POLICY"]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations[0].requiredModules).toContain("TASK");
  });
});

describe("runSelectiveProductionInitialization", () => {
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

  const validInput = { modules: ["LEDGER"], confirmationText: "INITIALIZE SYSTEM", backupConfirmed: true, reason: "TESTING", ipAddress: "127.0.0.1", userAgent: "vitest" };

  it("Case 7: initializing an independent module (LEDGER) succeeds", async () => {
    const { runSelectiveProductionInitialization } = await import("../executeSelective");
    const result = await runSelectiveProductionInitialization(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.deletedCounts.manualLedgerEntries).toBe(1);
      expect(result.modules).toEqual(["LEDGER"]);
    }
    expect(logs.find((l) => l.status === "SUCCESS")).toBeTruthy();
  });

  it("Case 8: server-side validation blocks a request that skips the front-end checkbox rule", async () => {
    quotationCaseCount = 1;
    const { runSelectiveProductionInitialization } = await import("../executeSelective");
    const result = await runSelectiveProductionInitialization({ ...validInput, modules: ["CUSTOMER"] });
    expect(result).toEqual({
      success: false,
      error: "DEPENDENCY_VIOLATION",
      message: expect.any(String),
      violations: expect.arrayContaining([expect.objectContaining({ module: "CUSTOMER" })]),
    });
    // Never opened a RUNNING row for a rejected selection.
    expect(logs).toHaveLength(0);
  });

  it("Case 13: a non-Admin session (requireAdmin resolves null) is FORBIDDEN before touching any data", async () => {
    requireAdminMock.mockResolvedValue(null);
    const { runSelectiveProductionInitialization } = await import("../executeSelective");
    const result = await runSelectiveProductionInitialization(validInput);
    expect(result).toEqual({ success: false, error: "FORBIDDEN", message: expect.any(String) });
    expect(callOrder).toHaveLength(0);
  });

  it("Case 12: Users initialization keeps every Admin-role account, including the acting admin, and deletes only non-Admin users", async () => {
    const { runSelectiveProductionInitialization } = await import("../executeSelective");
    const result = await runSelectiveProductionInitialization({ ...validInput, modules: ["USERS"] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.usersDeleted).toBe(2); // staff-1, staff-2
    expect(users).toEqual([{ id: "admin-1", role: "Admin" }]);
  });

  it("Case 12b: Users initialization is a no-op when every remaining user is already an Admin", async () => {
    users = [{ id: "admin-1", role: "Admin" }, { id: "admin-2", role: "ADMIN" }];
    const { runSelectiveProductionInitialization } = await import("../executeSelective");
    const result = await runSelectiveProductionInitialization({ ...validInput, modules: ["USERS"] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.usersDeleted).toBe(0);
    expect(users).toHaveLength(2);
  });

  it("SETTINGS is rejected as unavailable, never reaching the deletion transaction", async () => {
    const { runSelectiveProductionInitialization } = await import("../executeSelective");
    const result = await runSelectiveProductionInitialization({ ...validInput, modules: ["SETTINGS"] });
    expect(result).toEqual({ success: false, error: "MODULE_UNAVAILABLE", message: expect.any(String) });
    expect(logs).toHaveLength(0);
  });

  it("Case 15: a deletion failure rolls back the whole transaction and marks the audit row FAILED, not a partial success", async () => {
    deleteManyThrows = "customer";
    const { runSelectiveProductionInitialization } = await import("../executeSelective");
    const result = await runSelectiveProductionInitialization({ ...validInput, modules: ["CUSTOMER", "QUOTATION", "POLICY", "INVOICE", "TASK"] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("TRANSACTION_FAILED");
    const log = logs.find((l) => l.status === "FAILED");
    expect(log).toBeTruthy();
    expect(log!.deletedCounts).toBeNull(); // never wrote a partial deletedCounts payload
  });

  it("DISABLED short-circuits before ever checking admin status", async () => {
    process.env.ENABLE_PRODUCTION_INITIALIZATION = "false";
    const { runSelectiveProductionInitialization } = await import("../executeSelective");
    const result = await runSelectiveProductionInitialization(validInput);
    expect(result).toEqual({ success: false, error: "DISABLED", message: expect.any(String) });
    expect(requireAdminMock).not.toHaveBeenCalled();
  });

  it("rejects an empty modules array", async () => {
    const { runSelectiveProductionInitialization } = await import("../executeSelective");
    const result = await runSelectiveProductionInitialization({ ...validInput, modules: [] });
    expect(result).toEqual({ success: false, error: "NO_MODULES_SELECTED", message: expect.any(String) });
  });
});

describe("Case 14: no real Dropbox delete API is ever invoked", () => {
  it("executeSelective.ts imports nothing from the Dropbox integration layer", () => {
    const source = readFileSync(join(__dirname, "..", "executeSelective.ts"), "utf8");
    expect(source).not.toMatch(/from "@\/lib\/integrations\/dropbox/);
  });

  it("modules.ts imports nothing from the Dropbox integration layer either", () => {
    const source = readFileSync(join(__dirname, "..", "modules.ts"), "utf8");
    expect(source).not.toMatch(/from "@\/lib\/integrations\/dropbox/);
  });
});
