import { prisma } from "@/lib/prisma";
import { computeBusinessStatus } from "@/lib/policy/status";
import { daysRemaining, toValidDate } from "./datetime";
import type { ReminderItem, ReminderCategory, ReminderSeverity } from "./types";
import type { PolicyCategory } from "@/generated/prisma/enums";

const CATEGORY_SLUG: Record<PolicyCategory, string> = {
  MOTOR: "motor",
  NON_MOTOR: "non-motor",
  BOND: "bond",
  WORK_PERMIT: "work-permit",
};

const CATEGORY_PERMISSION: Record<PolicyCategory, ReminderCategory> = {
  MOTOR: "policy.motor",
  NON_MOTOR: "policy.non_motor",
  BOND: "policy.bond",
  WORK_PERMIT: "policy.work_permit",
};

function severityForDays(days: number): ReminderSeverity {
  if (days < 0) return "expired";
  if (days === 0) return "due_today";
  return "due_soon";
}

// One category's expiry reminders. Motor uses its own threshold; Non-Motor/
// Bond/Work Permit all share the "Other Policy" threshold (Part 9).
async function getRemindersForCategory(
  category: PolicyCategory,
  thresholdDays: number,
  timeZone: string,
  now: Date
): Promise<ReminderItem[]> {
  // Excludes CANCELLED/RENEWED at the query level (Part 9.4/9.6) — never
  // fetched then filtered client-side. Everything else is narrowed further
  // in-process using the exact same computeBusinessStatus() the Policy
  // pages already use, so "is this actually expired" is never redefined
  // twice.
  const records = await prisma.policyRecord.findMany({
    where: {
      category,
      deletedAt: null,
      businessStatus: { notIn: ["CANCELLED", "RENEWED"] },
    },
    select: {
      id: true,
      recordNumber: true,
      effectiveDate: true,
      expiryDate: true,
      businessStatus: true,
      customer: { select: { companyName: true } },
      project: { select: { projectName: true } },
      motorDetail: { select: { registrationNumber: true } },
    },
    orderBy: { expiryDate: "asc" },
  });

  const items: ReminderItem[] = [];
  for (const record of records) {
    const effectiveDate = toValidDate(record.effectiveDate);
    const expiryDate = toValidDate(record.expiryDate);
    // Part 20.6: a record with an unusable date is skipped safely, never
    // crashes reminder generation.
    if (!effectiveDate || !expiryDate) continue;

    const status = computeBusinessStatus(effectiveDate, expiryDate, record.businessStatus, now);
    // Only ACTIVE (on cover) or EXPIRED (lapsed, still not closed out)
    // records are ever reminder-eligible — a DRAFT (future effective date)
    // record is not yet on cover and is never inferred from creation date.
    if (status !== "ACTIVE" && status !== "EXPIRED") continue;

    const days = daysRemaining(expiryDate, timeZone, now);
    if (days > thresholdDays) continue;

    items.push({
      id: `policy:${record.id}`,
      category: CATEGORY_PERMISSION[category],
      severity: severityForDays(days),
      recordId: record.id,
      recordNumber: record.recordNumber,
      customerName: record.customer?.companyName ?? null,
      extra: record.motorDetail?.registrationNumber ?? record.project?.projectName ?? null,
      days,
      referenceDate: expiryDate.toISOString(),
      targetUrl: `/policy/${CATEGORY_SLUG[category]}/${record.id}`,
      permissionKey: CATEGORY_PERMISSION[category],
    });
  }

  return items;
}

export async function getMotorPolicyReminders(
  thresholdDays: number,
  timeZone: string,
  now: Date = new Date()
): Promise<ReminderItem[]> {
  return getRemindersForCategory("MOTOR", thresholdDays, timeZone, now);
}

// Non-Motor, Bond, and Work Permit all share the "Other Policy" threshold.
export async function getOtherPolicyReminders(
  thresholdDays: number,
  timeZone: string,
  now: Date = new Date()
): Promise<ReminderItem[]> {
  const [nonMotor, bond, workPermit] = await Promise.all([
    getRemindersForCategory("NON_MOTOR", thresholdDays, timeZone, now),
    getRemindersForCategory("BOND", thresholdDays, timeZone, now),
    getRemindersForCategory("WORK_PERMIT", thresholdDays, timeZone, now),
  ]);
  return [...nonMotor, ...bond, ...workPermit];
}
