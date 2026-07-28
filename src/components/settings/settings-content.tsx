"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { CompanyInfoForm } from "./company-info-form";
import { SystemPreferencesForm } from "./system-preferences-form";
import { ReminderSettingsForm } from "./reminder-settings-form";
import { DropboxIntegrationForm } from "./dropbox-integration-form";
import type { Locale } from "@/generated/prisma/enums";
import type { DropboxIntegrationView } from "@/lib/integrations/dropbox/types";

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

type TabKey = "companyInfo" | "systemPreferences" | "reminderSettings" | "dropbox";
const VALID_TABS: TabKey[] = ["companyInfo", "systemPreferences", "reminderSettings", "dropbox"];

export function SettingsContent({ settings, dropbox }: { settings: SettingsData; dropbox: DropboxIntegrationView }) {
  const { t } = useLocale();
  // Deep-link support for the OAuth callback redirect
  // (/settings?tab=dropbox&dropbox=connected|error&code=...), same pattern
  // as the Policy detail pages' own ?tab= deep-linking.
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab = VALID_TABS.includes(requestedTab as TabKey) ? (requestedTab as TabKey) : "companyInfo";
  const [tab, setTab] = useState<TabKey>(initialTab);

  const tabs = [
    { key: "companyInfo", label: t.settings.tabCompanyInfo },
    { key: "systemPreferences", label: t.settings.tabSystemPreferences },
    { key: "reminderSettings", label: t.settings.tabReminderSettings },
    { key: "dropbox", label: t.settings.tabDropbox },
  ];

  return (
    <div className="flex flex-col gap-section">
      <PageHeader title={t.settings.title} />
      <Tabs tabs={tabs} active={tab} onChange={(key) => setTab(key as TabKey)} />

      {tab === "companyInfo" && <CompanyInfoForm settings={settings} />}
      {tab === "systemPreferences" && <SystemPreferencesForm settings={settings} />}
      {tab === "reminderSettings" && <ReminderSettingsForm settings={settings} />}
      {tab === "dropbox" && (
        <DropboxIntegrationForm
          dropbox={dropbox}
          callbackResult={searchParams.get("dropbox")}
          callbackErrorCode={searchParams.get("code")}
        />
      )}
    </div>
  );
}
