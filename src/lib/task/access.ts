import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit, hasPermission, isAdmin } from "@/lib/permissions";
import type { TaskStatus } from "@/generated/prisma/enums";

export type TaskAuthResult =
  | { kind: "no-module-access" }
  | { kind: "not-found" }
  | {
      kind: "ok";
      userId: string;
      taskId: string;
      createdById: string;
      status: TaskStatus;
      isCreator: boolean;
      isParticipant: boolean;
      isAdmin: boolean;
      // Module-level task.daily_task VIEW/EDIT permission — independent of
      // this specific Task. Only needed by the rare action that stays gated
      // on the module permission rather than per-Task collaborator status
      // (currently just updateTaskTitleAction) and by callers that render
      // module-wide affordances (e.g. the "New Task" button) alongside a
      // Task detail view.
      moduleCanEdit: boolean;
      // Collaborator capability for THIS Task: Admin OR Creator OR
      // Participant (see this phase's spec — a Task Participant is a full
      // collaborator, not just a viewer). Every mutating action except
      // Delete Task and Rename Task gates on this alone.
      canEdit: boolean;
      // Admin OR Creator only. Deleting an entire Task stays a
      // creator/admin-only action even though `canEdit` above now also
      // covers plain Participants (see this phase's spec, Part VI).
      canDelete: boolean;
    };

// The single security primitive every Task server action and the Task
// detail page route through. The Prisma query itself restricts rows to
// Tasks the current user actually participates in (`participants: { some:
// { userId } }`) — never "fetch then filter in React" (see this phase's
// spec, Part N.44). "not-found" is returned for a missing Task, a
// soft-deleted Task, AND a real Task the current user simply isn't a
// participant of — deliberately indistinguishable to the caller so a
// non-participant direct URL attempt can never learn whether a given Task
// id even exists (see Part D.9 / Part N.45).
export async function checkTaskAccess(taskId: string): Promise<TaskAuthResult> {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "task.daily_task")) {
    return { kind: "no-module-access" };
  }

  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null, participants: { some: { userId: session.user.id } } },
    select: { id: true, createdById: true, status: true },
  });
  if (!task) return { kind: "not-found" };

  const userIsAdmin = isAdmin(session.user);
  const userIsCreator = task.createdById === session.user.id;
  // The WHERE clause above already restricted the match to Tasks where
  // `participants: { some: { userId } }` — every "ok" result is therefore
  // for a participant by construction (the creator is always also a
  // TaskParticipant row, enforced in createTaskAction). Surfaced explicitly
  // — rather than left implicit — so canEdit/canDelete below read as the
  // Collaborator Permission Model's actual composition, not a hardcoded
  // shortcut.
  const userIsParticipant = true;

  return {
    kind: "ok",
    userId: session.user.id,
    taskId: task.id,
    createdById: task.createdById,
    status: task.status,
    isCreator: userIsCreator,
    isParticipant: userIsParticipant,
    isAdmin: userIsAdmin,
    moduleCanEdit: canEdit(session.user, "task.daily_task"),
    canEdit: userIsAdmin || userIsCreator || userIsParticipant,
    canDelete: userIsAdmin || userIsCreator,
  };
}
