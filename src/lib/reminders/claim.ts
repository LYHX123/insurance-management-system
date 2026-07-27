import { prisma } from "@/lib/prisma";
import { daysSince, toValidDate } from "./datetime";
import type { ReminderItem } from "./types";

// Both Motor Claim and Non-Motor Claim are participant-scoped (see
// src/lib/claims/access.ts) — reminders must retain that restriction in
// addition to the claim.motor/claim.non_motor permission (Part 12.8). Pass
// `null` for `participantUserId` to bypass this restriction (ADMIN sees
// every qualifying claim regardless of personal participation).
// ClaimStatus only has OPEN/CLOSED in this schema (no separate
// SETTLED/REJECTED/WITHDRAWN values) — CLOSED is the only excluded status.

export async function getMotorClaimReminders(
  participantUserId: string | null,
  thresholdDays: number,
  timeZone: string,
  now: Date = new Date()
): Promise<ReminderItem[]> {
  const claims = await prisma.motorClaim.findMany({
    where: {
      status: "OPEN",
      deletedAt: null,
      ...(participantUserId ? { participants: { some: { userId: participantUserId } } } : {}),
    },
    select: {
      id: true,
      claimNumber: true,
      numberPlate: true,
      createdAt: true,
      updatedAt: true,
      customer: { select: { companyName: true } },
      updates: {
        where: { deletedAt: null },
        select: { createdAt: true, editedAt: true },
      },
    },
  });

  const items: ReminderItem[] = [];
  for (const claim of claims) {
    // Latest meaningful activity: every user-entered update AND every
    // system-generated timeline entry (progress change, reopen,
    // participants updated, ...) already lives in MotorClaimUpdate — see
    // that model's doc comment — so this is the accurate "latest activity"
    // date without needing to separately parse `progress` changes.
    let latest: Date | null = null;
    for (const update of claim.updates) {
      const updateDate = toValidDate(update.editedAt ?? update.createdAt);
      if (updateDate && (!latest || updateDate > latest)) latest = updateDate;
    }
    // Defensive fallback (every claim has at least its initial "created"
    // update in practice) — never crashes if that invariant is ever broken.
    if (!latest) latest = toValidDate(claim.updatedAt) ?? toValidDate(claim.createdAt);
    if (!latest) continue;

    const days = daysSince(latest, timeZone, now);
    if (days < thresholdDays) continue;

    items.push({
      id: `motor-claim:${claim.id}`,
      category: "claim.motor",
      severity: "inactivity",
      recordId: claim.id,
      recordNumber: claim.claimNumber,
      customerName: claim.customer?.companyName ?? null,
      extra: claim.numberPlate,
      days,
      referenceDate: latest.toISOString(),
      targetUrl: `/task/motor-claim/${claim.id}`,
      permissionKey: "claim.motor",
    });
  }

  return items;
}

export async function getNonMotorClaimReminders(
  participantUserId: string | null,
  thresholdDays: number,
  timeZone: string,
  now: Date = new Date()
): Promise<ReminderItem[]> {
  const claims = await prisma.nonMotorClaim.findMany({
    where: {
      status: "OPEN",
      deletedAt: null,
      ...(participantUserId ? { participants: { some: { userId: participantUserId } } } : {}),
    },
    select: {
      id: true,
      claimNumber: true,
      insuranceType: true,
      createdAt: true,
      updatedAt: true,
      customer: { select: { companyName: true } },
      updates: {
        where: { deletedAt: null },
        select: { createdAt: true, editedAt: true },
      },
    },
  });

  const items: ReminderItem[] = [];
  for (const claim of claims) {
    let latest: Date | null = null;
    for (const update of claim.updates) {
      const updateDate = toValidDate(update.editedAt ?? update.createdAt);
      if (updateDate && (!latest || updateDate > latest)) latest = updateDate;
    }
    if (!latest) latest = toValidDate(claim.updatedAt) ?? toValidDate(claim.createdAt);
    if (!latest) continue;

    const days = daysSince(latest, timeZone, now);
    if (days < thresholdDays) continue;

    items.push({
      id: `non-motor-claim:${claim.id}`,
      category: "claim.non_motor",
      severity: "inactivity",
      recordId: claim.id,
      recordNumber: claim.claimNumber,
      customerName: claim.customer?.companyName ?? null,
      extra: claim.insuranceType,
      days,
      referenceDate: latest.toISOString(),
      targetUrl: `/task/non-motor-claim/${claim.id}`,
      permissionKey: "claim.non_motor",
    });
  }

  return items;
}
