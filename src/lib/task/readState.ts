import { prisma } from "@/lib/prisma";

// Task User-Level Unread Indicator — see TaskReadState's schema comment for
// the overall design. Unread for a given (user, Task) pair is never a stored
// boolean; it's always computed here as `task.updatedAt > readState.lastViewedAt`.
//
// Migration-safety rule (this phase's spec, Part B8 — "don't make every
// pre-existing Task light up red on first deploy"): a MISSING TaskReadState
// row is treated two different ways depending on whether this user has ever
// used the feature before, distinguished by whether they have ANY
// TaskReadState row at all (see ensureTaskReadStateBaseline):
//   - Never used the feature yet (zero rows anywhere) -> this is their very
//     first Task list load under this feature. A baseline row is created for
//     every currently-visible Task, seeded to that Task's OWN updatedAt (not
//     "now") so it reads as already-caught-up rather than freshly read a
//     moment ago. Nothing is unread on this first load.
//   - Already has at least one row (an established user of the feature) -> a
//     missing row for one specific Task (e.g. they were just added as a
//     Participant to a Task they've never opened) is genuinely new to them,
//     so it IS unread. This is what lets Case 13 (Manage Participants) work:
//     a newly-added participant sees the Task as unread, while a first-time
//     user of the whole feature does not get flooded.

export async function ensureTaskReadStateBaseline(userId: string, visibleTaskIds: string[]): Promise<void> {
  if (visibleTaskIds.length === 0) return;

  // Audit finding (2026-08-24, "new Participant gets no red dot" follow-up):
  // the old gate here was "does this user have ANY TaskReadState row
  // anywhere" — which could not tell a genuinely brand-new user's very
  // first-ever Task assignment apart from an established user's first
  // login after this feature shipped. Concretely: an established,
  // long-silent Participant of older Tasks who is ALSO freshly added to a
  // brand-new Task in the same session would already have exactly one row
  // (the new Task's explicit unread row — see initializeUnreadTaskReadStates
  // below) by the time their list next loads, tripping the old "has 1 row"
  // gate and making baseline skip ALL of their other, genuinely historical
  // Tasks — flooding those unread instead of catching them up.
  //
  // Fixed by dropping the global gate entirely: only ever backfill a Task
  // that is STILL missing a row after checking the exact visible set passed
  // in here. Correctness no longer depends on the user's row count anywhere
  // else — a Task a user was just freshly assigned to already has its own
  // explicit row (written synchronously in the same mutation transaction,
  // before this function can ever run for it), so it is never "missing"
  // here and can never be re-covered as caught-up.
  const existing = await prisma.taskReadState.findMany({
    where: { userId, taskId: { in: visibleTaskIds } },
    select: { taskId: true },
  });
  const existingIds = new Set(existing.map((r) => r.taskId));
  const missingTaskIds = visibleTaskIds.filter((id) => !existingIds.has(id));
  if (missingTaskIds.length === 0) return;

  const tasks = await prisma.task.findMany({ where: { id: { in: missingTaskIds } }, select: { id: true, updatedAt: true } });
  if (tasks.length === 0) return;

  try {
    await prisma.taskReadState.createMany({
      data: tasks.map((t) => ({ taskId: t.id, userId, lastViewedAt: t.updatedAt })),
      skipDuplicates: true,
    });
  } catch (err) {
    // Best-effort — a race between two concurrent first-ever list loads for
    // the same user (see this phase's spec, Part B9) must never break the
    // page; skipDuplicates already absorbs the common case, this is just an
    // extra safety net.
    console.error("Failed to establish Task read-state baseline:", err);
  }
}

// Task User-Level Unread Indicator — explicit initialization for a
// Participant newly added to a Task (at creation, or via
// updateParticipantsAction), so their very first list load treats this
// Task as unread instead of risking being silently caught up by
// ensureTaskReadStateBaseline above. `skipDuplicates` makes this a pure
// no-op for anyone who already has a row for this Task (e.g. a
// removed-then-re-added Participant) — their existing row, whatever its
// value, is left untouched; it will already correctly read as unread once
// the caller's own parent-touch bumps Task.updatedAt past it.
//
// Never relies on two independent `new Date()` calls landing at different
// milliseconds to establish `lastViewedAt < parent.updatedAt` — the value
// here is derived directly from the Task's own just-written `updatedAt`
// (passed in by the caller from the same transaction), offset a full
// second earlier, so the inequality holds deterministically regardless of
// clock or timestamp precision.
export async function initializeUnreadTaskReadStates(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  taskId: string,
  parentUpdatedAt: Date,
  newParticipantUserIds: string[]
): Promise<void> {
  if (newParticipantUserIds.length === 0) return;
  const guaranteedUnreadAt = new Date(parentUpdatedAt.getTime() - 1000);
  await tx.taskReadState.createMany({
    data: newParticipantUserIds.map((userId) => ({ taskId, userId, lastViewedAt: guaranteedUnreadAt })),
    skipDuplicates: true,
  });
}

// Callers pass the exact Task rows they're about to show the user
// (id + updatedAt) — never re-derives "visible" itself, so this can never
// widen which Tasks a user learns about (this phase's spec, Part B4: unread
// computation must never expand Task visibility).
export async function getUnreadTaskIds(userId: string, tasks: { id: string; updatedAt: Date }[]): Promise<Set<string>> {
  if (tasks.length === 0) return new Set();

  await ensureTaskReadStateBaseline(userId, tasks.map((t) => t.id));

  const readStates = await prisma.taskReadState.findMany({
    where: { userId, taskId: { in: tasks.map((t) => t.id) } },
    select: { taskId: true, lastViewedAt: true },
  });
  const lastViewedByTaskId = new Map(readStates.map((r) => [r.taskId, r.lastViewedAt]));

  const unread = new Set<string>();
  for (const t of tasks) {
    const lastViewed = lastViewedByTaskId.get(t.id);
    if (!lastViewed || t.updatedAt > lastViewed) unread.add(t.id);
  }
  return unread;
}

// Called both when a user actually opens a Task (this phase's spec, Part
// B5 — viewing itself is what marks it read, no separate button) and,
// inline in the mutating Server Actions, on the acting user's own id right
// after their own mutation succeeds (Part B2 — so a user's own edit never
// makes their own copy of the Task unread). An upsert, so it's safe to call
// whether or not a row already exists, and safe under concurrent calls (the
// unique (taskId, userId) constraint makes this atomic at the database
// level — see this phase's spec, Part B9).
export async function markTaskViewed(userId: string, taskId: string): Promise<void> {
  await prisma.taskReadState.upsert({
    where: { taskId_userId: { taskId, userId } },
    create: { taskId, userId, lastViewedAt: new Date() },
    update: { lastViewedAt: new Date() },
  });
}
