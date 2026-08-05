import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit, hasPermission, type PermissionKey } from "@/lib/permissions";
import { isTaskCategorySlug, SLUG_TO_CATEGORY, type TaskCategorySlug } from "@/lib/task/category";
import { getVisibleTasksForCategory } from "@/lib/task/queries";
import { getMotorClaims, getNonMotorClaims, getActiveClaimCustomers } from "@/lib/claims/queries";
import { getDistinctInsurers } from "@/lib/claims/insurers";
import { TaskWorkspace } from "@/components/task/task-workspace";
import { MotorClaimTable } from "@/components/claims/motor-claim-table";
import { NonMotorClaimTable } from "@/components/claims/non-motor-claim-table";

// Daily Task, Motor Claim, and Non-Motor Claim each have their own detailed
// permission (Part 8) — the specific one required depends on which category
// slug this route is currently rendering.
const SLUG_PERMISSION: Record<TaskCategorySlug, PermissionKey> = {
  daily: "task.daily_task",
  "motor-claim": "claim.motor",
  "non-motor-claim": "claim.non_motor",
};

export default async function TaskCategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ categorySlug: string }>;
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { categorySlug } = await params;
  if (!isTaskCategorySlug(categorySlug)) notFound();

  const session = await auth();
  if (!session?.user || !hasPermission(session.user, SLUG_PERMISSION[categorySlug])) {
    redirect("/access-denied");
  }

  // Phase 8.1 Part 4 — the "View All Motor/Non-Motor Claims" entry point
  // from Customer Detail's Related Records tab filters at the database
  // level, never just in the browser: customerId here narrows the actual
  // Prisma query inside getMotorClaims/getNonMotorClaims, merged alongside
  // (never replacing) their existing participant-scoping filter.
  const { customerId } = await searchParams;

  // Motor Claim / Non-Motor Claim are dedicated, participant-scoped claim-
  // record management pages as of Phase 6B/6C — they never render the
  // generic Daily Task TaskWorkspace. Only Daily Task still does.
  if (categorySlug === "motor-claim") {
    const [claims, customers, insurers, activeUsers] = await Promise.all([
      getMotorClaims(session.user.id, customerId),
      getActiveClaimCustomers(),
      getDistinctInsurers(),
      prisma.user.findMany({ where: { status: "ACTIVE" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, username: true, role: true } }),
    ]);
    return (
      <MotorClaimTable
        claims={claims}
        customers={customers}
        insurers={insurers}
        currentUserId={session.user.id}
        canEdit={canEdit(session.user, "claim.motor")}
        activeUsers={activeUsers.map((u) => ({ id: u.id, name: u.fullName || u.username, role: u.role }))}
      />
    );
  }

  if (categorySlug === "non-motor-claim") {
    const [claims, customers, insurers, activeUsers] = await Promise.all([
      getNonMotorClaims(session.user.id, customerId),
      getActiveClaimCustomers(),
      getDistinctInsurers(),
      prisma.user.findMany({ where: { status: "ACTIVE" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, username: true, role: true } }),
    ]);
    return (
      <NonMotorClaimTable
        claims={claims}
        customers={customers}
        insurers={insurers}
        currentUserId={session.user.id}
        canEdit={canEdit(session.user, "claim.non_motor")}
        activeUsers={activeUsers.map((u) => ({ id: u.id, name: u.fullName || u.username, role: u.role }))}
      />
    );
  }

  const category = SLUG_TO_CATEGORY[categorySlug];

  const [tasks, activeUsers] = await Promise.all([
    getVisibleTasksForCategory(session.user.id, category),
    prisma.user.findMany({
      where: { status: "ACTIVE" },
      orderBy: { fullName: "asc" },
      select: { id: true, fullName: true, username: true, role: true },
    }),
  ]);

  return (
    <TaskWorkspace
      categorySlug={categorySlug}
      tasks={tasks}
      selectedTask={null}
      currentUserId={session.user.id}
      canEdit={canEdit(session.user, "task.daily_task")}
      activeUsers={activeUsers.map((u) => ({ id: u.id, name: u.fullName || u.username, role: u.role }))}
    />
  );
}
