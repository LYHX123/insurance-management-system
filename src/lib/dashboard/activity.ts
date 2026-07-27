import { prisma } from "@/lib/prisma";
import { hasPermission, isAdmin, type AuthzUser } from "@/lib/permissions";
import type { PolicyCategory } from "@/generated/prisma/enums";
import type { ActivityItem, ActivityModule } from "./types";

const PER_SOURCE_LIMIT = 10;
const TOTAL_LIMIT = 10;

const POLICY_CATEGORY_ROUTE: Record<PolicyCategory, string> = {
  MOTOR: "/policy/motor",
  NON_MOTOR: "/policy/non-motor",
  BOND: "/policy/bond",
  WORK_PERMIT: "/policy/work-permit",
};
const POLICY_CATEGORY_MODULE: Record<PolicyCategory, ActivityModule> = {
  MOTOR: "policy.motor",
  NON_MOTOR: "policy.non_motor",
  BOND: "policy.bond",
  WORK_PERMIT: "policy.work_permit",
};

type RawItem = ActivityItem & { _actorId: string | null };

// Part 16 — normalizes several existing history sources (never a new
// audit-log table). Each source query is capped at PER_SOURCE_LIMIT and
// selects only the fields needed for display; actor names are resolved with
// one batched User lookup across every source, not per-row.
export async function buildRecentActivity(
  user: AuthzUser & { id: string },
  policyCategories: PolicyCategory[]
): Promise<ActivityItem[]> {
  const admin = isAdmin(user);
  const participantScope = admin ? null : user.id;
  const raw: RawItem[] = [];

  if (policyCategories.length > 0) {
    const activities = await prisma.policyActivity.findMany({
      where: { policyRecord: { category: { in: policyCategories }, deletedAt: null } },
      select: {
        id: true,
        summary: true,
        createdAt: true,
        performedById: true,
        policyRecord: { select: { recordNumber: true, category: true, id: true } },
      },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE_LIMIT,
    });
    for (const a of activities) {
      raw.push({
        id: `policy-activity:${a.id}`,
        timestamp: a.createdAt.toISOString(),
        actorName: null,
        action: a.summary,
        module: POLICY_CATEGORY_MODULE[a.policyRecord.category],
        recordLabel: a.policyRecord.recordNumber,
        targetUrl: `${POLICY_CATEGORY_ROUTE[a.policyRecord.category]}/${a.policyRecord.id}`,
        _actorId: a.performedById,
      });
    }
  }

  if (admin || hasPermission(user, "task.daily_task")) {
    const steps = await prisma.taskStep.findMany({
      where: {
        deletedAt: null,
        task: {
          category: "DAILY_TASK",
          deletedAt: null,
          ...(participantScope ? { participants: { some: { userId: participantScope } } } : {}),
        },
      },
      select: { id: true, content: true, createdAt: true, createdById: true, task: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE_LIMIT,
    });
    for (const s of steps) {
      raw.push({
        id: `task-step:${s.id}`,
        timestamp: s.createdAt.toISOString(),
        actorName: null,
        action: s.content,
        module: "task.daily_task",
        recordLabel: s.task.title,
        targetUrl: `/task/daily/${s.task.id}`,
        _actorId: s.createdById,
      });
    }
  }

  if (admin || hasPermission(user, "claim.motor")) {
    const updates = await prisma.motorClaimUpdate.findMany({
      where: {
        deletedAt: null,
        motorClaim: {
          deletedAt: null,
          ...(participantScope ? { participants: { some: { userId: participantScope } } } : {}),
        },
      },
      select: { id: true, content: true, createdAt: true, createdById: true, motorClaim: { select: { id: true, claimNumber: true } } },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE_LIMIT,
    });
    for (const u of updates) {
      raw.push({
        id: `motor-claim-update:${u.id}`,
        timestamp: u.createdAt.toISOString(),
        actorName: null,
        action: u.content,
        module: "claim.motor",
        recordLabel: u.motorClaim.claimNumber,
        targetUrl: `/task/motor-claim/${u.motorClaim.id}`,
        _actorId: u.createdById,
      });
    }
  }

  if (admin || hasPermission(user, "claim.non_motor")) {
    const updates = await prisma.nonMotorClaimUpdate.findMany({
      where: {
        deletedAt: null,
        nonMotorClaim: {
          deletedAt: null,
          ...(participantScope ? { participants: { some: { userId: participantScope } } } : {}),
        },
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        createdById: true,
        nonMotorClaim: { select: { id: true, claimNumber: true } },
      },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE_LIMIT,
    });
    for (const u of updates) {
      raw.push({
        id: `non-motor-claim-update:${u.id}`,
        timestamp: u.createdAt.toISOString(),
        actorName: null,
        action: u.content,
        module: "claim.non_motor",
        recordLabel: u.nonMotorClaim.claimNumber,
        targetUrl: `/task/non-motor-claim/${u.nonMotorClaim.id}`,
        _actorId: u.createdById,
      });
    }
  }

  if (admin || hasPermission(user, "ledger.manual_record")) {
    const entries = await prisma.ledgerManualEntry.findMany({
      where: { cancelledAt: null },
      select: { id: true, description: true, transactionType: true, amount: true, createdAt: true, createdById: true, category: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE_LIMIT,
    });
    for (const e of entries) {
      raw.push({
        id: `manual-ledger:${e.id}`,
        timestamp: e.createdAt.toISOString(),
        actorName: null,
        action: e.description?.trim() || e.category.name,
        module: "ledger.manual_record",
        recordLabel: `${e.transactionType === "INCOME" ? "+" : "-"} ${e.amount.toString()}`,
        targetUrl: "/ledger/manual",
        _actorId: e.createdById,
      });
    }
  }

  raw.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const top = raw.slice(0, TOTAL_LIMIT);

  const actorIds = [...new Set(top.map((r) => r._actorId).filter((id): id is string => !!id))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true, username: true } })
    : [];
  const actorNameById = new Map(actors.map((a) => [a.id, a.fullName || a.username]));

  return top.map(({ _actorId, ...item }) => ({
    ...item,
    actorName: _actorId ? actorNameById.get(_actorId) ?? null : null,
  }));
}
