import { prisma } from "@/lib/prisma";
import { computeBusinessStatus } from "@/lib/policy/status";
import {
  firstAccessibleCategorySlug,
  hasPermission,
  isAdmin,
  POLICY_CATEGORY_ROUTES,
  type AuthzUser,
} from "@/lib/permissions";
import type { ReminderItem } from "@/lib/reminders/service";
import type { PolicyCategory } from "@/generated/prisma/enums";
import type { StatCard } from "./types";

const POLICY_CATEGORIES: readonly PolicyCategory[] = ["MOTOR", "NON_MOTOR", "BOND", "WORK_PERMIT"];

const CATEGORY_PERMISSION_KEY = {
  MOTOR: "policy.motor",
  NON_MOTOR: "policy.non_motor",
  BOND: "policy.bond",
  WORK_PERMIT: "policy.work_permit",
} as const;

export function permittedPolicyCategories(user: AuthzUser): PolicyCategory[] {
  if (isAdmin(user)) return [...POLICY_CATEGORIES];
  return POLICY_CATEGORIES.filter((c) => hasPermission(user, CATEGORY_PERMISSION_KEY[c]));
}

// Part 6 — count only records whose current business status is ACTIVE (via
// the same computeBusinessStatus() every Policy page already uses), across
// whichever categories the user may access. CANCELLED/RENEWED are excluded
// at the query level; EXPIRED is excluded here since "Active" deliberately
// means currently on cover, not merely "not cancelled".
async function countActivePolicies(categories: PolicyCategory[]): Promise<number> {
  if (categories.length === 0) return 0;
  const records = await prisma.policyRecord.findMany({
    where: { category: { in: categories }, deletedAt: null, businessStatus: { notIn: ["CANCELLED", "RENEWED"] } },
    select: { effectiveDate: true, expiryDate: true, businessStatus: true },
  });
  const now = new Date();
  return records.filter((r) => computeBusinessStatus(r.effectiveDate, r.expiryDate, r.businessStatus, now) === "ACTIVE").length;
}

// Part 7/8 — per-record outstanding balance clamped to >= 0 before summing,
// so one overpaid record can never net against (and hide) another's real
// unpaid balance. Reuses the same premium/receipt and cost/payment fields
// every Policy detail/list page already reads — no new financial concept.
export async function sumClientPremiumOutstanding(categories: PolicyCategory[]): Promise<number> {
  if (categories.length === 0) return 0;
  const records = await prisma.policyRecord.findMany({
    where: { category: { in: categories }, deletedAt: null, businessStatus: { notIn: ["CANCELLED", "RENEWED"] } },
    select: { id: true, customerPremium: true },
  });
  if (records.length === 0) return 0;
  const receiptSums = await prisma.policyCustomerReceipt.groupBy({
    by: ["policyRecordId"],
    where: { deletedAt: null, policyRecordId: { in: records.map((r) => r.id) } },
    _sum: { amount: true },
  });
  const receivedByRecord = new Map(receiptSums.map((r) => [r.policyRecordId, r._sum.amount?.toNumber() ?? 0]));
  return records.reduce((total, r) => {
    const outstanding = r.customerPremium.toNumber() - (receivedByRecord.get(r.id) ?? 0);
    return total + Math.max(0, outstanding);
  }, 0);
}

export async function sumInsurerPaymentOutstanding(categories: PolicyCategory[]): Promise<number> {
  if (categories.length === 0) return 0;
  const records = await prisma.policyRecord.findMany({
    where: { category: { in: categories }, deletedAt: null, businessStatus: { notIn: ["CANCELLED", "RENEWED"] } },
    select: { id: true, insurerCost: true },
  });
  if (records.length === 0) return 0;
  const paymentSums = await prisma.policyProviderPayment.groupBy({
    by: ["policyRecordId"],
    where: { deletedAt: null, policyRecordId: { in: records.map((r) => r.id) } },
    _sum: { amount: true },
  });
  const paidByRecord = new Map(paymentSums.map((p) => [p.policyRecordId, p._sum.amount?.toNumber() ?? 0]));
  return records.reduce((total, r) => {
    const outstanding = r.insurerCost.toNumber() - (paidByRecord.get(r.id) ?? 0);
    return total + Math.max(0, outstanding);
  }, 0);
}

// Reminder arrays are computed exactly once by the Dashboard service (and
// reused for Attention Required) — stat-card counts are derived from them
// here rather than re-querying with a second, potentially-inconsistent
// definition of "overdue"/"expiring soon" (Part 21.6).
export async function buildStatCards(
  user: AuthzUser & { id: string },
  reminders: { motorPolicy: ReminderItem[]; otherPolicy: ReminderItem[]; dailyTask: ReminderItem[] }
): Promise<StatCard[]> {
  const admin = isAdmin(user);
  const policyCategories = permittedPolicyCategories(user);
  const hasAnyPolicy = policyCategories.length > 0;
  const hasSystemLedger = admin || hasPermission(user, "ledger.system_record");
  const participantScope = admin ? null : user.id;
  const cards: StatCard[] = [];

  const policyTargetUrl = () => {
    const slug = firstAccessibleCategorySlug(user, POLICY_CATEGORY_ROUTES);
    return slug ? `/policy/${slug}` : "/policy";
  };

  if (hasAnyPolicy) {
    const [activeCount, clientOutstanding] = await Promise.all([
      countActivePolicies(policyCategories),
      sumClientPremiumOutstanding(policyCategories),
    ]);
    cards.push({ key: "activePolicies", isMoney: false, value: activeCount, targetUrl: policyTargetUrl() });
    cards.push({ key: "clientPremiumOutstanding", isMoney: true, value: clientOutstanding, targetUrl: policyTargetUrl() });

    if (hasSystemLedger) {
      const insurerOutstanding = await sumInsurerPaymentOutstanding(policyCategories);
      cards.push({ key: "insurerPaymentOutstanding", isMoney: true, value: insurerOutstanding, targetUrl: policyTargetUrl() });
    }

    const expiringSoonCount =
      reminders.motorPolicy.filter((r) => r.severity !== "expired").length +
      reminders.otherPolicy.filter((r) => r.severity !== "expired").length;
    cards.push({ key: "policiesExpiringSoon", isMoney: false, value: expiringSoonCount, targetUrl: policyTargetUrl() });
  }

  if (admin || hasPermission(user, "claim.motor")) {
    const count = await prisma.motorClaim.count({
      where: { status: "OPEN", deletedAt: null, ...(participantScope ? { participants: { some: { userId: participantScope } } } : {}) },
    });
    cards.push({ key: "openMotorClaims", isMoney: false, value: count, targetUrl: "/task/motor-claim" });
  }

  if (admin || hasPermission(user, "claim.non_motor")) {
    const count = await prisma.nonMotorClaim.count({
      where: { status: "OPEN", deletedAt: null, ...(participantScope ? { participants: { some: { userId: participantScope } } } : {}) },
    });
    cards.push({ key: "openNonMotorClaims", isMoney: false, value: count, targetUrl: "/task/non-motor-claim" });
  }

  if (admin || hasPermission(user, "task.daily_task")) {
    cards.push({ key: "overdueDailyTasks", isMoney: false, value: reminders.dailyTask.length, targetUrl: "/task/daily" });
  }

  if (admin || hasPermission(user, "customer")) {
    const count = await prisma.customer.count({ where: { status: "ACTIVE" } });
    cards.push({ key: "activeCustomers", isMoney: false, value: count, targetUrl: "/customer" });
  }

  return cards;
}
