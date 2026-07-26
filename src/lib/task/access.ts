import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import type { TaskStatus } from "@/generated/prisma/enums";

export type TaskAuthResult =
  | { kind: "no-module-access" }
  | { kind: "not-found" }
  | { kind: "ok"; userId: string; taskId: string; createdById: string; status: TaskStatus; isCreator: boolean };

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
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "task")) {
    return { kind: "no-module-access" };
  }

  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null, participants: { some: { userId: session.user.id } } },
    select: { id: true, createdById: true, status: true },
  });
  if (!task) return { kind: "not-found" };

  return {
    kind: "ok",
    userId: session.user.id,
    taskId: task.id,
    createdById: task.createdById,
    status: task.status,
    isCreator: task.createdById === session.user.id,
  };
}
