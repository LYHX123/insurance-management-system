import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { LedgerTabs, type LedgerTabKey } from "@/components/ledger/ledger-tabs";

// Manual Records and System Records are gated on their own detailed
// permission (Part 7) — a server component so the filtering is never just
// hidden client-side.
const ALL_TABS: { href: string; key: LedgerTabKey; permission: Parameters<typeof hasPermission>[1] }[] = [
  { href: "/ledger/manual", key: "tabManual", permission: "ledger.manual_record" },
  { href: "/ledger/system", key: "tabSystem", permission: "ledger.system_record" },
];

export default async function LedgerLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const visibleTabs = ALL_TABS.filter((tab) =>
    hasPermission(session?.user, tab.permission)
  ).map(({ href, key }) => ({ href, key }));

  return <LedgerTabs tabs={visibleTabs}>{children}</LedgerTabs>;
}
