"use client";

import { useLocale } from "@/i18n/locale-provider";
import { locales } from "@/i18n/config";

export function SettingsContent() {
  const { locale, t, setLocale, isPending } = useLocale();

  const languageLabel = {
    en: t.settings.english,
    zh: t.settings.chinese,
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-zinc-900">
        {t.settings.title}
      </h1>

      <div className="max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-800">
          {t.settings.language}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          {t.settings.languageDescription}
        </p>

        <div className="mt-4 flex gap-2">
          {locales.map((loc) => (
            <button
              key={loc}
              type="button"
              disabled={isPending}
              onClick={() => setLocale(loc)}
              className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                locale === loc
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              {languageLabel[loc]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
