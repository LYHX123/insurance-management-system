import { describe, it, expect, vi, beforeEach } from "vitest";

// Task Collaborator Permission Model — Cases 1-9 + 14 from this phase's
// spec (Part XII): a Task Participant must be able to Complete/Reopen the
// Task, add a Step (progress update), and add/remove other Participants,
// while Delete Task and Rename Task stay Creator/Admin-only. Mocks
// checkTaskAccess directly (same convention as
// src/app/(app)/task/motor-claim/__tests__/documentActions.permission.test.ts)
// so each test proves the Server Action's OWN gate, independent of the
// access-composition already covered by src/lib/task/__tests__/access.test.ts.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// actions.ts also statically imports `auth` (for createTaskAction, not
// exercised by these tests) — stubbed so importing the module never pulls
// in the real next-auth/next-server wiring, which this test environment
// can't resolve.
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

const checkTaskAccess = vi.fn();
vi.mock("@/lib/task/access", () => ({
  checkTaskAccess: (...args: unknown[]) => checkTaskAccess(...args),
}));

const taskUpdateManyMock = vi.fn();
const taskUpdateMock = vi.fn();
const taskParticipantFindManyMock = vi.fn();
const taskParticipantDeleteManyMock = vi.fn();
const taskParticipantCreateManyMock = vi.fn();
const userFindManyMock = vi.fn();
const taskStepCreateMock = vi.fn();
// Task User-Level Unread Indicator — every mutation also touches the acting
// user's own TaskReadState row (see touchOwnTaskReadState in ../actions.ts);
// the mocked `tx` must expose it too or every action above throws.
const taskReadStateUpsertMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      updateMany: (...args: unknown[]) => taskUpdateManyMock(...args),
      update: (...args: unknown[]) => taskUpdateMock(...args),
    },
    taskParticipant: {
      findMany: (...args: unknown[]) => taskParticipantFindManyMock(...args),
      deleteMany: (...args: unknown[]) => taskParticipantDeleteManyMock(...args),
      createMany: (...args: unknown[]) => taskParticipantCreateManyMock(...args),
    },
    user: {
      findMany: (...args: unknown[]) => userFindManyMock(...args),
    },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        task: {
          update: (...args: unknown[]) => taskUpdateMock(...args),
          updateMany: (...args: unknown[]) => taskUpdateManyMock(...args),
        },
        taskParticipant: {
          deleteMany: (...args: unknown[]) => taskParticipantDeleteManyMock(...args),
          createMany: (...args: unknown[]) => taskParticipantCreateManyMock(...args),
        },
        taskStep: { create: (...args: unknown[]) => taskStepCreateMock(...args) },
        taskReadState: { upsert: (...args: unknown[]) => taskReadStateUpsertMock(...args) },
      }),
  },
}));

function okAccess(overrides: Partial<{
  isCreator: boolean;
  isParticipant: boolean;
  isAdmin: boolean;
  canEdit: boolean;
  canDelete: boolean;
  status: string;
  createdById: string;
}> = {}) {
  return {
    kind: "ok" as const,
    userId: overrides.isCreator ? "creator-1" : "participant-1",
    taskId: "task-1",
    createdById: overrides.createdById ?? "creator-1",
    status: overrides.status ?? "ACTIVE",
    isCreator: overrides.isCreator ?? false,
    isParticipant: overrides.isParticipant ?? true,
    isAdmin: overrides.isAdmin ?? false,
    moduleCanEdit: overrides.canEdit ?? true,
    canEdit: overrides.canEdit ?? true,
    canDelete: overrides.canDelete ?? false,
  };
}

// A plain Participant: not the Creator, not Admin, but a collaborator.
const participantAccess = () => okAccess({ isCreator: false, isAdmin: false, canEdit: true, canDelete: false });
const creatorAccess = () => okAccess({ isCreator: true, isAdmin: false, canEdit: true, canDelete: true });

beforeEach(() => {
  vi.clearAllMocks();
  taskUpdateManyMock.mockResolvedValue({ count: 1 });
  taskUpdateMock.mockResolvedValue({});
  taskParticipantFindManyMock.mockResolvedValue([{ userId: "creator-1" }, { userId: "participant-1" }]);
  taskParticipantDeleteManyMock.mockResolvedValue({ count: 1 });
  taskParticipantCreateManyMock.mockResolvedValue({ count: 1 });
  userFindManyMock.mockResolvedValue([{ id: "helper-1" }]);
  taskStepCreateMock.mockResolvedValue({ id: "step-1" });
  taskReadStateUpsertMock.mockResolvedValue({});
});

describe("Case 1/2 — completeTaskAction", () => {
  it("Creator can complete", async () => {
    checkTaskAccess.mockResolvedValue(creatorAccess());
    const { completeTaskAction } = await import("../actions");
    const result = await completeTaskAction("task-1");
    expect(result).toEqual({ success: true });
    expect(taskUpdateManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "task-1", status: "ACTIVE" } }));
  });

  it("a plain Participant (not Creator, not Admin) can also complete", async () => {
    checkTaskAccess.mockResolvedValue(participantAccess());
    const { completeTaskAction } = await import("../actions");
    const result = await completeTaskAction("task-1");
    expect(result).toEqual({ success: true });
  });

  it("Case 14: non-collaborator (canEdit=false) direct call is FORBIDDEN", async () => {
    checkTaskAccess.mockResolvedValue(okAccess({ canEdit: false }));
    const { completeTaskAction } = await import("../actions");
    const result = await completeTaskAction("task-1");
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });
});

