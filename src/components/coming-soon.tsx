"use client";

import { Construction } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";

export function ComingSoon({ moduleName }: { moduleName: string }) {
  const { t } = useLocale();

  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 rounded-surface border border-dashed border-zinc-300 bg-white text-center">
      <Construction size={40} className="text-emerald-700" />
      <h2 className="section-title">
        {moduleName} — {t.comingSoon.title}
      </h2>
      <p className="max-w-sm text-secondary">{t.comingSoon.message}</p>
    </div>
  );
}
