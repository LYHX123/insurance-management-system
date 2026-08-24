import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { config as loadDotenv } from "dotenv";

// vitest does not auto-load .env — see the identical note in
// src/lib/task/__tests__/readState.dualUser.integration.test.ts.
loadDotenv();

// "New Participant gets no red dot" fix (2026-08-24) — real-database
// combination test covering spec Cases 1-5. Unlike every other test in this
// suite, this exercises the REAL exported Server Actions (createTaskAction,
// updateParticipantsAction) against the real local Postgres instance and
// the real, unmocked src/lib/task/readState.ts / queries.ts — only `auth()`
// and `next/cache`'s revalidatePath are stubbed (a Server Action's own
// session/framework plumbing, not anything under test).

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
let createTaskAction: typeof import("../actions").createTaskAction;
let updateParticipantsAction: typeof import("../actions").updateParticipantsAction;
let getVisibleTasksForCategory: typeof import("@/lib/task/queries").getVisibleTasksForCategory;
let markTaskViewed: typeof import("@/lib/task/readState").markTaskViewed;

beforeAll(async () => {
  try {
    ({ prisma } = await import("@/lib/prisma"));
    ({ createTaskAction, updateParticipantsAction } = await import("../actions"));
    ({ getVisibleTasksForCategory } = await import("@/lib/task/queries"));
    ({ markTaskViewed } = await import("@/lib/task/readState"));
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error(
      "readState.newParticipant.integration.test: no reachable database (is `docker compose up -d db` running, and does DATABASE_URL in .env point at it?) — skipping real-DB assertions.",
      err
    );
    dbReachable = false;
  }
});

describe("Task Unread Red-Dot — new Participant initialization, real database, real Server Actions", () => {
  const suffix = randomUUID().slice(0, 8);
  const aId = `test-npA-${suffix}`;
  const bId = `test-npB-${suffix}`;
  const cId = `test-npC-${suffix}`;
  const createdTaskIds: string[] = [];

  beforeAll(async () => {
    if (!dbReachable) return;
    await prisma.user.createMany({
      data: [aId, bId, cId].map((id, i) => ({
        id,
        username: `test-np-${suffix}-${i}`,
        fullName: `Audit New-Participant Test User ${i}`,
        passwordHash: "x",
        status: "ACTIVE",
      })),
    });
  });

  afterAll(async () => {
    if (!dbReachable) return;
    if (createdTaskIds.length > 0) await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [aId, bId, cId] } } });
  });

  function isUnreadFor(list: Awaited<ReturnType<typeof getVisibleTasksForCategory>>, taskId: string) {
    return list.find((t) => t.id === taskId)?.isUnread;
  }

  it("Case 1 & 2: A creates a Task with Participants A+B — A caught up, B unread from a genuinely zero-row baseline", async () => {
    if (!dbReachable) return;
    sessionUserId = aId;
    const result = await createTaskAction({
      categorySlug: "daily",
      title: `NP Case1/2 ${suffix}`,
      startAction: "Initial step",
      participantIds: [bId],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    createdTaskIds.push(result.id);

    // B had zero TaskReadState rows anywhere before this action ran; prove
    // the action itself wrote exactly one explicit row for B.
    const bRows = await prisma.taskReadState.findMany({ where: { userId: bId } });
    expect(bRows).toHaveLength(1);
    expect(bRows[0].taskId).toBe(result.id);

    expect(isUnreadFor(await getVisibleTasksForCategory(aId, "DAILY_TASK"), result.id)).toBe(false);
    // B's very own first-ever list load runs ensureTaskReadStateBaseline —
    // this is exactly the scenario baseline must NOT be allowed to
    // overwrite (Case 2's "baseline 不允许把它覆盖成已读").
    expect(isUnreadFor(await getVisibleTasksForCategory(bId, "DAILY_TASK"), result.id)).toBe(true);
  });

  it("Case 3: a genuinely historical Task this user silently participates in is NOT flooded unread, even once they're already 'established'", async () => {
    if (!dbReachable) return;
    sessionUserId = aId;

    // Give B a row on an unrelated Task first, so B is already
    // "established" (has ≥1 TaskReadState row) by the time the historical
    // Task below is checked — this is exactly the edge case the old global
    // "has any row anywhere" gate got wrong (see ensureTaskReadStateBaseline's
    // updated comment in src/lib/task/readState.ts).
    const unrelated = await prisma.task.create({
      data: {
        category: "DAILY_TASK",
        title: `NP Case3 unrelated ${suffix}`,
        createdById: aId,
        participants: { createMany: { data: [{ userId: aId, addedById: aId }, { userId: bId, addedById: aId }] } },
        steps: { create: { content: "x", createdById: aId } },
      },
    });
    createdTaskIds.push(unrelated.id);
    await markTaskViewed(bId, unrelated.id);

    // A second, genuinely historical Task: B silently participates via raw
    // rows (bypassing createTaskAction/updateParticipantsAction entirely —
    // simulating data older than this fix, or added by an admin import)
    // with NO read-state row of their own.
    const historical = await prisma.task.create({
      data: {
        category: "DAILY_TASK",
        title: `NP Case3 historical ${suffix}`,
        createdById: aId,
        participants: { createMany: { data: [{ userId: aId, addedById: aId }, { userId: bId, addedById: aId }] } },
        steps: { create: { content: "history", createdById: aId } },
      },
    });
    createdTaskIds.push(historical.id);

    expect(isUnreadFor(await getVisibleTasksForCategory(bId, "DAILY_TASK"), historical.id)).toBe(false);
  });

  it("Case 4 & 5: existing A+B Task — B adds C — A and C go unread, B (the actor) stays read; C opening it clears C's own unread", async () => {
    if (!dbReachable) return;
    sessionUserId = aId;
    const createResult = await createTaskAction({
      categorySlug: "daily",
      title: `NP Case4/5 ${suffix}`,
      startAction: "Initial step",
      participantIds: [bId],
    });
    expect(createResult.success).toBe(true);
    if (!createResult.success) return;
    const taskId = createResult.id;
    createdTaskIds.push(taskId);

    // Both A and B start caught up.
    await markTaskViewed(bId, taskId);

    sessionUserId = bId;
    const updateResult = await updateParticipantsAction(taskId, [bId, cId]);
    expect(updateResult.success).toBe(true);

    expect(isUnreadFor(await getVisibleTasksForCategory(aId, "DAILY_TASK"), taskId)).toBe(true); // Case 4 — A
    expect(isUnreadFor(await getVisibleTasksForCategory(cId, "DAILY_TASK"), taskId)).toBe(true); // Case 4 — C
    expect(isUnreadFor(await getVisibleTasksForCategory(bId, "DAILY_TASK"), taskId)).toBe(false); // Case 4 — B (actor)

    // Case 5.
    await markTaskViewed(cId, taskId);
    expect(isUnreadFor(await getVisibleTasksForCategory(cId, "DAILY_TASK"), taskId)).toBe(false);
  });
});
