"use client";

import { Bell } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";

const MAX_DISPLAY_COUNT = 99;

export function ReminderBell({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  const { t } = useLocale();
  const displayCount = count > MAX_DISPLAY_COUNT ? `${MAX_DISPLAY_COUNT}+` : String(count);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t.reminders.bellAriaLabel}
      title={t.reminders.bellAriaLabel}
      className="relative flex h-9 w-9 items-center justify-center rounded-control text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-emerald-700"
    >
      <Bell size={18} />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
          {displayCount}
        </span>
      )}
    </button>
  );
}
