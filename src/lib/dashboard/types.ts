import type { ReminderItem } from "@/lib/reminders/service";

// Stat cards — Part 5/6/7/8/9/10/11. Each card the service decides to
// include is one the user is actually permitted to see; there is no
// "hidden/empty" card variant.
export type StatCardKey =
  | "activePolicies"
  | "clientPremiumOutstanding"
  | "insurerPaymentOutstanding"
  | "openMotorClaims"
  | "openNonMotorClaims"
  | "overdueDailyTasks"
  | "policiesExpiringSoon"
  | "activeCustomers";

export type StatCard = {
  key: StatCardKey;
  isMoney: boolean;
  value: number;
  targetUrl: string;
};

// Part 13 — every field is independently permission-gated (null when the
// user lacks the specific permission that figure requires), never an
// all-or-nothing object.
export type FinancialSummary = {
  currency: string;
  clientPremiumDue: number | null;
  clientPremiumReceived: number | null;
  clientPremiumOutstanding: number | null;
  insurerCostDue: number | null;
  insurerPaymentsMade: number | null;
  insurerPaymentOutstanding: number | null;
  commissionReceived: number | null;
};

// Part 14
export type ManualLedgerSummary = {
  currency: string;
  income: number;
  expense: number;
  net: number;
};

// Part 15 — a flat, server-filtered row list rather than a rigid nested
// shape: only rows the user is permitted to see are ever included, so nothing
// about a hidden module leaks through an always-present-but-empty field.
export type MetricRowKey =
  | "dailyTasksActiveToday"
  | "policiesExpiringToday"
  | "motorClaimsReportedToday"
  | "nonMotorClaimsReportedToday"
  | "clientPaymentsToday"
  | "insurerPaymentsToday"
  | "policiesCreatedThisWeek"
  | "motorClaimsReportedThisWeek"
  | "nonMotorClaimsReportedThisWeek"
  | "clientPaymentsThisWeek"
  | "insurerPaymentsThisWeek"
  | "dailyTasksCompletedThisWeek";

export type MetricRow = {
  key: MetricRowKey;
  value: number;
  isMoney: boolean;
  targetUrl: string;
};

// Part 16 — normalized recent-activity entry. `actorName` is null rather
// than invented when the source record has no reliable attribution.
export type ActivityModule =
  | "policy.motor"
  | "policy.non_motor"
  | "policy.bond"
  | "policy.work_permit"
  | "task.daily_task"
  | "claim.motor"
  | "claim.non_motor"
  | "ledger.manual_record";

export type ActivityItem = {
  id: string;
  timestamp: string;
  actorName: string | null;
  action: string;
  module: ActivityModule;
  recordLabel: string | null;
  targetUrl: string;
};

export type DashboardData = {
  currency: string;
  hasAnyModulePermission: boolean;
  statCards: StatCard[];
  attentionItems: ReminderItem[];
  attentionTotalCount: number;
  financialSummary: FinancialSummary | null;
  manualLedgerSummary: ManualLedgerSummary | null;
  todayRows: MetricRow[];
  thisWeekRows: MetricRow[];
  recentActivity: ActivityItem[];
};
