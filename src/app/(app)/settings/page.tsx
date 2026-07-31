import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getSystemSettings } from "@/lib/settings/service";
import { getDropboxIntegrationRow, toIntegrationView } from "@/lib/integrations/dropbox/service";
import { getDropboxEnv } from "@/lib/integrations/dropbox/constants";
import { getMigrationPageData } from "@/lib/integrations/dropbox/migration/view";
import { isProductionInitializationEnabled } from "@/lib/productionInit/constants";
import { getProductionInitializationStatus } from "@/lib/productionInit/status";
import { SettingsContent } from "@/components/settings/settings-content";

export default async function SettingsPage() {
  const session = await requireAdmin();
  if (!session) {
    redirect("/access-denied");
  }

  const settings = await getSystemSettings();

  const dropboxRow = await getDropboxIntegrationRow();
  const connectedByUser = dropboxRow.connectedById
    ? await prisma.user.findUnique({ where: { id: dropboxRow.connectedById }, select: { fullName: true, username: true } })
    : null;
  const dropbox = toIntegrationView(
    dropboxRow,
    connectedByUser ? connectedByUser.fullName || connectedByUser.username : null,
    !getDropboxEnv().ok
  );
  const dropboxMigration = await getMigrationPageData();

  // Server-only boolean — the raw env var value itself is never sent to
  // the client (this feature's spec, Part 2/3). When disabled, the status
  // query is skipped entirely (no need to touch that table at all) and the
  // panel receives `null`, which means "don't render this section".
  const productionInitEnabled = isProductionInitializationEnabled();
  const productionInit = productionInitEnabled ? await getProductionInitializationStatus() : null;

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

  return <SettingsContent settings={plainSettings} dropbox={dropbox} dropboxMigration={dropboxMigration} productionInit={productionInit} />;
}
