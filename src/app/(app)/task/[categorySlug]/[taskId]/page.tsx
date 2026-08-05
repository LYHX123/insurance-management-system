import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isTaskCategorySlug, SLUG_TO_CATEGORY } from "@/lib/task/category";
import { getVisibleTasksForCategory, getTaskDetailForDisplay } from "@/lib/task/queries";
import { checkTaskAccess } from "@/lib/task/access";
import { TaskWorkspace } from "@/components/task/task-workspace";

export default async function TaskDetailPage({ params }: { params: Promise<{ categorySlug: string; taskId: string }> }) {
  const { categorySlug, taskId } = await params;
  if (!isTaskCategorySlug(categorySlug)) notFound();

  // Motor Claim / Non-Motor Claim have no per-record detail URL in this
  // phase (dedicated claim records are viewed/edited via modal — see this
  // phase's spec, Part I.37) — this nested route only ever applies to Daily
  // Task, whose per-task URL predates Phase 6B and is unchanged.
  if (categorySlug !== "daily") notFound();

  // The single security gate for direct URL access (see this phase's spec,
  // Part D.9 / Part N.45): "no-module-access" means the user lacks the Task
  // permission entirely (redirect, same as every other module's detail
  // page); "not-found" covers a missing Task, a soft-deleted Task, AND a
  // real Task the current user simply isn't a participant of — all three
  // render the exact same 404 so a non-participant can never learn which
  // case it is.
  const access = await checkTaskAccess(taskId);
  if (access.kind === "no-module-access") redirect("/access-denied");
  if (access.kind === "not-found") notFound();

  const category = SLUG_TO_CATEGORY[categorySlug];

  const [tasks, activeUsers, detail] = await Promise.all([
    getVisibleTasksForCategory(access.userId, category),
    prisma.user.findMany({
      where: { status: "ACTIVE" },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, username: true, role: true },
    }),
    getTaskDetailForDisplay(taskId),
  ]);

  // A participant of this Task who reaches it through the wrong category's
  // route (category is immutable — see Part B.3) never sees it either; the
  // canonical URL is always under its own category.
  if (!detail || detail.category !== category) notFound();

  return (
    <TaskWorkspace
      categorySlug={categorySlug}
      tasks={tasks}
      selectedTask={detail}
      currentUserId={access.userId}
      canEdit={access.canEdit}
      activeUsers={activeUsers.map((u) => ({ id: u.id, name: u.fullName || u.username, role: u.role }))}
    />
  );
}
