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

  const alreadyInitialized = await prisma.motorClaimReadState.findFirst({ where: { userId }, select: { id: true } });
  if (alreadyInitialized) return;

  const claims = await prisma.motorClaim.findMany({ where: { id: { in: visibleClaimIds } }, select: { id: true, updatedAt: true } });
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

  const alreadyInitialized = await prisma.nonMotorClaimReadState.findFirst({ where: { userId }, select: { id: true } });
  if (alreadyInitialized) return;

  const claims = await prisma.nonMotorClaim.findMany({ where: { id: { in: visibleClaimIds } }, select: { id: true, updatedAt: true } });
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
