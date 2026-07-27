"use client";

import Link from "next/link";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import type { ActivityItem } from "@/lib/dashboard/types";

export function RecentActivitySection({ items }: { items: ActivityItem[] }) {
  const { t, locale } = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <section className="flex flex-col gap-3">
      <h2 className="section-title">{t.dashboard.recentActivity}</h2>
      <Card className="p-0">
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">{t.dashboard.noRecentActivity}</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {items.map((item) => (
              <li key={item.id}>
                <Link href={item.targetUrl} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-zinc-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-zinc-800">
                      {item.actorName && <span className="font-medium">{item.actorName}: </span>}
                      {item.action}
                    </p>
                    {item.recordLabel && <p className="truncate text-xs text-zinc-400">{item.recordLabel}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-zinc-400">{dateFormatter.format(new Date(item.timestamp))}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
