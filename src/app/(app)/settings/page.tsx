import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/authz";
import { getSystemSettings } from "@/lib/settings/service";
import { SettingsContent } from "@/components/settings/settings-content";

export default async function SettingsPage() {
  const session = await requireAdmin();
  if (!session) {
    redirect("/access-denied");
  }

  const settings = await getSystemSettings();

  const plainSettings = {
    companyName: settings.companyName,
    pinNumber: settings.pinNumber,
    phoneNumber: settings.phoneNumber,
    email: settings.email,
    address: settings.address,
    website: settings.website,
    hasLogo: !!settings.logoStorageKey,
    defaultCurrency: settings.defaultCurrency,
    defaultTimezone: settings.defaultTimezone,
    dateFormat: settings.dateFormat,
    timeFormat: settings.timeFormat,
    defaultLanguage: settings.defaultLanguage,
    recordsPerPage: settings.recordsPerPage,
    policyRemindersEnabled: settings.policyRemindersEnabled,
    motorPolicyReminderDays: settings.motorPolicyReminderDays,
    otherPolicyReminderDays: settings.otherPolicyReminderDays,
    dailyTaskRemindersEnabled: settings.dailyTaskRemindersEnabled,
    dailyTaskReminderDays: settings.dailyTaskReminderDays,
    claimRemindersEnabled: settings.claimRemindersEnabled,
    claimReminderDays: settings.claimReminderDays,
    loginReminderPopupEnabled: settings.loginReminderPopupEnabled,
  };

  return <SettingsContent settings={plainSettings} />;
}
