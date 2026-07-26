import type { TaskCategory } from "@/generated/prisma/enums";

// URL-facing slugs kept separate from the Prisma enum values so routes read
// naturally (/task/motor-claim) while the database stays with the project's
// existing SCREAMING_SNAKE_CASE enum convention.
export const TASK_CATEGORY_SLUGS = ["daily", "motor-claim", "non-motor-claim"] as const;
export type TaskCategorySlug = (typeof TASK_CATEGORY_SLUGS)[number];

export const SLUG_TO_CATEGORY: Record<TaskCategorySlug, TaskCategory> = {
  daily: "DAILY_TASK",
  "motor-claim": "MOTOR_CLAIM",
  "non-motor-claim": "NON_MOTOR_CLAIM",
};

export const CATEGORY_TO_SLUG: Record<TaskCategory, TaskCategorySlug> = {
  DAILY_TASK: "daily",
  MOTOR_CLAIM: "motor-claim",
  NON_MOTOR_CLAIM: "non-motor-claim",
};

export function isTaskCategorySlug(value: string): value is TaskCategorySlug {
  return (TASK_CATEGORY_SLUGS as readonly string[]).includes(value);
}
