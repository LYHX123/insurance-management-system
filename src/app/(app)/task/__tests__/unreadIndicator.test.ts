import { describe, it, expect, vi, beforeEach } from "vitest";

// Task User-Level Unread Indicator — end-to-end coverage over the real
// Server Actions (addStepAction, completeTaskAction, reopenTaskAction,
// updateParticipantsAction, updateTaskTitleAction) plus the real
// src/lib/task/readState.ts helpers, all driven through one small
// in-memory fake Prisma double so a mutation made through an action is
// actually visible to a read-state query made afterward in the same test —
// this is what lets Case 7/9/11/12/13/19 assert the real cross-user
// unread/read outcome, not just "the upsert mock was called".

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

const checkTaskAccess = vi.fn();
vi.mock("@/lib/task/access", () => ({
  checkTaskAccess: (...args: unknown[]) => checkTaskAccess(...args),
}));

type FakeTask = {
  id: string;
  status: "ACTIVE" | "COMPLETED";
  createdById: string;
  updatedAt: Date;
  deletedAt: Date | null;
};
type FakeReadState = { taskId: string; userId: string; lastViewedAt: Date };
type FakeStep = { id: string; taskId: string; createdById: string; content: string; deletedAt: Date | null; editedAt: Date | null };

// Deterministic, strictly-monotonic clock (not real wall time) — every
// mutation and every read-state write advances it by exactly one tick, so
// "did B's update happen after A's view" can be asserted without any
// risk of two `new Date()` calls landing in the same millisecond.
const BASE_MS = Date.UTC(2026, 0, 1);
let clock = 0;
function tick(): Date {
  clock += 1;
  return new Date(BASE_MS + clock);
}

let tasks: Map<string, FakeTask>;
let readStates: Map<string, FakeReadState>;
let steps: Map<string, FakeStep>;
let participants: Map<string, { taskId: string; userId: string }>;
let users: Map<string, { id: string; status: string }>;
let stepCounter: number;

function rsKey(taskId: string, userId: string) {
  return `${taskId}:${userId}`;
}