describe("reopenTaskAction — Participant collaborator", () => {
  it("a plain Participant can reopen a COMPLETED task", async () => {
    checkTaskAccess.mockResolvedValue(participantAccess());
    const { reopenTaskAction } = await import("../actions");
    const result = await reopenTaskAction("task-1");
    expect(result).toEqual({ success: true });
    expect(taskUpdateManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "task-1", status: "COMPLETED" } }));
  });
});

describe("Case 3 — addStepAction (update progress)", () => {
  it("a plain Participant can add a step", async () => {
    checkTaskAccess.mockResolvedValue(participantAccess());
    const { addStepAction } = await import("../actions");
    const result = await addStepAction("task-1", "Called the customer back.");
    expect(result).toEqual({ success: true, id: "step-1" });
    expect(taskStepCreateMock).toHaveBeenCalled();
  });

  it("non-collaborator cannot add a step", async () => {
    checkTaskAccess.mockResolvedValue(okAccess({ canEdit: false }));
    const { addStepAction } = await import("../actions");
    const result = await addStepAction("task-1", "x");
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(taskStepCreateMock).not.toHaveBeenCalled();
  });
});

describe("Case 4/6 — updateParticipantsAction", () => {
  it("a plain Participant can add another participant", async () => {
    checkTaskAccess.mockResolvedValue(participantAccess());
    const { updateParticipantsAction } = await import("../actions");
    const result = await updateParticipantsAction("task-1", ["participant-1", "helper-1"]);
    expect(result).toEqual({ success: true });
    expect(taskParticipantCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ userId: "helper-1" })]) })
    );
  });

  it("a plain Participant can remove another participant", async () => {
    taskParticipantFindManyMock.mockResolvedValue([{ userId: "creator-1" }, { userId: "participant-1" }, { userId: "helper-1" }]);
    checkTaskAccess.mockResolvedValue(participantAccess());
    const { updateParticipantsAction } = await import("../actions");
    const result = await updateParticipantsAction("task-1", ["participant-1"]);
    expect(result).toEqual({ success: true });
    expect(taskParticipantDeleteManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { taskId: "task-1", userId: { in: ["helper-1"] } } })
    );
  });

  it("Part V safety rule: the Creator can never be removed, even if omitted from the submitted list", async () => {
    checkTaskAccess.mockResolvedValue(participantAccess());
    const { updateParticipantsAction } = await import("../actions");
    // Submits a list that tries to drop the creator entirely.
    await updateParticipantsAction("task-1", []);
    if (taskParticipantDeleteManyMock.mock.calls.length > 0) {
      const call = taskParticipantDeleteManyMock.mock.calls[0][0] as { where: { userId: { in: string[] } } };
      expect(call.where.userId.in).not.toContain("creator-1");
    }
  });

  it("a non-collaborator cannot manage participants", async () => {
    checkTaskAccess.mockResolvedValue(okAccess({ canEdit: false }));
    const { updateParticipantsAction } = await import("../actions");
    const result = await updateParticipantsAction("task-1", ["participant-1", "helper-1"]);
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(taskParticipantCreateManyMock).not.toHaveBeenCalled();
  });
});

describe("Case 7 — deleteTaskAction stays Creator/Admin-only", () => {
  it("a plain Participant cannot delete the Task", async () => {
    checkTaskAccess.mockResolvedValue(participantAccess());
    const { deleteTaskAction } = await import("../actions");
    const result = await deleteTaskAction("task-1");
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
  });

  it("the Creator can delete the Task", async () => {
    checkTaskAccess.mockResolvedValue(creatorAccess());
    const { deleteTaskAction } = await import("../actions");
    const result = await deleteTaskAction("task-1");
    expect(result).toEqual({ success: true });
  });

  it("Case 11: Admin can delete even when not the Creator", async () => {
    checkTaskAccess.mockResolvedValue(okAccess({ isCreator: false, isAdmin: true, canEdit: true, canDelete: true }));
    const { deleteTaskAction } = await import("../actions");
    const result = await deleteTaskAction("task-1");
    expect(result).toEqual({ success: true });
  });
});

describe("updateTaskTitleAction stays Creator/Admin-only (not opened to plain Participants)", () => {
  it("a plain Participant cannot rename the Task", async () => {
    checkTaskAccess.mockResolvedValue(participantAccess());
    const { updateTaskTitleAction } = await import("../actions");
    const result = await updateTaskTitleAction("task-1", "New title");
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("the Creator can rename the Task", async () => {
    checkTaskAccess.mockResolvedValue(creatorAccess());
    const { updateTaskTitleAction } = await import("../actions");
    const result = await updateTaskTitleAction("task-1", "New title");
    expect(result).toEqual({ success: true });
  });
});
