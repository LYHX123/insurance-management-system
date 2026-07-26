"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";

// Same shared-shell pattern as src/app/(app)/ledger/layout.tsx and
// src/app/(app)/policy/layout.tsx — one sidebar entry, real route-based
// category tabs underneath so each category is directly linkable/
// bookmarkable and a refresh preserves the selected category (see this
// phase's spec, Part B.2).
const TASK_TABS = [
  { href: "/task/daily", key: "tabDaily" as const },
  { href: "/task/motor-claim", key: "tabMotorClaim" as const },
  { href: "/task/non-motor-claim", key: "tabNonMotorClaim" as const },
];

export default function TaskLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useLocale();

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader title={t.task.title} />
      <div className="flex gap-6 border-b border-zinc-200">
        {TASK_TABS.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`border-b-2 px-1 pb-2 text-sm font-medium transition-colors ${
                isActive ? "border-emerald-700 text-emerald-800" : "border-transparent text-zinc-500 hover:text-zinc-800"
              }`}
            >
              {t.task[tab.key]}
            </Link>
          );
        })}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
