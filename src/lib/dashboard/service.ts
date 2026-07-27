import { hasPermission, isAdmin, type AuthzUser } from "@/lib/permissions";
import { getSystemSettings } from "@/lib/settings/service";
import { getMotorPolicyReminders, getOtherPolicyReminders } from "@/lib/reminders/policy";
import { getDailyTaskReminders } from "@/lib/reminders/task";
import { getMotorClaimReminders, getNonMotorClaimReminders } from "@/lib/reminders/claim";
import { sortReminders, type ReminderItem } from "@/lib/reminders/service";
import { todayRange as buildTodayRange, thisWeekRange as buildThisWeekRange, thisMonthRange as buildThisMonthRange } from "@/lib/reminders/datetime";
import { buildStatCards, permittedPolicyCategories } from "./statCards";
import { buildFinancialSummary, buildManualLedgerSummary } from "./financial";
import { buildTodayThisWeekRows } from "./todayThisWeek";
import { buildRecentActivity } from "./activity";
import type { DashboardData } from "./types";

const ATTENTION_CAP = 50;

// The single entry point the Dashboard server action calls (Part 3).
// Reuses the exact same reminder calculators as the login popup (Part
// 12/21.6) — every reminder-derived count/list on the Dashboard (Attention
// Required, Overdue Daily Tasks, Policies Expiring Soon) is computed from
// these same arrays, never a second conflicting definition.
export async function getDashboardData(user: AuthzUser & { id: string }): Promise<DashboardData> {
  const settings = await getSystemSettings();
  const timeZone = settings.defaultTimezone;
  const currency = settings.defaultCurrency;
  const now = new Date();
  const admin = isAdmin(user);

  const policyCategories = permittedPolicyCategories(user);
  const participantScope = admin ? null : user.id;

  const [motorPolicyRaw, otherPolicyRaw, dailyTaskRaw, motorClaimRaw, nonMotorClaimRaw] = await Promise.all([
    settings.policyRemindersEnabled && (admin || hasPermission(user, "policy.motor"))
      ? getMotorPolicyReminders(settings.motorPolicyReminderDays, timeZone, now)
      : Promise.resolve<ReminderItem[]>([]),
    settings.policyRemindersEnabled && policyCategories.length > 0
      ? getOtherPolicyReminders(settings.otherPolicyReminderDays, timeZone, now)
      : Promise.resolve<ReminderItem[]>([]),
    settings.dailyTaskRemindersEnabled && (admin || hasPermission(user, "task.daily_task"))
      ? getDailyTaskReminders(participantScope, settings.dailyTaskReminderDays, timeZone, now)
      : Promise.resolve<ReminderItem[]>([]),
    settings.claimRemindersEnabled && (admin || hasPermission(user, "claim.motor"))
      ? getMotorClaimReminders(participantScope, settings.claimReminderDays, timeZone, now)
      : Promise.resolve<ReminderItem[]>([]),
    settings.claimRemindersEnabled && (admin || hasPermission(user, "claim.non_motor"))
      ? getNonMotorClaimReminders(participantScope, settings.claimReminderDays, timeZone, now)
      : Promise.resolve<ReminderItem[]>([]),
  ]);

  // getOtherPolicyReminders always returns all three sub-categories mixed —
  // narrow to exactly what this user may see (admin keeps everything).
  const otherPolicy = admin ? otherPolicyRaw : otherPolicyRaw.filter((r) => hasPermission(user, r.permissionKey));

  const todayR = buildTodayRange(timeZone, now);
  const weekR = buildThisWeekRange(timeZone, now);
  const monthR = buildThisMonthRange(timeZone, now);

  const expiringTodayCount =
    motorPolicyRaw.filter((r) => r.severity === "due_today").length +
    otherPolicy.filter((r) => r.severity === "due_today").length;

  const [statCards, financialSummary, manualLedgerSummary, todayThisWeek, recentActivity] = await Promise.all([
    buildStatCards(user, { motorPolicy: motorPolicyRaw, otherPolicy, dailyTask: dailyTaskRaw }),
    buildFinancialSummary(user, policyCategories, currency, monthR),
    buildManualLedgerSummary(user, currency, monthR),
    buildTodayThisWeekRows(user, policyCategories, todayR, weekR, expiringTodayCount),
    buildRecentActivity(user, policyCategories),
  ]);

  const attentionAll = sortReminders([...motorPolicyRaw, ...otherPolicy, ...dailyTaskRaw, ...motorClaimRaw, ...nonMotorClaimRaw]);

  const hasAnyModulePermission =
    admin ||
    policyCategories.length > 0 ||
    hasPermission(user, "ledger.manual_record") ||
    hasPermission(user, "ledger.system_record") ||
    hasPermission(user, "task.daily_task") ||
    hasPermission(user, "claim.motor") ||
    hasPermission(user, "claim.non_motor") ||
    hasPermission(user, "customer");

  return {
    currency,
    hasAnyModulePermission,
    statCards,
    attentionItems: attentionAll.slice(0, ATTENTION_CAP),
    attentionTotalCount: attentionAll.length,
    financialSummary,
    manualLedgerSummary,
    todayRows: todayThisWeek.todayRows,
    thisWeekRows: todayThisWeek.thisWeekRows,
    recentActivity,
  };
}
