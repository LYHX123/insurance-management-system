import { prisma } from "@/lib/prisma";
import { daysSince, toValidDate } from "./datetime";
import type { ReminderItem } from "./types";

// Daily Task is participant-scoped (see src/lib/task/access.ts's
// checkTaskAccess) — reminders must retain that restriction in addition to
// the task.daily_task permission (Part 12.8), so the query itself is
// already narrowed to tasks the given user participates in. Pass `null` for
// `participantUserId` to bypass this restriction entirely — used for ADMIN,
// who sees every qualifying task regardless of personal participation (the
// Dashboard/reminders spec's "ADMIN sees all" applies to participation
// scoping too, not just the module permission itself).
export async function getDailyTaskReminders(
  participantUserId: string | null,
  thresholdDays: number,
  timeZone: string,
  now: Date = new Date()
): Promise<ReminderItem[]> {
  const tasks = await prisma.task.findMany({
    where: {
      category: "DAILY_TASK",
      status: "ACTIVE",
      deletedAt: null,
      ...(participantUserId ? { participants: { some: { userId: participantUserId } } } : {}),
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
      steps: {
        where: { deletedAt: null },
        select: { createdAt: true, editedAt: true },
      },
    },
  });

  const items: ReminderItem[] = [];
  for (const task of tasks) {
    // Latest processing-node activity date: the most recent (edit or
    // creation) timestamp across every non-deleted TaskStep. Falls back to
    // the task's own createdAt when it has no steps yet — the only other
    // meaningful timestamp this model has (Part 10's fallback list).
    let latest = toValidDate(task.createdAt);
    for (const step of task.steps) {
      const stepDate = toValidDate(step.editedAt ?? step.createdAt);
      if (stepDate && (!latest || stepDate > latest)) latest = stepDate;
    }
    if (!latest) continue;

    const days = daysSince(latest, timeZone, now);
    if (days < thresholdDays) continue;

    items.push({
      id: `task:${task.id}`,
      category: "task.daily_task",
      severity: "inactivity",
      recordId: task.id,
      recordNumber: task.title,
      customerName: null,
      extra: null,
      days,
      referenceDate: latest.toISOString(),
      targetUrl: `/task/daily/${task.id}`,
      permissionKey: "task.daily_task",
    });
  }

  return items;
}
