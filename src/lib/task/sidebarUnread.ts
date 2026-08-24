import { prisma } from "@/lib/prisma";
import { hasPermission, type AuthzUser } from "@/lib/permissions";
import { getUnreadTaskIds } from "@/lib/task/readState";
import { getUnreadMotorClaimIds, getUnreadNonMotorClaimIds } from "@/lib/claims/readState";

// Sidebar "Task" nav item red dot (2026-08-24 spec) — true when the current
// user has at least one unread Daily Task, Motor Claim, or Non-Motor Claim.
// Deliberately reuses the exact same getUnreadTaskIds / getUnreadMotorClaimIds
// / getUnreadNonMotorClaimIds functions (baseline included) the three list
// pages already use, rather than a separate/parallel "is unread" query — so
// this can never disagree with what a user actually sees after opening
// Task/Motor Claim/Non-Motor Claim (no phantom dot that survives visiting
// every list once, no missed dot the lists would have shown).
//
// Each of the three checks is gated on that module's own VIEW permission
// (mirroring checkTaskAccess/checkMotorClaimAccess/checkNonMotorClaimAccess's
// own module gate) and the query itself is restricted to Tasks/Claims the
// user actually participates in (`participants: { some: { userId } }`,
// identical to getVisibleTasksForCategory/getMotorClaims/getNonMotorClaims)
// — a user can never see this dot on account of a record they have no
// permission for or aren't a participant of.
export async function hasUnreadTaskSidebarActivity(userId: string, user: AuthzUser): Promise<boolean> {
  const checks: Promise<boolean>[] = [];

  if (hasPermission(user, "task.daily_task")) {
    checks.push(
      prisma.task
        .findMany({
          where: { category: "DAILY_TASK", deletedAt: null, participants: { some: { userId } } },
          select: { id: true, updatedAt: true },
        })
        .then(async (tasks) => (await getUnreadTaskIds(userId, tasks)).size > 0)
    );
  }

  if (hasPermission(user, "claim.motor")) {
    checks.push(
      prisma.motorClaim
        .findMany({
          where: { deletedAt: null, participants: { some: { userId } } },
          select: { id: true, updatedAt: true },
        })
        .then(async (claims) => (await getUnreadMotorClaimIds(userId, claims)).size > 0)
    );
  }

  if (hasPermission(user, "claim.non_motor")) {
    checks.push(
      prisma.nonMotorClaim
        .findMany({
          where: { deletedAt: null, participants: { some: { userId } } },
          select: { id: true, updatedAt: true },
        })
        .then(async (claims) => (await getUnreadNonMotorClaimIds(userId, claims)).size > 0)
    );
  }

  if (checks.length === 0) return false;
  const results = await Promise.all(checks);
  return results.some(Boolean);
}
