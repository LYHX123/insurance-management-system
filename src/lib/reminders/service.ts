import { getSystemSettings } from "@/lib/settings/service";
import { hasPermission, isAdmin, type AuthzUser } from "@/lib/permissions";
import { getMotorPolicyReminders, getOtherPolicyReminders } from "./policy";
import { getDailyTaskReminders } from "./task";
import { getMotorClaimReminders, getNonMotorClaimReminders } from "./claim";
import type { ReminderItem, ReminderSeverity } from "./types";

const SEVERITY_ORDER: Record<ReminderSeverity, number> = {
  expired: 0,
  due_today: 1,
  due_soon: 2,
  inactivity: 3,
};

// Exported so the Dashboard's Attention Required section (src/lib/dashboard)
// can combine reminder arrays it fetches directly with the exact same
// ordering, rather than re-implementing this sort a second time.
export function sortReminders(items: ReminderItem[]): ReminderItem[] {
  return [...items].sort((a, b) => {
    const tierDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (tierDiff !== 0) return tierDiff;
    // Expired/due_today/due_soon: soonest (or most overdue) first — ascending
    // `days`. Inactivity: longest-without-activity first — descending `days`.
    return a.severity === "inactivity" ? b.days - a.days : a.days - b.days;
  });
}

export type RemindersResult = {
  items: ReminderItem[];
  loginReminderPopupEnabled: boolean;
};

// The single entry point every reminder consumer (the popup's server
// action, and any future full-panel/page) goes through. Permission
// filtering happens here, in the backend, using the authenticated user's
// own session-derived permissions — never a client-supplied category list
// (Part 12.6/Part 18.6). Participant-scoped visibility for Daily
// Task/Claims is enforced further down, inside each category's own query
// (Part 12.8).
export async function getRemindersForUser(user: AuthzUser & { id: string }): Promise<RemindersResult> {
  const settings = await getSystemSettings();
  const timeZone = settings.defaultTimezone;
  const now = new Date();

  const admin = isAdmin(user);
  const tasks: Promise<ReminderItem[]>[] = [];

  if (settings.policyRemindersEnabled) {
    if (admin || hasPermission(user, "policy.motor")) {
      tasks.push(getMotorPolicyReminders(settings.motorPolicyReminderDays, timeZone, now));
    }
    if (
      admin ||
      hasPermission(user, "policy.non_motor") ||
      hasPermission(user, "policy.bond") ||
      hasPermission(user, "policy.work_permit")
    ) {
      // getOtherPolicyReminders itself returns all three categories mixed —
      // filter out any the user individually lacks (admin always keeps all).
      tasks.push(
        getOtherPolicyReminders(settings.otherPolicyReminderDays, timeZone, now).then((items) =>
          admin ? items : items.filter((item) => hasPermission(user, item.permissionKey))
        )
      );
    }
  }

  // ADMIN bypasses participant scoping entirely (sees every qualifying
  // task/claim, not just ones they personally participate in) — non-admin
  // stays restricted to their own participant rows (Part 12.8).
  const participantScope = admin ? null : user.id;

  if (settings.dailyTaskRemindersEnabled && (admin || hasPermission(user, "task.daily_task"))) {
    tasks.push(getDailyTaskReminders(participantScope, settings.dailyTaskReminderDays, timeZone, now));
  }

  if (settings.claimRemindersEnabled) {
    if (admin || hasPermission(user, "claim.motor")) {
      tasks.push(getMotorClaimReminders(participantScope, settings.claimReminderDays, timeZone, now));
    }
    if (admin || hasPermission(user, "claim.non_motor")) {
      tasks.push(getNonMotorClaimReminders(participantScope, settings.claimReminderDays, timeZone, now));
    }
  }

  const results = await Promise.all(tasks);
  return {
    items: sortReminders(results.flat()),
    loginReminderPopupEnabled: settings.loginReminderPopupEnabled,
  };
}

export type { ReminderItem, ReminderCategory, ReminderSeverity } from "./types";
