import { describe, it, expect, vi, beforeEach } from "vitest";

// Sidebar "Task" nav item red dot (2026-08-24 spec, Section 5-7 / test
// Cases 6-10) — composition-focused: getUnreadTaskIds / getUnreadMotorClaimIds
// / getUnreadNonMotorClaimIds themselves are already exhaustively covered
// elsewhere (unreadIndicator.test.ts x3, and the real-database
// readState.dualUser.integration.test.ts / readState.newParticipant.integration.test.ts).
// This file proves hasUnreadTaskSidebarActivity's OWN job correctly: the
// OR across all three, the module-permission gate (skip the query entirely
// when the user has no VIEW access to that module — Case 10), and that the
// DB query itself is scoped to Tasks/Claims the user actually participates
// in (never broader).

const taskFindManyMock = vi.fn();
const motorClaimFindManyMock = vi.fn();
const nonMotorClaimFindManyMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: { findMany: (...args: unknown[]) => taskFindManyMock(...args) },
    motorClaim: { findMany: (...args: unknown[]) => motorClaimFindManyMock(...args) },
    nonMotorClaim: { findMany: (...args: unknown[]) => nonMotorClaimFindManyMock(...args) },
  },
}));

const getUnreadTaskIdsMock = vi.fn();
vi.mock("@/lib/task/readState", () => ({
  getUnreadTaskIds: (...args: unknown[]) => getUnreadTaskIdsMock(...args),
}));

const getUnreadMotorClaimIdsMock = vi.fn();
const getUnreadNonMotorClaimIdsMock = vi.fn();
vi.mock("@/lib/claims/readState", () => ({
  getUnreadMotorClaimIds: (...args: unknown[]) => getUnreadMotorClaimIdsMock(...args),
  getUnreadNonMotorClaimIds: (...args: unknown[]) => getUnreadNonMotorClaimIdsMock(...args),
}));

const FULL_ACCESS_USER = { role: "Staff", status: "ACTIVE" as const, permissions: ["task.daily_task", "claim.motor", "claim.non_motor"] };

beforeEach(() => {
  vi.clearAllMocks();
  taskFindManyMock.mockResolvedValue([{ id: "task-1", updatedAt: new Date() }]);
  motorClaimFindManyMock.mockResolvedValue([{ id: "claim-1", updatedAt: new Date() }]);
  nonMotorClaimFindManyMock.mockResolvedValue([{ id: "claim-2", updatedAt: new Date() }]);
  getUnreadTaskIdsMock.mockResolvedValue(new Set());
  getUnreadMotorClaimIdsMock.mockResolvedValue(new Set());
  getUnreadNonMotorClaimIdsMock.mockResolvedValue(new Set());
});

describe("hasUnreadTaskSidebarActivity", () => {
  it("Case 6: Daily Task has unread -> true", async () => {
    getUnreadTaskIdsMock.mockResolvedValue(new Set(["task-1"]));
    const { hasUnreadTaskSidebarActivity } = await import("../sidebarUnread");
    expect(await hasUnreadTaskSidebarActivity("user-1", FULL_ACCESS_USER)).toBe(true);
  });

  it("Case 7: Motor Claim has unread -> true", async () => {
    getUnreadMotorClaimIdsMock.mockResolvedValue(new Set(["claim-1"]));
    const { hasUnreadTaskSidebarActivity } = await import("../sidebarUnread");
    expect(await hasUnreadTaskSidebarActivity("user-1", FULL_ACCESS_USER)).toBe(true);
  });

  it("Case 8: Non-Motor Claim has unread -> true", async () => {
    getUnreadNonMotorClaimIdsMock.mockResolvedValue(new Set(["claim-2"]));
    const { hasUnreadTaskSidebarActivity } = await import("../sidebarUnread");
    expect(await hasUnreadTaskSidebarActivity("user-1", FULL_ACCESS_USER)).toBe(true);
  });

  it("Case 9: all three read -> false", async () => {
    const { hasUnreadTaskSidebarActivity } = await import("../sidebarUnread");
    expect(await hasUnreadTaskSidebarActivity("user-1", FULL_ACCESS_USER)).toBe(false);
  });

  it("Case 10: a user with no permission for a module never even queries it, so an unread record there can't trigger their dot", async () => {
    // This user has ONLY task.daily_task — no claim.motor, no claim.non_motor.
    const limitedUser = { role: "Staff", status: "ACTIVE" as const, permissions: ["task.daily_task"] };
    // Even though Motor Claim data would report unread if queried...
    getUnreadMotorClaimIdsMock.mockResolvedValue(new Set(["claim-1"]));

    const { hasUnreadTaskSidebarActivity } = await import("../sidebarUnread");
    const result = await hasUnreadTaskSidebarActivity("user-1", limitedUser);

    expect(result).toBe(false);
    expect(motorClaimFindManyMock).not.toHaveBeenCalled();
    expect(nonMotorClaimFindManyMock).not.toHaveBeenCalled();
    expect(getUnreadMotorClaimIdsMock).not.toHaveBeenCalled();
    expect(taskFindManyMock).toHaveBeenCalledTimes(1);
  });

  it("queries are restricted to Tasks/Claims the given user actually participates in, never broader", async () => {
    const { hasUnreadTaskSidebarActivity } = await import("../sidebarUnread");
    await hasUnreadTaskSidebarActivity("user-42", FULL_ACCESS_USER);

    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ participants: { some: { userId: "user-42" } }, deletedAt: null, category: "DAILY_TASK" }) })
    );
    expect(motorClaimFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ participants: { some: { userId: "user-42" } }, deletedAt: null }) })
    );
    expect(nonMotorClaimFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ participants: { some: { userId: "user-42" } }, deletedAt: null }) })
    );
  });

  it("an inactive/disabled user never shows the dot, regardless of underlying data", async () => {
    getUnreadTaskIdsMock.mockResolvedValue(new Set(["task-1"]));
    const disabledUser = { role: "Staff", status: "DISABLED" as const, permissions: ["task.daily_task", "claim.motor", "claim.non_motor"] };
    const { hasUnreadTaskSidebarActivity } = await import("../sidebarUnread");
    expect(await hasUnreadTaskSidebarActivity("user-1", disabledUser)).toBe(false);
  });
});
