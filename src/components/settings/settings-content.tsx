"use client";

import { useState } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { CompanyInfoForm } from "./company-info-form";
import { SystemPreferencesForm } from "./system-preferences-form";
import { ReminderSettingsForm } from "./reminder-settings-form";
import type { Locale } from "@/generated/prisma/enums";

export type SettingsData = {
  companyName: string | null;
  pinNumber: string | null;
  phoneNumber: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
  hasLogo: boolean;
  defaultCurrency: string;
  defaultTimezone: string;
  dateFormat: string;
  timeFormat: string;
  defaultLanguage: Locale;
  recordsPerPage: number;
  policyRemindersEnabled: boolean;
  motorPolicyReminderDays: number;
  otherPolicyReminderDays: number;
  dailyTaskRemindersEnabled: boolean;
  dailyTaskReminderDays: number;
  claimRemindersEnabled: boolean;
  claimReminderDays: number;
  loginReminderPopupEnabled: boolean;
};

type TabKey = "companyInfo" | "systemPreferences" | "reminderSettings";

export function SettingsContent({ settings }: { settings: SettingsData }) {
  const { t } = useLocale();
  const [tab, setTab] = useState<TabKey>("companyInfo");

  const tabs = [
    { key: "companyInfo", label: t.settings.tabCompanyInfo },
    { key: "systemPreferences", label: t.settings.tabSystemPreferences },
    { key: "reminderSettings", label: t.settings.tabReminderSettings },
  ];

  return (
    <div className="flex flex-col gap-section">
      <PageHeader title={t.settings.title} />
      <Tabs tabs={tabs} active={tab} onChange={(key) => setTab(key as TabKey)} />

      {tab === "companyInfo" && <CompanyInfoForm settings={settings} />}
      {tab === "systemPreferences" && <SystemPreferencesForm settings={settings} />}
      {tab === "reminderSettings" && <ReminderSettingsForm settings={settings} />}
    </div>
  );
}
