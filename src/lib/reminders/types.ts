import type { PermissionKey } from "@/lib/permissions";

export type ReminderCategory =
  | "policy.motor"
  | "policy.non_motor"
  | "policy.bond"
  | "policy.work_permit"
  | "task.daily_task"
  | "claim.motor"
  | "claim.non_motor";

// Expiry-based reminders (Policy) carry "expired" / "due_today" / "due_soon";
// activity-based reminders (Task/Claim) are always "inactivity". Determines
// both the icon/color the panel uses and the sort tier (Part 13's suggested
// severity order).
export type ReminderSeverity = "expired" | "due_today" | "due_soon" | "inactivity";

// Deliberately data-only — no pre-rendered title/message string. The client
// composes bilingual text from these fields via t.reminders.* (see
// reminder-panel.tsx), so the server never needs to know which locale the
// requesting user has selected.
export type ReminderItem = {
  id: string;
  category: ReminderCategory;
  severity: ReminderSeverity;
  recordId: string;
  recordNumber: string | null;
  customerName: string | null;
  // Short secondary context: vehicle registration (Motor), project name, etc.
  extra: string | null;
  // Policy: days remaining until expiry (negative once overdue).
  // Task/Claim: days since the latest meaningful activity (always >= 0).
  days: number;
  referenceDate: string; // ISO — expiryDate for Policy, latest activity date for Task/Claim
  targetUrl: string;
  permissionKey: PermissionKey;
};