// A single object, built once, so `$transaction`'s callback can be handed
// this exact same instance as `tx` — every delegate method closes over the
// outer `let` state variables (read at call time, not capture time), so
// resetting those variables in beforeEach is enough; the double itself
// never needs to be rebuilt per test.
function createPrismaDouble() {
  const double = {
    task: {
      findMany: async ({ where, select }: { where: { id: { in: string[] } }; select?: { updatedAt?: boolean } }) =>
        [...tasks.values()]
          .filter((t) => where.id.in.includes(t.id))
          .map((t) => (select?.updatedAt ? { id: t.id, updatedAt: t.updatedAt } : { id: t.id })),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const t = tasks.get(where.id);
        if (!t) throw new Error("task not found");
        Object.assign(t, data);
        t.updatedAt = tick();
        return t;
      },
      updateMany: async ({ where, data }: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
        const t = tasks.get(where.id);
        if (!t || (where.status && t.status !== where.status)) return { count: 0 };
        Object.assign(t, data);
        t.updatedAt = tick();
        return { count: 1 };
      },
    },
    taskParticipant: {
      findMany: async ({ where }: { where: { taskId: string } }) =>
        [...participants.values()].filter((p) => p.taskId === where.taskId).map((p) => ({ userId: p.userId })),
      createMany: async ({ data }: { data: { taskId: string; userId: string }[] }) => {
        for (const d of data) participants.set(rsKey(d.taskId, d.userId), d);
        return { count: data.length };
      },
      deleteMany: async ({ where }: { where: { taskId: string; userId: { in: string[] } } }) => {
        let count = 0;
        for (const uid of where.userId.in) if (participants.delete(rsKey(where.taskId, uid))) count++;
        return { count };
      },
    },
    taskStep: {
      create: async ({ data }: { data: { taskId: string; content: string; createdById: string } }) => {
        const id = `step-${++stepCounter}`;
        const s: FakeStep = { id, taskId: data.taskId, content: data.content, createdById: data.createdById, deletedAt: null, editedAt: null };
        steps.set(id, s);
        return s;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const s = steps.get(where.id);
        return s ? { taskId: s.taskId, createdById: s.createdById, deletedAt: s.deletedAt } : null;
      },
      count: async ({ where }: { where: { taskId: string; deletedAt: null } }) =>
        [...steps.values()].filter((s) => s.taskId === where.taskId && s.deletedAt === null).length,
    },
    taskReadState: {
      findFirst: async ({ where }: { where: { userId: string } }) => {
        const row = [...readStates.values()].find((r) => r.userId === where.userId);
        return row ?? null;
      },
      findMany: async ({ where }: { where: { userId: string; taskId: { in: string[] } } }) =>
        [...readStates.values()].filter((r) => r.userId === where.userId && where.taskId.in.includes(r.taskId)),
      createMany: async ({ data }: { data: FakeReadState[] }) => {
        let count = 0;
        for (const d of data) {
          const k = rsKey(d.taskId, d.userId);
          if (!readStates.has(k)) {
            readStates.set(k, { ...d });
            count++;
          }
        }
        return { count };
      },
      upsert: async ({ where }: { where: { taskId_userId: { taskId: string; userId: string } } }) => {
        const { taskId, userId } = where.taskId_userId;
        const k = rsKey(taskId, userId);
        const row: FakeReadState = { taskId, userId, lastViewedAt: tick() };
        readStates.set(k, row);
        return row;
      },
    },
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] }; status: string } }) =>
        [...users.values()].filter((u) => where.id.in.includes(u.id) && u.status === where.status),
    },
  };
  // $transaction hands its callback this exact same double as `tx` — every
  // action's tx.task.update / tx.taskReadState.upsert etc. call therefore
  // lands on the identical in-memory state top-level `prisma.*` calls (and
  // readState.ts's own queries) read from afterward.
  return Object.assign(double, { $transaction: async (cb: (tx: unknown) => unknown) => cb(double) });
}

vi.mock("@/lib/prisma", () => ({ prisma: createPrismaDouble() }));

function seedTask(id: string, overrides: Partial<FakeTask> = {}) {
  tasks.set(id, { id, status: "ACTIVE", createdById: "creator-1", updatedAt: tick(), deletedAt: null, ...overrides });
}

function okAccess(overrides: Partial<{ isCreator: boolean; isAdmin: boolean; canEdit: boolean; canDelete: boolean; status: string; userId: string }> = {}) {
  return {
    kind: "ok" as const,
    userId: overrides.userId ?? "participant-1",
    taskId: "task-1",
    createdById: "creator-1",
    status: overrides.status ?? "ACTIVE",
    isCreator: overrides.isCreator ?? false,
    isParticipant: true,
    isAdmin: overrides.isAdmin ?? false,
    moduleCanEdit: overrides.canEdit ?? true,
    canEdit: overrides.canEdit ?? true,
    canDelete: overrides.canDelete ?? false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tasks = new Map();
  readStates = new Map();
  steps = new Map();
  participants = new Map();
  users = new Map();
  stepCounter = 0;
  clock = 0;

  seedTask("task-1");
  participants.set(rsKey("task-1", "creator-1"), { taskId: "task-1", userId: "creator-1" });
  participants.set(rsKey("task-1", "user-a"), { taskId: "task-1", userId: "user-a" });
  participants.set(rsKey("task-1", "user-b"), { taskId: "task-1", userId: "user-b" });
  users.set("helper-1", { id: "helper-1", status: "ACTIVE" });
});

