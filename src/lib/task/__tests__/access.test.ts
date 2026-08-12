import { describe, it, expect, vi, beforeEach } from "vitest";

// Task Collaborator Permission Model — checkTaskAccess is the single
// security primitive every Task Server Action and the Task detail page
// route through (see src/lib/task/access.ts). These tests pin down its
// composition of canEdit/canDelete now that a Task Participant is a full
// collaborator, not just a viewer:
//   canEdit   = Admin OR Creator OR Participant
//   canDelete = Admin OR Creator only

let sessionUser: { id: string; role: string; status: string; permissions: string[] } | null = null;
vi.mock("@/lib/auth", () => ({
  auth: async () => (sessionUser ? { user: sessionUser } : null),
}));

// Simulates the real query's own participant-scoping WHERE clause
// (`participants: { some: { userId } }`) rather than a bare mock return —
// so "not-found for a non-participant" is proven by the same filtering
// logic the production query relies on, not asserted by fiat.
let tasks: Record<string, { id: string; createdById: string; status: string; participantIds: string[] }>;
const taskFindFirstMock = vi.fn(async ({ where }: { where: { id: string; participants: { some: { userId: string } } } }) => {
  const task = tasks[where.id];
  if (!task) return null;
  if (!task.participantIds.includes(where.participants.some.userId)) return null;
  return { id: task.id, createdById: task.createdById, status: task.status };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      findFirst: (...args: unknown[]) => taskFindFirstMock(...(args as [never])),
    },
  },
}));

function setSession(overrides: Partial<{ id: string; role: string; permissions: string[] }> = {}) {
  sessionUser = {
    id: overrides.id ?? "user-1",
    role: overrides.role ?? "Staff",
    status: "ACTIVE",
    permissions: overrides.permissions ?? ["task.daily_task.view"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionUser = null;
  tasks = {
    "task-1": { id: "task-1", createdById: "creator-1", status: "ACTIVE", participantIds: ["creator-1", "participant-1"] },
  };
});

describe("checkTaskAccess — Collaborator Permission Model", () => {
  it("Case 10: NONE permission + non-participant has no module access at all", async () => {
    setSession({ id: "outsider-1", permissions: [] });
    const { checkTaskAccess } = await import("../access");
    const result = await checkTaskAccess("task-1");
    expect(result).toEqual({ kind: "no-module-access" });
  });

  it("Case 8: VIEW permission + non-participant gets not-found (existing privacy-by-participation design, unexpanded)", async () => {
    setSession({ id: "outsider-1", permissions: ["task.daily_task.view"] });
    const { checkTaskAccess } = await import("../access");
    const result = await checkTaskAccess("task-1");
    expect(result).toEqual({ kind: "not-found" });
  });

  it("Case 1: Creator is a collaborator (canEdit) and can delete (canDelete)", async () => {
    setSession({ id: "creator-1", permissions: ["task.daily_task.edit"] });
    const { checkTaskAccess } = await import("../access");
    const result = await checkTaskAccess("task-1");
    expect(result).toMatchObject({ kind: "ok", isCreator: true, isParticipant: true, isAdmin: false, canEdit: true, canDelete: true });
  });

  it("Case 2/3/9: a plain Participant with only VIEW module permission is still a full collaborator (canEdit) but cannot delete", async () => {
    setSession({ id: "participant-1", permissions: ["task.daily_task.view"] });
    const { checkTaskAccess } = await import("../access");
    const result = await checkTaskAccess("task-1");
    expect(result).toMatchObject({ kind: "ok", isCreator: false, isParticipant: true, isAdmin: false, canEdit: true, canDelete: false, moduleCanEdit: false });
  });

  it("Case 7: a plain Participant cannot delete (canDelete stays Admin/Creator-only)", async () => {
    setSession({ id: "participant-1", permissions: ["task.daily_task.edit"] });
    const { checkTaskAccess } = await import("../access");
    const result = await checkTaskAccess("task-1");
    expect(result).toMatchObject({ canEdit: true, canDelete: false });
  });

  it("Case 11: Admin gets full collaborator + delete rights even without literally being the Creator", async () => {
    tasks["task-1"].participantIds.push("admin-1");
    setSession({ id: "admin-1", role: "ADMIN", permissions: [] });
    const { checkTaskAccess } = await import("../access");
    const result = await checkTaskAccess("task-1");
    expect(result).toMatchObject({ kind: "ok", isAdmin: true, canEdit: true, canDelete: true });
  });

  it("Case 5: a user newly added as a Participant immediately reaches 'ok' with collaborator rights (visibility is live off the TaskParticipant table)", async () => {
    setSession({ id: "new-helper-1", permissions: ["task.daily_task.view"] });
    const { checkTaskAccess } = await import("../access");

    // Before being added: not a participant yet.
    expect(await checkTaskAccess("task-1")).toEqual({ kind: "not-found" });

    // Simulates updateParticipantsAction having just inserted their
    // TaskParticipant row — no other state changes.
    tasks["task-1"].participantIds.push("new-helper-1");

    const result = await checkTaskAccess("task-1");
    expect(result).toMatchObject({ kind: "ok", isParticipant: true, canEdit: true });
  });
});
