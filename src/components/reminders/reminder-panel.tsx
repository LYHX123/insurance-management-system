"use client";

import { useState } from "react";
import Link from "next/link";
import { X, AlertCircle, Clock, History } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { ReminderItem, ReminderSeverity } from "@/lib/reminders/service";
import type { Dictionary } from "@/i18n/dictionaries/en";

const SEVERITY_TONE: Record<ReminderSeverity, BadgeTone> = {
  expired: "danger",
  due_today: "danger",
  due_soon: "warning",
  inactivity: "info",
};

const SEVERITY_ICON: Record<ReminderSeverity, typeof AlertCircle> = {
  expired: AlertCircle,
  due_today: AlertCircle,
  due_soon: Clock,
  inactivity: History,
};

const INITIAL_VISIBLE_COUNT = 10;

function reminderMessage(t: Dictionary, item: ReminderItem): string {
  if (item.category.startsWith("policy.")) {
    if (item.severity === "expired") return t.reminders.expiredDaysAgo(Math.abs(item.days));
    if (item.severity === "due_today") return t.reminders.expiresToday;
    return t.reminders.expiresInDays(item.days);
  }
  if (item.category === "task.daily_task") return t.reminders.noProgressForDays(item.days);
  return t.reminders.noClaimUpdateForDays(item.days);
}

export function ReminderPanel({
  reminders,
  onClose,
}: {
  reminders: ReminderItem[];
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? reminders : reminders.slice(0, INITIAL_VISIBLE_COUNT);
  const remaining = reminders.length - visible.length;

  return (
    <div
      role="dialog"
      aria-label={t.reminders.panelTitle}
      className="fixed right-4 bottom-4 z-40 flex max-h-[70vh] w-[380px] max-w-[calc(100vw-2rem)] flex-col rounded-surface border border-zinc-200 bg-white shadow-lg"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-900">{t.reminders.panelTitle}</h3>
          {reminders.length > 0 && <Badge tone="brand">{reminders.length}</Badge>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.reminders.close}
          className="text-zinc-400 hover:text-zinc-600"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {reminders.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">{t.reminders.noReminders}</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {visible.map((item) => {
              const Icon = SEVERITY_ICON[item.severity];
              return (
                <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                  <Icon size={18} className="mt-0.5 shrink-0 text-zinc-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Badge tone={SEVERITY_TONE[item.severity]}>
                        {t.reminders.categoryLabels[item.category]}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-sm font-medium text-zinc-800">
                      {item.recordNumber ?? item.category}
                    </p>
                    <p className="text-xs text-zinc-500">{reminderMessage(t, item)}</p>
                    {(item.customerName || item.extra) && (
                      <p className="truncate text-xs text-zinc-400">
                        {[item.customerName, item.extra].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    <Link
                      href={item.targetUrl}
                      className="mt-1 inline-block text-xs font-medium text-emerald-700 hover:underline"
                    >
                      {t.reminders.viewRecord}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!showAll && remaining > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="border-t border-zinc-200 py-2 text-center text-xs font-medium text-emerald-700 hover:bg-zinc-50"
        >
          {t.reminders.viewAllReminders} (+{remaining})
        </button>
      )}
      {showAll && reminders.length > INITIAL_VISIBLE_COUNT && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="border-t border-zinc-200 py-2 text-center text-xs font-medium text-zinc-500 hover:bg-zinc-50"
        >
          {t.reminders.showLess}
        </button>
      )}
    </div>
  );
}
