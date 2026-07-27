import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { PolicyTabs, type PolicyTabKey } from "@/components/policy/policy-tabs";

// Only Motor has real content in Phase 1A (see the Motor pages under
// ./motor); Non-Motor/Bond/Work Permit render ComingSoon until their own
// phases land, but the tab bar itself is built for all four now so adding a
// category later is just a new route. Each tab is additionally gated on the
// viewer's detailed Policy permission (Part 6: "show only the sections the
// user may access") — a server component so the filtering is never just
// hidden client-side.
const ALL_CATEGORY_TABS: { href: string; key: PolicyTabKey; permission: Parameters<typeof hasPermission>[1] }[] = [
  { href: "/policy/motor", key: "tabMotor", permission: "policy.motor" },
  { href: "/policy/non-motor", key: "tabNonMotor", permission: "policy.non_motor" },
  { href: "/policy/bond", key: "tabBond", permission: "policy.bond" },
  { href: "/policy/work-permit", key: "tabWorkPermit", permission: "policy.work_permit" },
];

export default async function PolicyLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const visibleTabs = ALL_CATEGORY_TABS.filter((tab) =>
    hasPermission(session?.user, tab.permission)
  ).map(({ href, key }) => ({ href, key }));

  return <PolicyTabs tabs={visibleTabs}>{children}</PolicyTabs>;
}
