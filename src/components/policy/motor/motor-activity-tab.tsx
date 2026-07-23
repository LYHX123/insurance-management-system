"use client";

import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import type { PolicyActivityRow } from "@/components/policy/types";

// Real chronological list (Phase 1B, Section 9) — newest first (already
// sorted by the page's query), no filters/search, no manual creation.
// Append-only from this UI's perspective: no edit/delete button is ever
// shown for an activity entry.
export function MotorActivityTab({ activities }: { activities: PolicyActivityRow[] }) {
  const { t, locale } = useLocale();
  const dateTimeFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  if (activities.length === 0) {
    return (
      <div className="rounded-control border border-dashed border-zinc-300 bg-white p-6 text-center text-secondary">
        {t.policy.noActivityYet}
      </div>
    );
  }

  return (
    <Card>
      <ul className="flex flex-col divide-y divide-zinc-100">
        {activities.map((activity) => (
          <li key={activity.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-zinc-800">{activity.summary}</span>
              <span className="text-xs text-zinc-400">{dateTimeFormatter.format(new Date(activity.createdAt))}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
              {activity.performedByName && <span>{activity.performedByName}</span>}
              {activity.details && <span>{activity.details}</span>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
