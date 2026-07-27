"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";

export type PolicyTabKey = "tabMotor" | "tabNonMotor" | "tabBond" | "tabWorkPermit";

export function PolicyTabs({
  tabs,
  children,
}: {
  tabs: { href: string; key: PolicyTabKey }[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useLocale();

  return (
    <div className="flex flex-col gap-section">
      <PageHeader title={t.policy.title} />
      <div className="flex gap-6 border-b border-zinc-200">
        {tabs.map((tab) => {
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
