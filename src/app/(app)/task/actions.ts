"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit, hasPermission } from "@/lib/permissions";
import { checkTaskAccess } from "@/lib/task/access";
import { isTaskCategorySlug, SLUG_TO_CATEGORY, type TaskCategorySlug } from "@/lib/task/category";
import { initializeUnreadTaskReadStates, getUnreadTaskIds } from "@/lib/task/readState";
import { publishTaskActivityAfterMutation } from "@/lib/task/liveNotifications";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 4000;

function touchTask(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], taskId: string) {
  // Audit finding (2026-08-24): an .update() call with a completely empty
  // `data` object does NOT bump an @updatedAt field in this Prisma
  // version/adapter (@prisma/adapter-pg) — confirmed empirically against a
  // real Postgres instance (see
  // src/lib/task/__tests__/readState.dualUser.integration.test.ts): Prisma
  // only appends `updatedAt = now()` to the generated SQL's SET clause when
  // `data` has at least one explicit key. An empty `data: {}` produces a
  // no-op update with no SET clause at all, so Task.updatedAt silently
  // never changed for any step/participant mutation — which was the actual
  // root cause of the Task Unread red-dot never appearing in production
  // (this function's old comment's assumption was wrong). Passing
  // `updatedAt` explicitly forces the SET clause and is the fix, still
  // making Task.updatedAt (and therefore the visible list ordering) reflect
  // step/participant activity that lives in a different table (see this
  // phase's spec, Part G.23: "A Task receiving a new step should move
  // toward the top of the ACTIVE list").
  return tx.task.update({ where: { id: taskId }, data: { updatedAt: new Date() } });
}

// Task User-Level Unread Indicator, Part B2 — every mutation below bumps
// Task.updatedAt (via touchTask or a direct field update), which is exactly
// the signal getUnreadTaskIds compares against every OTHER participant's own
// lastViewedAt. Without this call, the acting user's own edit would make
// their own copy of the Task they're looking at right now flip to unread —
// this brings their own read state forward to the same moment so that never
// happens, while every other participant's read state is untouched and
// still correctly goes stale.
function touchOwnTaskReadState(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], taskId: string, userId: string) {
  return tx.taskReadState.upsert({
    where: { taskId_userId: { taskId, userId } },
    create: { taskId, userId, lastViewedAt: new Date() },
    update: { lastViewedAt: new Date() },
  });
}

// ============================================================================
// Creation
// ============================================================================

export type CreateTaskInput = {
  categorySlug: string;
  title: string;
  startAction: string;
  participantIds: string[];
};

