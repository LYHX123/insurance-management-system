import { describe, it, expect, vi, beforeEach } from "vitest";

let lastRunRow: { id: string; status: string; executedByNameSnapshot: string; startedAt: Date; completedAt: Date | null; deletedCounts: unknown; errorSummary: string | null; reason: string | null } | null;
let lastSuccessRow: { completedAt: Date | null } | null;
let runningRow: { startedAt: Date } | null;

const findFirstMock = vi.fn(async ({ where }: { where?: { status?: string } }) => {
  if (where?.status === "SUCCESS") return lastSuccessRow;
  if (where?.status === "RUNNING") return runningRow;
  return lastRunRow;
});

vi.mock("@/lib/prisma", () => ({
  prisma: { systemInitializationLog: { findFirst: (...args: unknown[]) => findFirstMock(...(args as [never])) } },
}));

describe("getProductionInitializationStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastRunRow = null;
    lastSuccessRow = null;
    runningRow = null;
  });

  it("reports no last run when the log is empty", async () => {
    const { getProductionInitializationStatus } = await import("../status");
    const result = await getProductionInitializationStatus();
    expect(result.lastRun).toBeNull();
    expect(result.cooldownUntil).toBeNull();
    expect(result.currentlyRunning).toBe(false);
  });

  it("reports lastRun details from the most recent log row, including reason", async () => {
    lastRunRow = {
      id: "log-1",
      status: "SUCCESS",
      executedByNameSnapshot: "Admin User",
      startedAt: new Date("2026-01-01T00:00:00Z"),
      completedAt: new Date("2026-01-01T00:00:05Z"),
      deletedCounts: { customers: 3 },
      errorSummary: null,
      reason: "PRODUCTION_GO_LIVE",
    };
    const { getProductionInitializationStatus } = await import("../status");
    const result = await getProductionInitializationStatus();
    expect(result.lastRun).toEqual({
      id: "log-1",
      status: "SUCCESS",
      executedByName: "Admin User",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:05.000Z",
      deletedCounts: { customers: 3 },
      errorSummary: null,
      reason: "PRODUCTION_GO_LIVE",
    });
  });

  it("passes through a null reason unchanged for an old pre-reason log row (UI shows 'Not recorded' for this)", async () => {
    lastRunRow = {
      id: "log-old",
      status: "SUCCESS",
      executedByNameSnapshot: "Admin User",
      startedAt: new Date("2026-01-01T00:00:00Z"),
      completedAt: new Date("2026-01-01T00:00:05Z"),
      deletedCounts: null,
      errorSummary: null,
      reason: null,
    };
    const { getProductionInitializationStatus } = await import("../status");
    const result = await getProductionInitializationStatus();
    expect(result.lastRun?.reason).toBeNull();
  });

  it("is inside the 24h cooldown just after a successful run", async () => {
    const completedAt = new Date("2026-01-01T00:00:00Z");
    lastSuccessRow = { completedAt };
    const now = new Date(completedAt.getTime() + 60 * 60 * 1000); // +1h
    const { getProductionInitializationStatus } = await import("../status");
    const result = await getProductionInitializationStatus(now);
    expect(result.cooldownUntil).toBe(new Date(completedAt.getTime() + 24 * 60 * 60 * 1000).toISOString());
  });

  it("is past the cooldown exactly 24h + 1ms after a successful run", async () => {
    const completedAt = new Date("2026-01-01T00:00:00Z");
    lastSuccessRow = { completedAt };
    const now = new Date(completedAt.getTime() + 24 * 60 * 60 * 1000 + 1);
    const { getProductionInitializationStatus } = await import("../status");
    const result = await getProductionInitializationStatus(now);
    expect(result.cooldownUntil).toBeNull();
  });

  it("reports currentlyRunning=true for a fresh RUNNING row", async () => {
    const now = new Date("2026-01-01T00:10:00Z");
    runningRow = { startedAt: new Date("2026-01-01T00:09:00Z") }; // 1 minute old
    const { getProductionInitializationStatus } = await import("../status");
    const result = await getProductionInitializationStatus(now);
    expect(result.currentlyRunning).toBe(true);
  });

  it("does not report currentlyRunning=true for a stale RUNNING row (read-only — never mutates it)", async () => {
    const now = new Date("2026-01-01T01:00:00Z");
    runningRow = { startedAt: new Date("2026-01-01T00:00:00Z") }; // 1 hour old, way past the 10-minute stale threshold
    const { getProductionInitializationStatus } = await import("../status");
    const result = await getProductionInitializationStatus(now);
    expect(result.currentlyRunning).toBe(false);
  });
});
