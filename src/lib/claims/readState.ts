import { prisma } from "@/lib/prisma";

// Motor Claim / Non-Motor Claim User-Level Unread Indicator. Mirrors
// src/lib/task/readState.ts's design exactly (baseline-on-first-visit rule
// included — see that file's doc comment) — two parallel, independent
// implementations rather than one generic helper shared across the three
// Prisma delegates, matching this schema's existing convention of a
// dedicated model (and dedicated helper code) per entity type rather than a
// shared polymorphic abstraction (see MotorClaimParticipant's schema
// comment, and src/lib/claims/access.ts's own checkMotorClaimAccess /
// checkNonMotorClaimAccess pair for the same one-file-two-mirrors shape).

export async function ensureMotorClaimReadStateBaseline(userId: string, visibleClaimIds: string[]): Promise<void> {
  if (visibleClaimIds.length === 0) return;

  // See ensureTaskReadStateBaseline's identical comment in
  // src/lib/task/readState.ts (audit finding, 2026-08-24) — the gate here
  // used to be "does this user have ANY MotorClaimReadState row anywhere",
  // which could wrongly cause baseline to skip backfilling a user's
  // genuinely historical Claims once they had a fresh explicit-unread row
  // for a brand-new Claim. Fixed the same way: only backfill a Claim still
  // missing a row after checking the exact visible set passed in.
  const existing = await prisma.motorClaimReadState.findMany({
    where: { userId, motorClaimId: { in: visibleClaimIds } },
    select: { motorClaimId: true },
  });
  const existingIds = new Set(existing.map((r) => r.motorClaimId));
  const missingClaimIds = visibleClaimIds.filter((id) => !existingIds.has(id));
  if (missingClaimIds.length === 0) return;

  const claims = await prisma.motorClaim.findMany({ where: { id: { in: missingClaimIds } }, select: { id: true, updatedAt: true } });
  if (claims.length === 0) return;

  try {
    await prisma.motorClaimReadState.createMany({
      data: claims.map((c) => ({ motorClaimId: c.id, userId, lastViewedAt: c.updatedAt })),
      skipDuplicates: true,
    });
  } catch (err) {
    console.error("Failed to establish Motor Claim read-state baseline:", err);
  }
}

// See initializeUnreadTaskReadStates's identical doc comment in
// src/lib/task/readState.ts — same explicit-initialization purpose and same
// deterministic (derived, not wall-clock-raced) "guaranteed earlier than
// parent.updatedAt" technique.
export async function initializeUnreadMotorClaimReadStates(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  motorClaimId: string,
  parentUpdatedAt: Date,
  newParticipantUserIds: string[]
): Promise<void> {
  if (newParticipantUserIds.length === 0) return;
  const guaranteedUnreadAt = new Date(parentUpdatedAt.getTime() - 1000);
  await tx.motorClaimReadState.createMany({
    data: newParticipantUserIds.map((userId) => ({ motorClaimId, userId, lastViewedAt: guaranteedUnreadAt })),
    skipDuplicates: true,
  });
}

export async function getUnreadMotorClaimIds(userId: string, claims: { id: string; updatedAt: Date }[]): Promise<Set<string>> {
  if (claims.length === 0) return new Set();

  await ensureMotorClaimReadStateBaseline(userId, claims.map((c) => c.id));

  const readStates = await prisma.motorClaimReadState.findMany({
    where: { userId, motorClaimId: { in: claims.map((c) => c.id) } },
    select: { motorClaimId: true, lastViewedAt: true },
  });
  const lastViewedByClaimId = new Map(readStates.map((r) => [r.motorClaimId, r.lastViewedAt]));

  const unread = new Set<string>();
  for (const c of claims) {
    const lastViewed = lastViewedByClaimId.get(c.id);
    if (!lastViewed || c.updatedAt > lastViewed) unread.add(c.id);
  }
  return unread;
}

export async function markMotorClaimViewed(userId: string, motorClaimId: string): Promise<void> {
  await prisma.motorClaimReadState.upsert({
    where: { motorClaimId_userId: { motorClaimId, userId } },
    create: { motorClaimId, userId, lastViewedAt: new Date() },
    update: { lastViewedAt: new Date() },
  });
}

export async function ensureNonMotorClaimReadStateBaseline(userId: string, visibleClaimIds: string[]): Promise<void> {
  if (visibleClaimIds.length === 0) return;

  // See ensureTaskReadStateBaseline's identical comment in
  // src/lib/task/readState.ts (audit finding, 2026-08-24).
  const existing = await prisma.nonMotorClaimReadState.findMany({
    where: { userId, nonMotorClaimId: { in: visibleClaimIds } },
    select: { nonMotorClaimId: true },
  });
  const existingIds = new Set(existing.map((r) => r.nonMotorClaimId));
  const missingClaimIds = visibleClaimIds.filter((id) => !existingIds.has(id));
  if (missingClaimIds.length === 0) return;

  const claims = await prisma.nonMotorClaim.findMany({ where: { id: { in: missingClaimIds } }, select: { id: true, updatedAt: true } });
  if (claims.length === 0) return;

  try {
    await prisma.nonMotorClaimReadState.createMany({
      data: claims.map((c) => ({ nonMotorClaimId: c.id, userId, lastViewedAt: c.updatedAt })),
      skipDuplicates: true,
    });
  } catch (err) {
    console.error("Failed to establish Non-Motor Claim read-state baseline:", err);
  }
}

// See initializeUnreadTaskReadStates's identical doc comment in
// src/lib/task/readState.ts.
export async function initializeUnreadNonMotorClaimReadStates(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  nonMotorClaimId: string,
  parentUpdatedAt: Date,
  newParticipantUserIds: string[]
): Promise<void> {
  if (newParticipantUserIds.length === 0) return;
  const guaranteedUnreadAt = new Date(parentUpdatedAt.getTime() - 1000);
  await tx.nonMotorClaimReadState.createMany({
    data: newParticipantUserIds.map((userId) => ({ nonMotorClaimId, userId, lastViewedAt: guaranteedUnreadAt })),
    skipDuplicates: true,
  });
}

export async function getUnreadNonMotorClaimIds(userId: string, claims: { id: string; updatedAt: Date }[]): Promise<Set<string>> {
  if (claims.length === 0) return new Set();

  await ensureNonMotorClaimReadStateBaseline(userId, claims.map((c) => c.id));

  const readStates = await prisma.nonMotorClaimReadState.findMany({
    where: { userId, nonMotorClaimId: { in: claims.map((c) => c.id) } },
    select: { nonMotorClaimId: true, lastViewedAt: true },
  });
  const lastViewedByClaimId = new Map(readStates.map((r) => [r.nonMotorClaimId, r.lastViewedAt]));

  const unread = new Set<string>();
  for (const c of claims) {
    const lastViewed = lastViewedByClaimId.get(c.id);
    if (!lastViewed || c.updatedAt > lastViewed) unread.add(c.id);
  }
  return unread;
}

export async function markNonMotorClaimViewed(userId: string, nonMotorClaimId: string): Promise<void> {
  await prisma.nonMotorClaimReadState.upsert({
    where: { nonMotorClaimId_userId: { nonMotorClaimId, userId } },
    create: { nonMotorClaimId, userId, lastViewedAt: new Date() },
    update: { lastViewedAt: new Date() },
  });
}
