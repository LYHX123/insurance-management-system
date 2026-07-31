"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { CompanyInfoForm } from "./company-info-form";
import { SystemPreferencesForm } from "./system-preferences-form";
import { ReminderSettingsForm } from "./reminder-settings-form";
import { DropboxIntegrationForm } from "./dropbox-integration-form";
import { DropboxMigrationPanel } from "./dropbox-migration-panel";
import { ProductionInitializationPanel } from "./production-initialization-panel";
import type { Locale } from "@/generated/prisma/enums";
import type { DropboxIntegrationView } from "@/lib/integrations/dropbox/types";
import type { DropboxMigrationPageData } from "@/lib/integrations/dropbox/migration/view";
import type { ProductionInitStatusInfo } from "@/lib/productionInit/types";

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

export function SettingsContent({
  settings,
  dropbox,
  dropboxMigration,
  productionInit,
}: {
  settings: SettingsData;
  dropbox: DropboxIntegrationView;
  dropboxMigration: DropboxMigrationPageData;
  // Null when ENABLE_PRODUCTION_INITIALIZATION is not "true" on this
  // deployment — the panel (and its entry point) simply doesn't render at
  // all in that case, never just hidden by CSS (this feature's spec, Part
  // 2: "前端入口不可见").
  productionInit: ProductionInitStatusInfo | null;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  // Deep-link support for the OAuth callback redirect
  // (/settings?tab=dropbox&dropbox=connected|error&code=...), same pattern
  // as the Policy detail pages' own ?tab= deep-linking.
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab = VALID_TABS.includes(requestedTab as TabKey) ? (requestedTab as TabKey) : "companyInfo";
  const [tab, setTab] = useState<TabKey>(initialTab);

  // Keeps the tab in the URL (replace, never push) so refresh and Back both
  // restore the tab actually being viewed — matches the Customer/Policy/
  // Quotation-case detail tabs' pattern (Phase 8 Part 6.5).
  const handleTabChange = (key: string) => {
    setTab(key as TabKey);
    const params = new URLSearchParams(searchParams.toString());
    if (key === "companyInfo") params.delete("tab");
    else params.set("tab", key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const tabs = [
    { key: "companyInfo", label: t.settings.tabCompanyInfo },
    { key: "systemPreferences", label: t.settings.tabSystemPreferences },
    { key: "reminderSettings", label: t.settings.tabReminderSettings },
    { key: "dropbox", label: t.settings.tabDropbox },
  ];

  return (
    <div className="flex flex-col gap-section">
      <PageHeader title={t.settings.title} />
      <Tabs tabs={tabs} active={tab} onChange={handleTabChange} />

      {tab === "companyInfo" && <CompanyInfoForm settings={settings} />}
      {tab === "systemPreferences" && (
        <div className="flex flex-col gap-4">
          <SystemPreferencesForm settings={settings} />
          {productionInit && <ProductionInitializationPanel initialStatus={productionInit} />}
        </div>
      )}
      {tab === "reminderSettings" && <ReminderSettingsForm settings={settings} />}
      {tab === "dropbox" && (
        <div className="flex flex-col gap-4">
          <DropboxIntegrationForm
            dropbox={dropbox}
            callbackResult={searchParams.get("dropbox")}
            callbackErrorCode={searchParams.get("code")}
          />
          <DropboxMigrationPanel namespace={dropboxMigration.namespace} latestJob={dropboxMigration.latestJob} />
        </div>
      )}
    </div>
  );
}