describe("Task User-Level Unread Indicator", () => {
  // Case 6 was rewritten as part of the 2026-08-24 "new Participant gets no
  // red dot" fix. The old version of this test asserted that ANY user with
  // at least one TaskReadState row elsewhere ("an established feature
  // user") must see any other missing-row Task as unread — i.e. it pinned
  // down the exact global "has any row anywhere" gate in
  // ensureTaskReadStateBaseline that turned out to be the root cause of the
  // "new Participant, no red dot" bug (see that function's updated comment
  // in src/lib/task/readState.ts): a user who happens to already have a
  // row from being freshly, explicitly added to some OTHER brand-new Task
  // (initializeUnreadTaskReadStates) is not truly "established" with
  // respect to every other Task they silently participate in — baseline
  // must still be free to catch those up, exactly as it would for a
  // genuinely first-time user. This is that guarantee, made explicit.
  it("Case 6: a merely-established user (has a row for one unrelated Task) does not stop baseline from catching up a DIFFERENT, genuinely never-visited Task", async () => {
    seedTask("task-2");
    participants.set(rsKey("task-2", "user-a"), { taskId: "task-2", userId: "user-a" });
    // user-a already has an explicit row for task-2 (e.g. freshly added
    // there just now) — this alone must not make task-1 look "already
    // established" and get wrongly caught up... nor, per this fix, should
    // it make task-1 wrongly unread either: task-1 is a task user-a has
    // silently participated in with no row of their own at all, which is
    // exactly what baseline's gap-fill exists to catch up.
    readStates.set(rsKey("task-2", "user-a"), { taskId: "task-2", userId: "user-a", lastViewedAt: tick() });

    const { getUnreadTaskIds, markTaskViewed } = await import("@/lib/task/readState");
    const task1 = tasks.get("task-1")!;

    // task-1 has no row for user-a at all -> baseline catches it up as read
    // (not flooded unread) despite user-a already having a row elsewhere.
    let unread = await getUnreadTaskIds("user-a", [{ id: "task-1", updatedAt: task1.updatedAt }]);
    expect(unread.has("task-1")).toBe(false);
    expect(readStates.has(rsKey("task-1", "user-a"))).toBe(true);

    // Once genuinely edited after that baseline catch-up, it behaves like
    // any other Task: it goes unread again, and viewing it clears that.
    tasks.get("task-1")!.updatedAt = tick();
    unread = await getUnreadTaskIds("user-a", [{ id: "task-1", updatedAt: tasks.get("task-1")!.updatedAt }]);
    expect(unread.has("task-1")).toBe(true);

    await markTaskViewed("user-a", "task-1");
    unread = await getUnreadTaskIds("user-a", [{ id: "task-1", updatedAt: tasks.get("task-1")!.updatedAt }]);
    expect(unread.has("task-1")).toBe(false);
  });

  it("Case 7/10: user B's Add Next Step makes user A unread while user B stays read — independent per-user state", async () => {
    const { markTaskViewed, getUnreadTaskIds } = await import("@/lib/task/readState");
    const { addStepAction } = await import("../actions");

    // Both A and B start caught up.
    await markTaskViewed("user-a", "task-1");
    await markTaskViewed("user-b", "task-1");

    checkTaskAccess.mockResolvedValue(okAccess({ userId: "user-b" }));
    const result = await addStepAction("task-1", "Called the customer back.");
    expect(result.success).toBe(true);

    const task = tasks.get("task-1")!;
    const unreadForA = await getUnreadTaskIds("user-a", [{ id: "task-1", updatedAt: task.updatedAt }]);
    const unreadForB = await getUnreadTaskIds("user-b", [{ id: "task-1", updatedAt: task.updatedAt }]);
    expect(unreadForA.has("task-1")).toBe(true); // Case 7
    expect(unreadForB.has("task-1")).toBe(false); // Case 9/19 — the actor never sees their own edit as unread
  });

  it("Case 8: viewing the Task (markTaskViewed) clears an existing unread state", async () => {
    const { markTaskViewed, getUnreadTaskIds } = await import("@/lib/task/readState");
    const { addStepAction } = await import("../actions");

    await markTaskViewed("user-a", "task-1");
    checkTaskAccess.mockResolvedValue(okAccess({ userId: "user-b" }));
    await addStepAction("task-1", "Update.");

    const task = tasks.get("task-1")!;
    expect((await getUnreadTaskIds("user-a", [{ id: "task-1", updatedAt: task.updatedAt }])).has("task-1")).toBe(true);

    await markTaskViewed("user-a", "task-1");
    expect((await getUnreadTaskIds("user-a", [{ id: "task-1", updatedAt: task.updatedAt }])).has("task-1")).toBe(false);
  });

  it("Case 11: Add Next Step by one participant makes every other already-caught-up participant unread", async () => {
    const { markTaskViewed, getUnreadTaskIds } = await import("@/lib/task/readState");
    const { addStepAction } = await import("../actions");

    await markTaskViewed("user-a", "task-1");
    await markTaskViewed("creator-1", "task-1");

    checkTaskAccess.mockResolvedValue(okAccess({ userId: "user-b" }));
    await addStepAction("task-1", "Add Next Step content.");

    const task = tasks.get("task-1")!;
    expect((await getUnreadTaskIds("user-a", [{ id: "task-1", updatedAt: task.updatedAt }])).has("task-1")).toBe(true);
    expect((await getUnreadTaskIds("creator-1", [{ id: "task-1", updatedAt: task.updatedAt }])).has("task-1")).toBe(true);
  });

  it("Case 12: Complete then Reopen each independently produce unread for other participants, never for the actor", async () => {
    const { markTaskViewed, getUnreadTaskIds } = await import("@/lib/task/readState");
    const { completeTaskAction, reopenTaskAction } = await import("../actions");

    await markTaskViewed("user-a", "task-1");
    await markTaskViewed("user-b", "task-1");

    checkTaskAccess.mockResolvedValue(okAccess({ userId: "user-b", canEdit: true }));
    const completeResult = await completeTaskAction("task-1");
    expect(completeResult).toEqual({ success: true });

    let task = tasks.get("task-1")!;
    expect((await getUnreadTaskIds("user-a", [{ id: "task-1", updatedAt: task.updatedAt }])).has("task-1")).toBe(true);
    expect((await getUnreadTaskIds("user-b", [{ id: "task-1", updatedAt: task.updatedAt }])).has("task-1")).toBe(false);

    // A catches up, then B reopens — A must go unread again from this
    // second, independent change.
    await markTaskViewed("user-a", "task-1");
    checkTaskAccess.mockResolvedValue(okAccess({ userId: "user-b", canEdit: true, status: "COMPLETED" }));
    const reopenResult = await reopenTaskAction("task-1");
    expect(reopenResult).toEqual({ success: true });

    task = tasks.get("task-1")!;
    expect((await getUnreadTaskIds("user-a", [{ id: "task-1", updatedAt: task.updatedAt }])).has("task-1")).toBe(true);
    expect((await getUnreadTaskIds("user-b", [{ id: "task-1", updatedAt: task.updatedAt }])).has("task-1")).toBe(false);
  });

  it("Case 13: Manage Participants — the acting user stays read, an existing caught-up participant goes unread", async () => {
    const { markTaskViewed, getUnreadTaskIds } = await import("@/lib/task/readState");
    const { updateParticipantsAction } = await import("../actions");

    await markTaskViewed("user-a", "task-1");
    await markTaskViewed("user-b", "task-1");

    checkTaskAccess.mockResolvedValue(okAccess({ userId: "user-b" }));
    const result = await updateParticipantsAction("task-1", ["user-a", "user-b", "helper-1"]);
    expect(result).toEqual({ success: true });

    const task = tasks.get("task-1")!;
    expect((await getUnreadTaskIds("user-a", [{ id: "task-1", updatedAt: task.updatedAt }])).has("task-1")).toBe(true);
    expect((await getUnreadTaskIds("user-b", [{ id: "task-1", updatedAt: task.updatedAt }])).has("task-1")).toBe(false);
  });

  it("Case 19 (rename): updateTaskTitleAction never leaves the acting Creator's own copy unread", async () => {
    const { markTaskViewed, getUnreadTaskIds } = await import("@/lib/task/readState");
    const { updateTaskTitleAction } = await import("../actions");

    await markTaskViewed("creator-1", "task-1");
    checkTaskAccess.mockResolvedValue(okAccess({ userId: "creator-1", isCreator: true }));
    const result = await updateTaskTitleAction("task-1", "Renamed");
    expect(result).toEqual({ success: true });

    const task = tasks.get("task-1")!;
    expect((await getUnreadTaskIds("creator-1", [{ id: "task-1", updatedAt: task.updatedAt }])).has("task-1")).toBe(false);
  });

  it("Case 14: unread computation never widens visibility — a Task id never passed in is simply never returned as unread, no matter its state", async () => {
    seedTask("task-secret");
    const { getUnreadTaskIds } = await import("@/lib/task/readState");
    // user-a is never a participant of task-secret and it is never passed
    // into getUnreadTaskIds — mirrors how getVisibleTasksForCategory only
    // ever passes Tasks its own participant-scoped WHERE clause returned.
    const unread = await getUnreadTaskIds("user-a", [{ id: "task-1", updatedAt: tasks.get("task-1")!.updatedAt }]);
    expect(unread.has("task-secret")).toBe(false);
    expect([...unread].every((id) => id === "task-1")).toBe(true);
  });

  it("Case 15: a user's very first-ever list load establishes a baseline — nothing is unread on that first load, even though the Task was updated long before", async () => {
    // Simulates a pre-existing Task with real activity history, and a user
    // who has NEVER opened the Task module since this feature shipped (zero
    // TaskReadState rows anywhere for them) — this is the migration-day
    // scenario Part B8 exists for.
    const task = tasks.get("task-1")!;
    task.updatedAt = tick(); // further activity, well after task creation

    const { getUnreadTaskIds } = await import("@/lib/task/readState");
    const firstLoad = await getUnreadTaskIds("brand-new-viewer", [{ id: "task-1", updatedAt: task.updatedAt }]);
    expect(firstLoad.has("task-1")).toBe(false);

    // A genuinely new update AFTER that baseline was established must still
    // correctly produce unread — the baseline isn't a permanent exemption.
    task.updatedAt = tick();
    const afterRealUpdate = await getUnreadTaskIds("brand-new-viewer", [{ id: "task-1", updatedAt: task.updatedAt }]);
    expect(afterRealUpdate.has("task-1")).toBe(true);
  });

  it("Case 16: mark-as-read is a pure server-side data write — it never touches the client-side scroll store (see taskListScroll.ts)", async () => {
    const { getTaskListScroll, saveTaskListScroll, clearTaskListScroll } = await import("@/components/task/taskListScroll");
    const { markTaskViewed } = await import("@/lib/task/readState");

    saveTaskListScroll("daily", 480);
    await markTaskViewed("user-a", "task-1");
    expect(getTaskListScroll("daily")).toBe(480);
    clearTaskListScroll("daily");
  });

  it("Case 20: concurrent mark-read calls for the same (user, Task) never throw and settle on one consistent, read state", async () => {
    const { markTaskViewed, getUnreadTaskIds } = await import("@/lib/task/readState");

    await expect(Promise.all([markTaskViewed("user-a", "task-1"), markTaskViewed("user-a", "task-1")])).resolves.toBeDefined();

    const task = tasks.get("task-1")!;
    expect((await getUnreadTaskIds("user-a", [{ id: "task-1", updatedAt: task.updatedAt }])).has("task-1")).toBe(false);
    // At most one row exists for (task-1, user-a) — a race never fans out
    // into duplicate rows (the unique (taskId, userId) constraint backs
    // this in the real database; this asserts the fake's upsert honors the
    // same one-row-per-pair contract).
    expect([...readStates.values()].filter((r) => r.taskId === "task-1" && r.userId === "user-a")).toHaveLength(1);
  });
});
