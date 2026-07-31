import { prisma } from "@/lib/prisma";
import { COOLDOWN_MS, STALE_RUNNING_THRESHOLD_MS } from "./constants";
import type { ProductionInitDeleteCounts, ProductionInitLastRun, ProductionInitStatusInfo } from "./types";

// Read-only status for the Settings panel — "Last initialized", whether
// Execute is currently blocked by the 24h cooldown, and whether something
// is currently running. Never mutates a stale RUNNING row (only
// execute.ts's acquire step does that, inside its own short mutex
// transaction) — this is purely a display helper, safe to call as often as
// the UI wants (e.g. on every Settings page load).
//
// `now` is an injectable parameter (defaults to the real current time) so
// tests can exercise "just inside the cooldown" / "just past it" without
// waiting 24 real hours (this feature's spec, Part 9).
export async function getProductionInitializationStatus(now: Date = new Date()): Promise<ProductionInitStatusInfo> {
  const [lastRunRow, lastSuccessRow, runningRow] = await Promise.all([
    prisma.systemInitializationLog.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.systemInitializationLog.findFirst({ where: { status: "SUCCESS" }, orderBy: { completedAt: "desc" } }),
    prisma.systemInitializationLog.findFirst({ where: { status: "RUNNING" }, orderBy: { startedAt: "desc" } }),
  ]);

  const lastRun: ProductionInitLastRun | null = lastRunRow
    ? {
        id: lastRunRow.id,
        status: lastRunRow.status,
        executedByName: lastRunRow.executedByNameSnapshot,
        startedAt: lastRunRow.startedAt.toISOString(),
        completedAt: lastRunRow.completedAt ? lastRunRow.completedAt.toISOString() : null,
        deletedCounts: (lastRunRow.deletedCounts as ProductionInitDeleteCounts | null) ?? null,
        errorSummary: lastRunRow.errorSummary,
        reason: lastRunRow.reason,
      }
    : null;

  let cooldownUntil: string | null = null;
  if (lastSuccessRow?.completedAt) {
    const until = new Date(lastSuccessRow.completedAt.getTime() + COOLDOWN_MS);
    if (until.getTime() > now.getTime()) cooldownUntil = until.toISOString();
  }

  const currentlyRunning = !!runningRow && now.getTime() - runningRow.startedAt.getTime() < STALE_RUNNING_THRESHOLD_MS;

  return { lastRun, cooldownUntil, currentlyRunning };
}