export async function createTaskAction(input: CreateTaskInput): Promise<ActionResult<{ id: string; categorySlug: TaskCategorySlug }>> {
  const session = await auth();
  if (!session?.user || !canEdit(session.user, "task.daily_task")) {
    return { success: false, error: "FORBIDDEN" };
  }

  if (!isTaskCategorySlug(input.categorySlug)) return { success: false, error: "INVALID_CATEGORY" };
  const category = SLUG_TO_CATEGORY[input.categorySlug];

  const title = input.title?.trim();
  if (!title) return { success: false, error: "TITLE_REQUIRED" };
  if (title.length > TITLE_MAX_LENGTH) return { success: false, error: "TITLE_TOO_LONG" };

  const startAction = input.startAction?.trim();
  if (!startAction) return { success: false, error: "CONTENT_REQUIRED" };
  if (startAction.length > CONTENT_MAX_LENGTH) return { success: false, error: "CONTENT_TOO_LONG" };

  // Never trust submitted participant ids: the creator is always forced in
  // (whether or not the client included it), and every other submitted id
  // must resolve to a real, currently-active user (see this phase's spec,
  // Part E.17).
  const submittedIds = new Set((input.participantIds ?? []).filter((id) => id && id !== session.user.id));
  let activeParticipants: { id: string }[] = [];
  if (submittedIds.size > 0) {
    activeParticipants = await prisma.user.findMany({
      where: { id: { in: [...submittedIds] }, status: "ACTIVE" },
      select: { id: true },
    });
    if (activeParticipants.length !== submittedIds.size) return { success: false, error: "USER_INACTIVE" };
  }

  const participantUserIds = [session.user.id, ...activeParticipants.map((u) => u.id)];

  try {
    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: { category, title, createdById: session.user.id },
      });
      await tx.taskParticipant.createMany({
        data: participantUserIds.map((userId) => ({ taskId: created.id, userId, addedById: session.user.id })),
      });
      await tx.taskStep.create({
        data: { taskId: created.id, content: startAction, createdById: session.user.id },
      });
      // The creator has, in effect, just viewed the Task they created — see
      // this phase's spec, Part B2: their own creation must never leave
      // their own copy showing as unread.
      await touchOwnTaskReadState(tx, created.id, session.user.id);
      // The other Participants chosen at creation time are being handed a
      // brand-new Task — "being added to a new Task" is itself unread
      // information (2026-08-24 spec), not something that should wait for
      // a subsequent edit to show a red dot. Explicit, not left to
      // ensureTaskReadStateBaseline's gap-fill (see that function's
      // comment in src/lib/task/readState.ts for why relying on it here
      // would silently mark these Participants as already caught up).
      const otherParticipantIds = participantUserIds.filter((id) => id !== session.user.id);
      if (otherParticipantIds.length > 0) {
        await initializeUnreadTaskReadStates(tx, created.id, created.updatedAt, otherParticipantIds);
      }
      return created;
    });

    revalidatePath("/task", "layout");
    // Phase 8 — published only after the transaction above has actually
    // committed (this phase's spec, Part E). Every other chosen Participant
    // is being handed a brand-new Task, so this is exactly the "unread
    // information" event they should be notified about; the creator
    // themselves is excluded automatically (publishTaskActivityAfterMutation
    // filters out actorUserId).
    publishTaskActivityAfterMutation({ scope: "TASK", entityId: task.id, actorUserId: session.user.id, participantUserIds: participantUserIds });
    return { success: true, id: task.id, categorySlug: input.categorySlug };
  } catch (err) {
    console.error("Failed to create Task:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

// ============================================================================
// Task title / participants (creator-only, ACTIVE-only)
// ============================================================================

export async function updateTaskTitleAction(taskId: string, title: string): Promise<ActionResult> {
  const access = await checkTaskAccess(taskId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "TASK_NOT_FOUND" };
  // Renaming a Task stays Creator/Admin-only — unlike the collaborator
  // actions below, it was never on this phase's list of capabilities to
  // open up to plain Participants (see this phase's spec, Part II). Gated
  // purely on isCreator/isAdmin (not the separate module-level
  // moduleCanEdit) so this matches exactly what the frontend button
  // condition can cheaply check without threading a third permission value
  // through TaskWorkspace/TaskDetailPanel just for this one action.
  if (!access.isCreator && !access.isAdmin) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "ACTIVE") return { success: false, error: "TASK_NOT_ACTIVE" };

  const trimmed = title?.trim();
  if (!trimmed) return { success: false, error: "TITLE_REQUIRED" };
  if (trimmed.length > TITLE_MAX_LENGTH) return { success: false, error: "TITLE_TOO_LONG" };

  try {
    const participantIds = await prisma.$transaction(async (tx) => {
      await tx.task.update({ where: { id: taskId }, data: { title: trimmed } });
      await touchOwnTaskReadState(tx, taskId, access.userId);
      const participants = await tx.taskParticipant.findMany({ where: { taskId }, select: { userId: true } });
      return participants.map((p) => p.userId);
    });
    revalidatePath("/task", "layout");
    publishTaskActivityAfterMutation({ scope: "TASK", entityId: taskId, actorUserId: access.userId, participantUserIds: participantIds });
    return { success: true };
  } catch (err) {
    console.error("Failed to update Task title:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

// Collaborator-level (Admin/Creator/Participant), not Creator-only — any
// Task Participant may add or remove other participants so they can pull in
// help without waiting on the Creator (see this phase's spec, Part IV/V).
// The Creator themselves can never be removed by anyone, Admin included
// (enforced a few lines below): Task visibility itself is scoped to
// `participants: { some: { userId } }` (see checkTaskAccess), so removing
// the Creator's own participant row would lock them out of a Task they
// created — there is no legitimate reason to do this given createdById
// already independently carries authorship.
export async function updateParticipantsAction(taskId: string, participantIds: string[]): Promise<ActionResult> {
  const access = await checkTaskAccess(taskId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "TASK_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "ACTIVE") return { success: false, error: "TASK_NOT_ACTIVE" };

  const current = await prisma.taskParticipant.findMany({ where: { taskId }, select: { userId: true } });
  const currentIds = new Set(current.map((p) => p.userId));

  // The creator can never be removed, whether or not the client's submitted
  // list included them (see this phase's spec, Part J.36).
  const desiredIds = new Set([access.createdById, ...(participantIds ?? [])]);

  const toAdd = [...desiredIds].filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !desiredIds.has(id) && id !== access.createdById);

  if (toAdd.length > 0) {
    const activeUsers = await prisma.user.findMany({ where: { id: { in: toAdd }, status: "ACTIVE" }, select: { id: true } });
    if (activeUsers.length !== toAdd.length) return { success: false, error: "USER_INACTIVE" };
  }

  if (toAdd.length === 0 && toRemove.length === 0) return { success: true };

  try {
    await prisma.$transaction(async (tx) => {
      if (toRemove.length > 0) {
        await tx.taskParticipant.deleteMany({ where: { taskId, userId: { in: toRemove } } });
      }
      if (toAdd.length > 0) {
        await tx.taskParticipant.createMany({
          data: toAdd.map((userId) => ({ taskId, userId, addedById: access.userId })),
        });
      }
      const touchedTask = await touchTask(tx, taskId);
      await touchOwnTaskReadState(tx, taskId, access.userId);
      // Newly added Participants are being handed a Task for the first
      // time — same "being added is itself unread" rule as
      // createTaskAction above. Existing Participants (e.g. A in the
      // spec's example) need no special handling here: touchTask already
      // bumped Task.updatedAt past their own lastViewedAt, which is what
      // makes them unread through the normal computation.
      if (toAdd.length > 0) {
        await initializeUnreadTaskReadStates(tx, taskId, touchedTask.updatedAt, toAdd);
      }
    });
    revalidatePath("/task", "layout");
    // desiredIds is already the final, post-mutation participant set
    // (creator + submitted list, deduped) computed above — no extra query
    // needed.
    publishTaskActivityAfterMutation({ scope: "TASK", entityId: taskId, actorUserId: access.userId, participantUserIds: [...desiredIds] });
    return { success: true };
  } catch (err) {
    console.error("Failed to update Task participants:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

// ============================================================================
// Steps
// ============================================================================

export async function addStepAction(taskId: string, content: string): Promise<ActionResult<{ id: string }>> {
  const access = await checkTaskAccess(taskId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "TASK_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "ACTIVE") return { success: false, error: "TASK_NOT_ACTIVE" };

  const trimmed = content?.trim();
  if (!trimmed) return { success: false, error: "CONTENT_REQUIRED" };
  if (trimmed.length > CONTENT_MAX_LENGTH) return { success: false, error: "CONTENT_TOO_LONG" };

  try {
    const { step, participantIds } = await prisma.$transaction(async (tx) => {
      const created = await tx.taskStep.create({ data: { taskId, content: trimmed, createdById: access.userId } });
      await touchTask(tx, taskId);
      await touchOwnTaskReadState(tx, taskId, access.userId);
      const participants = await tx.taskParticipant.findMany({ where: { taskId }, select: { userId: true } });
      return { step: created, participantIds: participants.map((p) => p.userId) };
    });
    revalidatePath("/task", "layout");
    publishTaskActivityAfterMutation({ scope: "TASK", entityId: taskId, actorUserId: access.userId, participantUserIds: participantIds });
    return { success: true, id: step.id };
  } catch (err) {
    console.error("Failed to add Task step:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

export async function updateStepAction(stepId: string, content: string): Promise<ActionResult> {
  const step = await prisma.taskStep.findUnique({ where: { id: stepId }, select: { taskId: true, createdById: true, deletedAt: true } });
  if (!step || step.deletedAt) return { success: false, error: "STEP_NOT_FOUND" };

  const access = await checkTaskAccess(step.taskId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "TASK_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "ACTIVE") return { success: false, error: "TASK_NOT_ACTIVE" };
  if (step.createdById !== access.userId && !access.isCreator && !access.isAdmin) return { success: false, error: "FORBIDDEN" };

  const trimmed = content?.trim();
  if (!trimmed) return { success: false, error: "CONTENT_REQUIRED" };
  if (trimmed.length > CONTENT_MAX_LENGTH) return { success: false, error: "CONTENT_TOO_LONG" };

  try {
    const participantIds = await prisma.$transaction(async (tx) => {
      // Preserves the original createdById/createdAt untouched — only
      // content and the edit markers change (see this phase's spec, Part
      // I.32).
      await tx.taskStep.update({ where: { id: stepId }, data: { content: trimmed, editedAt: new Date() } });
      await touchTask(tx, step.taskId);
      await touchOwnTaskReadState(tx, step.taskId, access.userId);
      const participants = await tx.taskParticipant.findMany({ where: { taskId: step.taskId }, select: { userId: true } });
      return participants.map((p) => p.userId);
    });
    revalidatePath("/task", "layout");
    publishTaskActivityAfterMutation({ scope: "TASK", entityId: step.taskId, actorUserId: access.userId, participantUserIds: participantIds });
    return { success: true };
  } catch (err) {
    console.error("Failed to update Task step:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

export async function deleteStepAction(stepId: string): Promise<ActionResult> {
  const step = await prisma.taskStep.findUnique({ where: { id: stepId }, select: { taskId: true, createdById: true, deletedAt: true } });
  if (!step || step.deletedAt) return { success: false, error: "STEP_NOT_FOUND" };

  const access = await checkTaskAccess(step.taskId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "TASK_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "ACTIVE") return { success: false, error: "TASK_NOT_ACTIVE" };
  if (step.createdById !== access.userId && !access.isCreator && !access.isAdmin) return { success: false, error: "FORBIDDEN" };

  const visibleCount = await prisma.taskStep.count({ where: { taskId: step.taskId, deletedAt: null } });
  if (visibleCount <= 1) return { success: false, error: "MIN_STEP_REQUIRED" };

  try {
    const participantIds = await prisma.$transaction(async (tx) => {
      const result = await tx.taskStep.updateMany({
        where: { id: stepId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: access.userId },
      });
      if (result.count === 0) return [];
      await touchTask(tx, step.taskId);
      await touchOwnTaskReadState(tx, step.taskId, access.userId);
      const participants = await tx.taskParticipant.findMany({ where: { taskId: step.taskId }, select: { userId: true } });
      return participants.map((p) => p.userId);
    });
    revalidatePath("/task", "layout");
    publishTaskActivityAfterMutation({ scope: "TASK", entityId: step.taskId, actorUserId: access.userId, participantUserIds: participantIds });
    return { success: true };
  } catch (err) {
    console.error("Failed to delete Task step:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

// ============================================================================
// Complete / reopen (collaborator) / delete (creator-only)
// ============================================================================

// Idempotent by construction (same pattern as cancelInvoiceAction /
// cancelManualEntryAction): the status transition is the WHERE clause of the
// update itself. Collaborator-level, not Creator-only — any Task
// Participant can mark the Task they're working on complete (see this
// phase's spec, Part III: "Participant 不再只是被通知/查看的人").
export async function completeTaskAction(taskId: string): Promise<ActionResult> {
  const access = await checkTaskAccess(taskId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "TASK_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };

  const { count, participantIds } = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.task.updateMany({
      where: { id: taskId, status: "ACTIVE" },
      data: { status: "COMPLETED", completedAt: new Date(), completedById: access.userId },
    });
    if (updateResult.count === 0) return { count: 0, participantIds: [] as string[] };
    await touchOwnTaskReadState(tx, taskId, access.userId);
    const participants = await tx.taskParticipant.findMany({ where: { taskId }, select: { userId: true } });
    return { count: updateResult.count, participantIds: participants.map((p) => p.userId) };
  });
  if (count === 0) return { success: false, error: "TASK_NOT_ACTIVE" };

  revalidatePath("/task", "layout");
  publishTaskActivityAfterMutation({ scope: "TASK", entityId: taskId, actorUserId: access.userId, participantUserIds: participantIds });
  return { success: true };
}

export async function reopenTaskAction(taskId: string): Promise<ActionResult> {
  const access = await checkTaskAccess(taskId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "TASK_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };

  const { count, participantIds } = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.task.updateMany({
      where: { id: taskId, status: "COMPLETED" },
      // Cleared rather than retained: the audit trail of what happened lives
      // in the step timeline, and keeping a stale completedAt/completedById
      // on an Active task would misleadingly suggest it is still completed
      // (see this phase's spec, Part D.13).
      data: { status: "ACTIVE", completedAt: null, completedById: null },
    });
    if (updateResult.count === 0) return { count: 0, participantIds: [] as string[] };
    await touchOwnTaskReadState(tx, taskId, access.userId);
    const participants = await tx.taskParticipant.findMany({ where: { taskId }, select: { userId: true } });
    return { count: updateResult.count, participantIds: participants.map((p) => p.userId) };
  });
  if (count === 0) return { success: false, error: "TASK_NOT_COMPLETED" };

  revalidatePath("/task", "layout");
  publishTaskActivityAfterMutation({ scope: "TASK", entityId: taskId, actorUserId: access.userId, participantUserIds: participantIds });
  return { success: true };
}

// Delete stays Creator/Admin-only even though every other write action above
// now also accepts plain Participants — a collaborator can fully process a
// Task, but not permanently remove the business record (see this phase's
// spec, Part VI).
export async function deleteTaskAction(taskId: string): Promise<ActionResult> {
  const access = await checkTaskAccess(taskId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "TASK_NOT_FOUND" };
  if (!access.canDelete) return { success: false, error: "FORBIDDEN" };

  // Fetched before the delete (not that it would matter — TaskParticipant
  // rows are never touched by a Task delete, only Task.deletedAt) so a
  // deleted Task's disappearance is still reflected for its former
  // participants (their next unread re-check simply finds it no longer
  // visible, which is itself a harmless correct outcome — see this phase's
  // spec, Part E: SSE only ever tells a client "go re-check," never
  // asserts the actual result).
  const participants = await prisma.taskParticipant.findMany({ where: { taskId }, select: { userId: true } });

  const result = await prisma.task.updateMany({
    where: { id: taskId, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: access.userId },
  });
  if (result.count === 0) return { success: false, error: "ALREADY_DELETED" };

  revalidatePath("/task", "layout");
  publishTaskActivityAfterMutation({
    scope: "TASK",
    entityId: taskId,
    actorUserId: access.userId,
    participantUserIds: participants.map((p) => p.userId),
  });
  return { success: true };
}

// ============================================================================
// Phase 8 — real-time row-level unread refresh
// ============================================================================

// Called by TaskWorkspace (client) after an SSE "task-unread-changed"
// signal for scope TASK — re-derives isUnread for exactly the Task rows
// currently rendered, via the same getUnreadTaskIds/ensureTaskReadStateBaseline
// path the initial server render uses (this phase's spec, Part A5: no
// second unread computation). Deliberately narrow: returns only an
// id -> isUnread map, never Task content, so the caller can patch its
// existing list state in place without losing scroll position, selection,
// or re-fetching anything else (Part B: "优先做更细粒度的刷新").
//
// Re-scopes to the caller's own current participation server-side (never
// trusts the client's id list as already-authorized) — a taskId the caller
// is no longer a participant of (e.g. just removed) is silently absent from
// the returned map rather than included with a guessed value.
export async function refreshTaskUnreadStatusAction(taskIds: string[]): Promise<Record<string, boolean>> {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "task.daily_task") || taskIds.length === 0) return {};

  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds }, deletedAt: null, participants: { some: { userId: session.user.id } } },
    select: { id: true, updatedAt: true },
  });
  if (tasks.length === 0) return {};

  const unreadIds = await getUnreadTaskIds(session.user.id, tasks);
  const result: Record<string, boolean> = {};
  for (const t of tasks) result[t.id] = unreadIds.has(t.id);
  return result;
}
