"use client";

import { useLocale } from "@/i18n/locale-provider";
import { locales } from "@/i18n/config";

export function LanguageSwitcher() {
  const { locale, t, setLocale, isPending } = useLocale();

  return (
    <div className="flex items-center gap-1 rounded-md border border-white/20 p-0.5">
      {locales.map((loc) => (
        <button
          key={loc}
          type="button"
          disabled={isPending}
          onClick={() => setLocale(loc)}
          aria-label={t.language.switchTo}
          className={`rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
            locale === loc
              ? "bg-white text-emerald-800"
              : "text-white/80 hover:bg-white/10"
          }`}
        >
          {t.language[loc]}
        </button>
      ))}
    </div>
  );
}
