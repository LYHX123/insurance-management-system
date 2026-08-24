import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { config as loadDotenv } from "dotenv";

loadDotenv();

// Real-time unread notification (this session) — real-database combination
// test tying together the full chain: a real Server Action mutation, on a
// real Postgres-backed Task, publishing through the real (unmocked)
// liveNotifications broker to the real subscription mechanism the SSE route
// uses. Mirrors the audit's readState.dualUser.integration.test.ts
// technique (real prisma, mocked auth/next-cache only).

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let sessionUserId: string | null = null;
vi.mock("@/lib/auth", () => ({
  auth: async () =>
    sessionUserId
      ? { user: { id: sessionUserId, role: "Staff", status: "ACTIVE", permissions: ["task.daily_task"] } }
      : null,
}));

let dbReachable = true;
let prisma: typeof import("@/lib/prisma").prisma;
let addStepAction: typeof import("../actions").addStepAction;
let subscribeUserTaskNotifications: typeof import("@/lib/task/liveNotifications").subscribeUserTaskNotifications;
type TaskActivityEvent = import("@/lib/task/liveNotifications").TaskActivityEvent;

beforeAll(async () => {
  try {
    ({ prisma } = await import("@/lib/prisma"));
    ({ addStepAction } = await import("../actions"));
    ({ subscribeUserTaskNotifications } = await import("@/lib/task/liveNotifications"));
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error(
      "liveNotifications.integration.test: no reachable database — skipping real-DB assertions.",
      err
    );
    dbReachable = false;
  }
});

describe("Real-time unread notification — mutation-to-broker chain, real database, real Server Action", () => {
  const suffix = randomUUID().slice(0, 8);
  const aId = `test-liveA-${suffix}`;
  const bId = `test-liveB-${suffix}`;
  const cId = `test-liveC-${suffix}`; // not a participant
  let taskId: string;

  beforeAll(async () => {
    if (!dbReachable) return;
    await prisma.user.createMany({
      data: [aId, bId, cId].map((id, i) => ({
        id,
        username: `test-live-${suffix}-${i}`,
        fullName: `Audit Live Test User ${i}`,
        passwordHash: "x",
        status: "ACTIVE",
      })),
    });
    const task = await prisma.task.create({
      data: {
        category: "DAILY_TASK",
        title: `Live notification test ${suffix}`,
        createdById: aId,
        participants: { createMany: { data: [{ userId: aId, addedById: aId }, { userId: bId, addedById: aId }] } },
        steps: { create: { content: "initial step", createdById: aId } },
      },
    });
    taskId = task.id;
  });

  afterAll(async () => {
    if (!dbReachable) return;
    await prisma.task.delete({ where: { id: taskId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [aId, bId, cId] } } });
  });

  it("T4/T5/T7/T10: A adding a Step publishes to B only — not to A (the actor), and not to C (a non-participant)", async () => {
    if (!dbReachable) return;

    const receivedA: TaskActivityEvent[] = [];
    const receivedB: TaskActivityEvent[] = [];
    const receivedC: TaskActivityEvent[] = [];
    const unsubA = subscribeUserTaskNotifications(aId, (e) => receivedA.push(e));
    const unsubB = subscribeUserTaskNotifications(bId, (e) => receivedB.push(e));
    const unsubC = subscribeUserTaskNotifications(cId, (e) => receivedC.push(e));

    sessionUserId = aId;
    const result = await addStepAction(taskId, "A real step from the live-notification test.");
    expect(result.success).toBe(true);

    expect(receivedA).toHaveLength(0);
    expect(receivedB).toHaveLength(1);
    expect(receivedB[0]).toMatchObject({ scope: "TASK", entityId: taskId, actorUserId: aId });
    expect(receivedC).toHaveLength(0);

    unsubA();
    unsubB();
    unsubC();
  });

  it("T6: once C is added as a Participant, a subsequent mutation DOES reach C", async () => {
    if (!dbReachable) return;
    const { updateParticipantsAction } = await import("../actions");

    sessionUserId = aId;
    const addResult = await updateParticipantsAction(taskId, [bId, cId]);
    expect(addResult.success).toBe(true);

    const receivedC: TaskActivityEvent[] = [];
    const unsubC = subscribeUserTaskNotifications(cId, (e) => receivedC.push(e));

    sessionUserId = bId;
    const stepResult = await addStepAction(taskId, "Second step, after C joined.");
    expect(stepResult.success).toBe(true);

    expect(receivedC).toHaveLength(1);
    unsubC();
  });
});
