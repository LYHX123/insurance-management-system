"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";

// Same shared-shell pattern as src/app/(app)/policy/layout.tsx — Manual
// Records and System Records are real separate routes (not client-state
// tabs), so each is directly linkable/bookmarkable, matching this app's
// existing Policy category convention.
const LEDGER_TABS = [
  { href: "/ledger/manual", key: "tabManual" as const },
  { href: "/ledger/system", key: "tabSystem" as const },
];

export default function LedgerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useLocale();

  return (
    <div className="flex flex-col gap-section">
      <PageHeader title={t.ledger.title} />
      <div className="flex gap-6 border-b border-zinc-200">
        {LEDGER_TABS.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`border-b-2 px-1 pb-2 text-sm font-medium transition-colors ${
                isActive ? "border-emerald-700 text-emerald-800" : "border-transparent text-zinc-500 hover:text-zinc-800"
              }`}
            >
              {t.ledger[tab.key]}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
