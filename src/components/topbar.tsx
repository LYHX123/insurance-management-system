"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { RemindersWidget } from "@/components/reminders/reminders-widget";

export function Topbar({
  fullName,
  role,
}: {
  fullName: string;
  role: string;
}) {
  const { t } = useLocale();

  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-6">
      <div className="rounded-md bg-emerald-800 p-0.5">
        <LanguageSwitcher />
      </div>

      <div className="flex items-center gap-4">
        <RemindersWidget />
        <div className="text-right">
          <p className="text-sm font-medium text-zinc-800">{fullName}</p>
          <p className="text-xs text-zinc-500">{role}</p>
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          <LogOut size={16} />
          {t.sidebar.logout}
        </button>
      </div>
    </header>
  );
}
