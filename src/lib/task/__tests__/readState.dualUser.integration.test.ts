import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { config as loadDotenv } from "dotenv";

// vitest (unlike `next dev`/`next build`) does not auto-load .env, so
// DATABASE_URL would otherwise be undefined here — load it explicitly,
// before anything below imports the real @/lib/prisma client.
loadDotenv();

// Task User-Level Unread Indicator — real-database combination test (audit
// request, 2026-08-24: "真实 query + action 层组合测试，不要只做纯函数
// mock"). Every other test under src/**/__tests__ mocks @/lib/prisma (see
// unreadIndicator.test.ts's in-memory fake double) — this file is the one
// exception, exercising the actual `prisma` client from src/lib/prisma.ts
// against the real local Postgres instance (docker-compose `db` service,
// see .env's DATABASE_URL) and the real, unmocked
// getVisibleTasksForCategory / markTaskViewed / getUnreadTaskIds functions.
// This both validates the read-state cross-user logic AND, as a side
// effect, proves the TaskReadState table actually exists in whatever
// database DATABASE_URL points at when this file is run.
//
// This is also the test that caught the actual production bug: the
// touchTask() helper in src/app/(app)/task/actions.ts used to call
// `tx.task.update({ where: { id }, data: {} })` to bump Task.updatedAt for
// step/participant activity. Against this Prisma version + @prisma/adapter-pg,
// an update() with a completely empty `data` object never touches
// @updatedAt (no SET clause is generated at all) — so Task.updatedAt never
// actually changed, and the unread red dot could never appear for those
// mutations. touchTask/touchMotorClaim/touchNonMotorClaim were fixed to
// pass `data: { updatedAt: new Date() }` explicitly; Step 3 below exercises
// exactly that code path (via the real prisma client, mirroring
// addStepAction) and would fail again if that regressed.
//
// Skips itself (rather than failing) when it cannot reach a database at
// all, so `npm test` still passes in an environment with no Postgres
// reachable — but once connected, every assertion below runs for real, no
// mocking.

let dbReachable = true;
let prisma: typeof import("@/lib/prisma").prisma;
let getVisibleTasksForCategory: typeof import("@/lib/task/queries").getVisibleTasksForCategory;
let markTaskViewed: typeof import("@/lib/task/readState").markTaskViewed;

beforeAll(async () => {
  try {
    ({ prisma } = await import("@/lib/prisma"));
    ({ getVisibleTasksForCategory } = await import("@/lib/task/queries"));
    ({ markTaskViewed } = await import("@/lib/task/readState"));
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error(
      "readState.dualUser.integration.test: no reachable database (is `docker compose up -d db` running, and does DATABASE_URL in .env point at it?) — skipping real-DB assertions.",
      err
    );
    dbReachable = false;
  }
});

describe("Task Unread Red-Dot — dual-user, real database, real query + action layer", () => {
  const suffix = randomUUID().slice(0, 8);
  const userAId = `test-userA-${suffix}`;
  const userBId = `test-userB-${suffix}`;
  let taskId: string;

  beforeAll(async () => {
    if (!dbReachable) return;
    await prisma.user.createMany({
      data: [
        { id: userAId, username: `test-usera-${suffix}`, fullName: "Audit Test User A", passwordHash: "x", status: "ACTIVE" },
        { id: userBId, username: `test-userb-${suffix}`, fullName: "Audit Test User B", passwordHash: "x", status: "ACTIVE" },
      ],
    });
    const task = await prisma.task.create({
      data: {
        category: "DAILY_TASK",
        title: `Audit dual-user unread test ${suffix}`,
        createdById: userAId,
        participants: {
          createMany: {
            data: [
              { userId: userAId, addedById: userAId },
              { userId: userBId, addedById: userAId },
            ],
          },
        },
        steps: { create: { content: "initial step", createdById: userAId } },
      },
    });
    taskId = task.id;
  });

  afterAll(async () => {
    if (!dbReachable) return;
    await prisma.task.delete({ where: { id: taskId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  });

  function isUnreadFor(list: Awaited<ReturnType<typeof getVisibleTasksForCategory>>) {
    return list.find((t) => t.id === taskId)?.isUnread;
  }

  it("runs the full G1-G7 cross-user scenario against the real DB", async () => {
    if (!dbReachable) {
      console.warn("Skipping: no reachable database.");
      return;
    }
    // Step 1 — A opens the Task (real page-load call: markTaskViewed).
    await markTaskViewed(userAId, taskId);
    // Step 2 — B opens the Task.
    await markTaskViewed(userBId, taskId);

    // Both just viewed it: neither should see it as unread yet.
    expect(isUnreadFor(await getVisibleTasksForCategory(userAId, "DAILY_TASK"))).toBe(false);
    expect(isUnreadFor(await getVisibleTasksForCategory(userBId, "DAILY_TASK"))).toBe(false);

    // Step 3 — B modifies the Task, reproducing addStepAction's real
    // mutation sequence (create step, touchTask, touchOwnTaskReadState)
    // through the real prisma client so this exercises the actual fixed
    // touchTask() SQL path, not a paraphrase of it.
    await new Promise((r) => setTimeout(r, 5)); // guarantee updatedAt advances past T1
    await prisma.$transaction(async (tx) => {
      await tx.taskStep.create({ data: { taskId, content: "B's edit", createdById: userBId } });
      await tx.task.update({ where: { id: taskId }, data: { updatedAt: new Date() } }); // touchTask (fixed)
      await tx.taskReadState.upsert({
        where: { taskId_userId: { taskId, userId: userBId } },
        create: { taskId, userId: userBId, lastViewedAt: new Date() },
        update: { lastViewedAt: new Date() },
      }); // touchOwnTaskReadState(B)
    });

    // Step 4 — A's list query MUST show unread.
    expect(isUnreadFor(await getVisibleTasksForCategory(userAId, "DAILY_TASK"))).toBe(true);
    // Step 5 — B's own list query MUST NOT show unread (B's own edit).
    expect(isUnreadFor(await getVisibleTasksForCategory(userBId, "DAILY_TASK"))).toBe(false);

    // Confirm B's mutation never touched A's read state (the "F" concern —
    // no updateMany / no cross-user write).
    const aReadState = await prisma.taskReadState.findUnique({ where: { taskId_userId: { taskId, userId: userAId } } });
    expect(aReadState).not.toBeNull();

    // Step 6 — A opens the Task.
    await markTaskViewed(userAId, taskId);

    // Step 7 — A's list query MUST NOT show unread any more.
    expect(isUnreadFor(await getVisibleTasksForCategory(userAId, "DAILY_TASK"))).toBe(false);
  });
});
