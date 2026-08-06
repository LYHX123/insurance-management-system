"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, Clock, History } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { ReminderItem, ReminderSeverity } from "@/lib/reminders/service";
import type { Dictionary } from "@/i18n/dictionaries/en";

const SEVERITY_TONE: Record<ReminderSeverity, BadgeTone> = {
  expired: "danger",
  due_today: "danger",
  due_soon: "warning",
  inactivity: "info",
};

const SEVERITY_ICON = {
  expired: AlertCircle,
  due_today: AlertCircle,
  due_soon: Clock,
  inactivity: History,
} as const;

const INITIAL_VISIBLE_COUNT = 12;

function itemMessage(t: Dictionary, item: ReminderItem): string {
  if (item.category.startsWith("policy.")) {
    if (item.severity === "expired") return t.reminders.expiredDaysAgo(Math.abs(item.days));
    if (item.severity === "due_today") return t.reminders.expiresToday;
    return t.reminders.expiresInDays(item.days);
  }
  if (item.category === "task.daily_task") return t.reminders.noProgressForDays(item.days);
  return t.reminders.noClaimUpdateForDays(item.days);
}

export function AttentionRequiredSection({ items, totalCount }: { items: ReminderItem[]; totalCount: number }) {
  const { t } = useLocale();
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? items : items.slice(0, INITIAL_VISIBLE_COUNT);
  const remaining = totalCount - visible.length;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="section-title">{t.dashboard.attentionRequired}</h2>
      <Card className="p-0">
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">{t.dashboard.noAttentionItems}</p>
        ) : (
          <ul className="max-h-[420px] divide-y divide-zinc-100 overflow-y-auto overflow-x-hidden md:max-h-[560px]">
            {visible.map((item) => {
              const Icon = SEVERITY_ICON[item.severity];
              return (
                <li key={item.id} className="flex items-start gap-3 px-4 py-2">
                  <Icon size={18} className="mt-0.5 shrink-0 text-zinc-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Badge tone={SEVERITY_TONE[item.severity]}>{t.reminders.categoryLabels[item.category]}</Badge>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-zinc-800">{item.recordNumber ?? item.category}</p>
                    <p className="text-xs text-zinc-500">{itemMessage(t, item)}</p>
                    {(item.customerName || item.extra) && (
                      <p className="truncate text-xs text-zinc-400">
                        {[item.customerName, item.extra].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <Link href={item.targetUrl} className="mt-0.5 shrink-0 text-xs font-medium text-emerald-700 hover:underline">
                    {t.dashboard.view}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {!showAll && remaining > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="w-full border-t border-zinc-200 py-2 text-center text-xs font-medium text-emerald-700 hover:bg-zinc-50"
          >
            {t.dashboard.viewAll} (+{remaining})
          </button>
        )}
        {showAll && items.length > INITIAL_VISIBLE_COUNT && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="w-full border-t border-zinc-200 py-2 text-center text-xs font-medium text-zinc-500 hover:bg-zinc-50"
          >
            {t.dashboard.showLess}
          </button>
        )}
      </Card>
    </section>
  );
}
