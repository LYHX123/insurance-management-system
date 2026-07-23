"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";

// Shared shell for every Policy category — only Motor has real content in
// Phase 1A (see the Motor pages under ./motor); Non-Motor/Bond/Work Permit
// render ComingSoon until their own phases land, but the tab bar itself is
// built for all four now so adding a category later is just a new route.
const CATEGORY_TABS = [
  { href: "/policy/motor", key: "tabMotor" as const },
  { href: "/policy/non-motor", key: "tabNonMotor" as const },
  { href: "/policy/bond", key: "tabBond" as const },
  { href: "/policy/work-permit", key: "tabWorkPermit" as const },
];

export default function PolicyLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useLocale();

  return (
    <div className="flex flex-col gap-section">
      <PageHeader title={t.policy.title} />
      <div className="flex gap-6 border-b border-zinc-200">
        {CATEGORY_TABS.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`border-b-2 px-1 pb-2 text-sm font-medium transition-colors ${
                isActive ? "border-emerald-700 text-emerald-800" : "border-transparent text-zinc-500 hover:text-zinc-800"
              }`}
            >
              {t.policy[tab.key]}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
