import { prisma } from "@/lib/prisma";
import type { TaskCategory, TaskStatus } from "@/generated/prisma/enums";

export type TaskListItem = {
  id: string;
  title: string;
  status: TaskStatus;
  createdByName: string;
  createdAt: string;
  participantNames: string[];
};

const USER_SELECT = { id: true, fullName: true, username: true, status: true, role: true } as const;

// Restricted at the database level to Tasks the given user participates in
// — never fetched broadly and filtered client-side (see this phase's spec,
// Part N.44). ACTIVE and COMPLETED are fetched as two separate queries
// (rather than one query with a single orderBy) because Phase 6B's spec
// gives each group its own distinct sort key: ACTIVE by updatedAt desc
// (then createdAt desc to break ties), COMPLETED by completedAt desc (then
// updatedAt desc as a fallback for the — currently impossible, but
// defensive — case of a COMPLETED row with no completedAt). The two result
// sets are simply concatenated, which is exactly "ACTIVE first, COMPLETED
// after" (see this phase's spec, Part A.2).
export async function getVisibleTasksForCategory(userId: string, category: TaskCategory): Promise<TaskListItem[]> {
  const baseWhere = { category, deletedAt: null, participants: { some: { userId } } } as const;
  const selectFields = {
    id: true,
    title: true,
    status: true,
    createdById: true,
    createdAt: true,
    participants: { select: { userId: true } },
  } as const;

  const [active, completed] = await Promise.all([
    prisma.task.findMany({
      where: { ...baseWhere, status: "ACTIVE" },
      select: selectFields,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.task.findMany({
      where: { ...baseWhere, status: "COMPLETED" },
      select: selectFields,
      orderBy: [{ completedAt: "desc" }, { updatedAt: "desc" }],
    }),
  ]);
  const tasks = [...active, ...completed];

  const allUserIds = new Set<string>();
  for (const t of tasks) {
    allUserIds.add(t.createdById);
    for (const p of t.participants) allUserIds.add(p.userId);
  }
  const users = allUserIds.size
    ? await prisma.user.findMany({ where: { id: { in: [...allUserIds] } }, select: { id: true, fullName: true, username: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.fullName || u.username]));

  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    createdByName: nameById.get(t.createdById) ?? "—",
    createdAt: t.createdAt.toISOString(),
    // Enables the left-panel search to also match by participant name (see
    // this phase's spec, Part G.24: "Search by ... Participant name, if
    // practical") without a separate round-trip per task.
    participantNames: t.participants.map((p) => nameById.get(p.userId) ?? "—"),
  }));
}

export type TaskParticipantRow = {
  userId: string;
  fullName: string;
  role: string | null;
  isActiveAccount: boolean;
};

export type TaskStepRow = {
  id: string;
  content: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  editedAt: string | null;
};

export type TaskDetail = {
  id: string;
  category: TaskCategory;
  title: string;
  status: TaskStatus;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  completedByName: string | null;
  participants: TaskParticipantRow[];
  steps: TaskStepRow[];
};

// Assumes the caller already ran checkTaskAccess (or otherwise trusts the
// current viewer is a participant) — this function's own WHERE clause still
// independently re-restricts to non-deleted Tasks so it can never surface a
// soft-deleted Task's content even if called incorrectly.
export async function getTaskDetailForDisplay(taskId: string): Promise<TaskDetail | null> {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
    include: {
      participants: { orderBy: { addedAt: "asc" } },
      steps: { where: { deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!task) return null;

  const userIds = new Set<string>([task.createdById, ...task.participants.map((p) => p.userId), ...task.steps.map((s) => s.createdById)]);
  if (task.completedById) userIds.add(task.completedById);
  const users = await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: USER_SELECT });
  const userById = new Map(users.map((u) => [u.id, u]));
  const nameOf = (id: string) => {
    const u = userById.get(id);
    return u ? u.fullName || u.username : "—";
  };

  return {
    id: task.id,
    category: task.category,
    title: task.title,
    status: task.status,
    createdById: task.createdById,
    createdByName: nameOf(task.createdById),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    completedAt: task.completedAt?.toISOString() ?? null,
    completedByName: task.completedById ? nameOf(task.completedById) : null,
    participants: task.participants.map((p) => {
      const u = userById.get(p.userId);
      return {
        userId: p.userId,
        fullName: u ? u.fullName || u.username : "—",
        role: u?.role ?? null,
        isActiveAccount: u?.status === "ACTIVE",
      };
    }),
    steps: task.steps.map((s) => ({
      id: s.id,
      content: s.content,
      createdById: s.createdById,
      createdByName: nameOf(s.createdById),
      createdAt: s.createdAt.toISOString(),
      editedAt: s.editedAt?.toISOString() ?? null,
    })),
  };
}
