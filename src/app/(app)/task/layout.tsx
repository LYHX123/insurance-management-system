import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { TaskTabs, type TaskTabKey } from "@/components/task/task-tabs";

// Daily Task / Motor Claim / Non-Motor Claim each gated on their own
// detailed permission (Part 8) — a server component so the filtering is
// never just hidden client-side.
const ALL_TABS: { href: string; key: TaskTabKey; permission: Parameters<typeof hasPermission>[1] }[] = [
  { href: "/task/daily", key: "tabDaily", permission: "task.daily_task" },
  { href: "/task/motor-claim", key: "tabMotorClaim", permission: "claim.motor" },
  { href: "/task/non-motor-claim", key: "tabNonMotorClaim", permission: "claim.non_motor" },
];

export default async function TaskLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const visibleTabs = ALL_TABS.filter((tab) =>
    hasPermission(session?.user, tab.permission)
  ).map(({ href, key }) => ({ href, key }));

  return <TaskTabs tabs={visibleTabs}>{children}</TaskTabs>;
}
