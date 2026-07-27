"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { updateSystemPreferencesAction } from "@/app/(app)/settings/actions";
import {
  SUPPORTED_CURRENCIES,
  SUPPORTED_TIMEZONES,
  SUPPORTED_DATE_FORMATS,
  SUPPORTED_TIME_FORMATS,
} from "@/lib/settings/constants";
import type { Locale } from "@/generated/prisma/enums";
import type { SettingsData } from "./settings-content";

export function SystemPreferencesForm({ settings }: { settings: SettingsData }) {
  const { t } = useLocale();
  const router = useRouter();

  const [defaultCurrency, setDefaultCurrency] = useState(settings.defaultCurrency);
  const [defaultTimezone, setDefaultTimezone] = useState(settings.defaultTimezone);
  const [dateFormat, setDateFormat] = useState(settings.dateFormat);
  const [timeFormat, setTimeFormat] = useState(settings.timeFormat);
  const [defaultLanguage, setDefaultLanguage] = useState<Locale>(settings.defaultLanguage);
  const [recordsPerPage, setRecordsPerPage] = useState(String(settings.recordsPerPage));

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const timeFormatLabel: Record<string, string> = {
    "12H": t.settings.time12h,
    "24H": t.settings.time24h,
  };
  const languageLabel: Record<Locale, string> = {
    en: t.settings.english,
    zh: t.settings.chinese,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const recordsPerPageNum = Number(recordsPerPage);
    if (!Number.isInteger(recordsPerPageNum)) {
      setError(t.settings.invalidRecordsPerPage);
      return;
    }

    setIsSubmitting(true);
    const result = await updateSystemPreferencesAction({
      defaultCurrency,
      defaultTimezone,
      dateFormat,
      timeFormat,
      defaultLanguage,
      recordsPerPage: recordsPerPageNum,
    });
    setIsSubmitting(false);

    if (!result.success) {
      setError(
        result.error === "INVALID_RECORDS_PER_PAGE"
          ? t.settings.invalidRecordsPerPage
          : t.settings.saveError
      );
      return;
    }

    setMessage(t.settings.saveSuccess);
    router.refresh();
  };

  return (
    <Card className="max-w-2xl p-6">
      <form onSubmit={handleSubmit} className="form-stack">
        <FormField label={t.settings.defaultCurrency}>
          <Select value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value)}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label={t.settings.defaultTimezone}>
          <Select value={defaultTimezone} onChange={(e) => setDefaultTimezone(e.target.value)}>
            {SUPPORTED_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label={t.settings.dateFormat}>
          <Select value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
            {SUPPORTED_DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label={t.settings.timeFormat}>
          <Select value={timeFormat} onChange={(e) => setTimeFormat(e.target.value)}>
            {SUPPORTED_TIME_FORMATS.map((f) => (
              <option key={f} value={f}>
                {timeFormatLabel[f]}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label={t.settings.defaultLanguage}>
          <Select value={defaultLanguage} onChange={(e) => setDefaultLanguage(e.target.value as Locale)}>
            {(["en", "zh"] as const).map((l) => (
              <option key={l} value={l}>
                {languageLabel[l]}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label={t.settings.recordsPerPage}>
          <Input
            type="number"
            min={5}
            max={200}
            step={1}
            value={recordsPerPage}
            onChange={(e) => setRecordsPerPage(e.target.value)}
          />
        </FormField>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {message && <p className="text-sm text-emerald-700">{message}</p>}

        <div className="mt-2 flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {t.common.save}
          </Button>
        </div>
      </form>
    </Card>
  );
}
