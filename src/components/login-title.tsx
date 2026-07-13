"use client";

import { useLocale } from "@/i18n/locale-provider";

export function LoginTitleClient() {
  const { t } = useLocale();
  return (
    <div className="mb-6 text-center">
      <h1 className="section-title">{t.login.title}</h1>
      <p className="mt-1 text-secondary">{t.login.subtitle}</p>
    </div>
  );
}
