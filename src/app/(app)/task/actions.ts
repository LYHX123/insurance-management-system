"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit } from "@/lib/permissions";
import { checkTaskAccess } from "@/lib/task/access";
import { isTaskCategorySlug, SLUG_TO_CATEGORY, type TaskCategorySlug } from "@/lib/task/category";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

const TITLE_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 4000;

function touchTask(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], taskId: string) {
  // Prisma's @updatedAt bumps on every .update() call that touches the row,
  // even with an empty data object — the simplest way to make Task.updatedAt
  // (and therefore the visible list ordering) reflect step/participant
  // activity that lives in a different table (see this phase's spec, Part
  // G.23: "A Task receiving a new step should move toward the top of the
  // ACTIVE list").
  return tx.task.update({ where: { id: taskId }, data: {} });
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
      return created;
    });

    revalidatePath("/task", "layout");
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
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (!access.isCreator) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "ACTIVE") return { success: false, error: "TASK_NOT_ACTIVE" };

  const trimmed = title?.trim();
  if (!trimmed) return { success: false, error: "TITLE_REQUIRED" };
  if (trimmed.length > TITLE_MAX_LENGTH) return { success: false, error: "TITLE_TOO_LONG" };

  try {
    await prisma.task.update({ where: { id: taskId }, data: { title: trimmed } });
    revalidatePath("/task", "layout");
    return { success: true };
  } catch (err) {
    console.error("Failed to update Task title:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

export async function updateParticipantsAction(taskId: string, participantIds: string[]): Promise<ActionResult> {
  const access = await checkTaskAccess(taskId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "TASK_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (!access.isCreator) return { success: false, error: "FORBIDDEN" };
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
      await touchTask(tx, taskId);
    });
    revalidatePath("/task", "layout");
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
    const step = await prisma.$transaction(async (tx) => {
      const created = await tx.taskStep.create({ data: { taskId, content: trimmed, createdById: access.userId } });
      await touchTask(tx, taskId);
      return created;
    });
    revalidatePath("/task", "layout");
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
  if (step.createdById !== access.userId && !access.isCreator) return { success: false, error: "FORBIDDEN" };

  const trimmed = content?.trim();
  if (!trimmed) return { success: false, error: "CONTENT_REQUIRED" };
  if (trimmed.length > CONTENT_MAX_LENGTH) return { success: false, error: "CONTENT_TOO_LONG" };

  try {
    await prisma.$transaction(async (tx) => {
      // Preserves the original createdById/createdAt untouched — only
      // content and the edit markers change (see this phase's spec, Part
      // I.32).
      await tx.taskStep.update({ where: { id: stepId }, data: { content: trimmed, editedAt: new Date() } });
      await touchTask(tx, step.taskId);
    });
    revalidatePath("/task", "layout");
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
  if (step.createdById !== access.userId && !access.isCreator) return { success: false, error: "FORBIDDEN" };

  const visibleCount = await prisma.taskStep.count({ where: { taskId: step.taskId, deletedAt: null } });
  if (visibleCount <= 1) return { success: false, error: "MIN_STEP_REQUIRED" };

  try {
    await prisma.$transaction(async (tx) => {
      const result = await tx.taskStep.updateMany({
        where: { id: stepId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: access.userId },
      });
      if (result.count > 0) await touchTask(tx, step.taskId);
    });
    revalidatePath("/task", "layout");
    return { success: true };
  } catch (err) {
    console.error("Failed to delete Task step:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

// ============================================================================
// Complete / reopen / delete (creator-only)
// ============================================================================

// Idempotent by construction (same pattern as cancelInvoiceAction /
// cancelManualEntryAction): the status transition is the WHERE clause of the
// update itself.
export async function completeTaskAction(taskId: string): Promise<ActionResult> {
  const access = await checkTaskAccess(taskId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "TASK_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (!access.isCreator) return { success: false, error: "FORBIDDEN" };

  const result = await prisma.task.updateMany({
    where: { id: taskId, status: "ACTIVE" },
    data: { status: "COMPLETED", completedAt: new Date(), completedById: access.userId },
  });
  if (result.count === 0) return { success: false, error: "TASK_NOT_ACTIVE" };

  revalidatePath("/task", "layout");
  return { success: true };
}

export async function reopenTaskAction(taskId: string): Promise<ActionResult> {
  const access = await checkTaskAccess(taskId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "TASK_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (!access.isCreator) return { success: false, error: "FORBIDDEN" };

  const result = await prisma.task.updateMany({
    where: { id: taskId, status: "COMPLETED" },
    // Cleared rather than retained: the audit trail of what happened lives
    // in the step timeline, and keeping a stale completedAt/completedById
    // on an Active task would misleadingly suggest it is still completed
    // (see this phase's spec, Part D.13).
    data: { status: "ACTIVE", completedAt: null, completedById: null },
  });
  if (result.count === 0) return { success: false, error: "TASK_NOT_COMPLETED" };

  revalidatePath("/task", "layout");
  return { success: true };
}

export async function deleteTaskAction(taskId: string): Promise<ActionResult> {
  const access = await checkTaskAccess(taskId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "TASK_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (!access.isCreator) return { success: false, error: "FORBIDDEN" };

  const result = await prisma.task.updateMany({
    where: { id: taskId, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: access.userId },
  });
  if (result.count === 0) return { success: false, error: "ALREADY_DELETED" };

  revalidatePath("/task", "layout");
  return { success: true };
}
