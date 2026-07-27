import { prisma } from "@/lib/prisma";
import { hasPermission, isAdmin, type AuthzUser } from "@/lib/permissions";
import type { DateRange } from "@/lib/reminders/datetime";
import type { PolicyCategory } from "@/generated/prisma/enums";
import type { MetricRow } from "./types";

// Part 15 — a flat, server-filtered row list: a row only ever appears if
// the user is permitted to see that specific metric, so nothing about a
// hidden module leaks through an always-present-but-empty field. Every
// count here is a narrow `count`/`aggregate` query (no full records
// fetched) filtered by category/date range at the database level.
export async function buildTodayThisWeekRows(
  user: AuthzUser & { id: string },
  policyCategories: PolicyCategory[],
  todayRange: DateRange,
  weekRange: DateRange,
  expiringTodayCount: number
): Promise<{ todayRows: MetricRow[]; thisWeekRows: MetricRow[] }> {
  const admin = isAdmin(user);
  const participantScope = admin ? null : user.id;
  const hasMotorClaim = admin || hasPermission(user, "claim.motor");
  const hasNonMotorClaim = admin || hasPermission(user, "claim.non_motor");
  const hasSystemLedger = admin || hasPermission(user, "ledger.system_record");
  const hasAnyPolicy = policyCategories.length > 0;

  const todayRows: MetricRow[] = [];
  const thisWeekRows: MetricRow[] = [];

  if (admin || hasPermission(user, "task.daily_task")) {
    const activeToday = await prisma.task.count({
      where: {
        category: "DAILY_TASK",
        status: "ACTIVE",
        deletedAt: null,
        ...(participantScope ? { participants: { some: { userId: participantScope } } } : {}),
      },
    });
    todayRows.push({ key: "dailyTasksActiveToday", value: activeToday, isMoney: false, targetUrl: "/task/daily" });

    const completedThisWeek = await prisma.task.count({
      where: {
        category: "DAILY_TASK",
        status: "COMPLETED",
        completedAt: { gte: weekRange.gte, lt: weekRange.lt },
        ...(participantScope ? { participants: { some: { userId: participantScope } } } : {}),
      },
    });
    thisWeekRows.push({ key: "dailyTasksCompletedThisWeek", value: completedThisWeek, isMoney: false, targetUrl: "/task/daily" });
  }

  if (hasAnyPolicy) {
    todayRows.push({ key: "policiesExpiringToday", value: expiringTodayCount, isMoney: false, targetUrl: "/policy" });

    const createdThisWeek = await prisma.policyRecord.count({
      where: { category: { in: policyCategories }, deletedAt: null, processingDate: { gte: weekRange.gte, lt: weekRange.lt } },
    });
    thisWeekRows.push({ key: "policiesCreatedThisWeek", value: createdThisWeek, isMoney: false, targetUrl: "/policy" });

    const clientPaymentsTodayCount = await prisma.policyCustomerReceipt.count({
      where: { deletedAt: null, receiptDate: { gte: todayRange.gte, lt: todayRange.lt }, policyRecord: { category: { in: policyCategories } } },
    });
    todayRows.push({ key: "clientPaymentsToday", value: clientPaymentsTodayCount, isMoney: false, targetUrl: "/policy" });

    const clientPaymentsWeekCount = await prisma.policyCustomerReceipt.count({
      where: { deletedAt: null, receiptDate: { gte: weekRange.gte, lt: weekRange.lt }, policyRecord: { category: { in: policyCategories } } },
    });
    thisWeekRows.push({ key: "clientPaymentsThisWeek", value: clientPaymentsWeekCount, isMoney: false, targetUrl: "/policy" });

    if (hasSystemLedger) {
      const insurerPaymentsTodayCount = await prisma.policyProviderPayment.count({
        where: { deletedAt: null, paymentDate: { gte: todayRange.gte, lt: todayRange.lt }, policyRecord: { category: { in: policyCategories } } },
      });
      todayRows.push({ key: "insurerPaymentsToday", value: insurerPaymentsTodayCount, isMoney: false, targetUrl: "/ledger/system" });

      const insurerPaymentsWeekCount = await prisma.policyProviderPayment.count({
        where: { deletedAt: null, paymentDate: { gte: weekRange.gte, lt: weekRange.lt }, policyRecord: { category: { in: policyCategories } } },
      });
      thisWeekRows.push({ key: "insurerPaymentsThisWeek", value: insurerPaymentsWeekCount, isMoney: false, targetUrl: "/ledger/system" });
    }
  }

  if (hasMotorClaim) {
    const [reportedToday, reportedWeek] = await Promise.all([
      prisma.motorClaim.count({
        where: {
          deletedAt: null,
          reportedAt: { gte: todayRange.gte, lt: todayRange.lt },
          ...(participantScope ? { participants: { some: { userId: participantScope } } } : {}),
        },
      }),
      prisma.motorClaim.count({
        where: {
          deletedAt: null,
          reportedAt: { gte: weekRange.gte, lt: weekRange.lt },
          ...(participantScope ? { participants: { some: { userId: participantScope } } } : {}),
        },
      }),
    ]);
    todayRows.push({ key: "motorClaimsReportedToday", value: reportedToday, isMoney: false, targetUrl: "/task/motor-claim" });
    thisWeekRows.push({ key: "motorClaimsReportedThisWeek", value: reportedWeek, isMoney: false, targetUrl: "/task/motor-claim" });
  }

  if (hasNonMotorClaim) {
    const [reportedToday, reportedWeek] = await Promise.all([
      prisma.nonMotorClaim.count({
        where: {
          deletedAt: null,
          reportedAt: { gte: todayRange.gte, lt: todayRange.lt },
          ...(participantScope ? { participants: { some: { userId: participantScope } } } : {}),
        },
      }),
      prisma.nonMotorClaim.count({
        where: {
          deletedAt: null,
          reportedAt: { gte: weekRange.gte, lt: weekRange.lt },
          ...(participantScope ? { participants: { some: { userId: participantScope } } } : {}),
        },
      }),
    ]);
    todayRows.push({ key: "nonMotorClaimsReportedToday", value: reportedToday, isMoney: false, targetUrl: "/task/non-motor-claim" });
    thisWeekRows.push({ key: "nonMotorClaimsReportedThisWeek", value: reportedWeek, isMoney: false, targetUrl: "/task/non-motor-claim" });
  }

  return { todayRows, thisWeekRows };
}
