import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import type { ClaimStatus } from "@/generated/prisma/enums";

export type ClaimAuthResult =
  | { kind: "no-module-access" }
  | { kind: "not-found" }
  | { kind: "ok"; userId: string; claimId: string; createdById: string; status: ClaimStatus; isCreator: boolean };

// The single security primitive every Motor Claim server action and the
// Motor Claim detail route go through — mirrors src/lib/task/access.ts's
// checkTaskAccess exactly (see this phase's spec, Part K.40). The Prisma
// query itself restricts rows to Claims the current user actually
// participates in; "not-found" is returned for a missing Claim, a
// soft-deleted Claim, AND a real Claim the current user isn't a participant
// of — deliberately indistinguishable so a non-participant direct URL
// attempt can never learn whether a given Claim id even exists.
export async function checkMotorClaimAccess(claimId: string): Promise<ClaimAuthResult> {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "claim.motor")) {
    return { kind: "no-module-access" };
  }

  const claim = await prisma.motorClaim.findFirst({
    where: { id: claimId, deletedAt: null, participants: { some: { userId: session.user.id } } },
    select: { id: true, createdById: true, status: true },
  });
  if (!claim) return { kind: "not-found" };

  return {
    kind: "ok",
    userId: session.user.id,
    claimId: claim.id,
    createdById: claim.createdById,
    status: claim.status,
    isCreator: claim.createdById === session.user.id,
  };
}

export async function checkNonMotorClaimAccess(claimId: string): Promise<ClaimAuthResult> {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "claim.non_motor")) {
    return { kind: "no-module-access" };
  }

  const claim = await prisma.nonMotorClaim.findFirst({
    where: { id: claimId, deletedAt: null, participants: { some: { userId: session.user.id } } },
    select: { id: true, createdById: true, status: true },
  });
  if (!claim) return { kind: "not-found" };

  return {
    kind: "ok",
    userId: session.user.id,
    claimId: claim.id,
    createdById: claim.createdById,
    status: claim.status,
    isCreator: claim.createdById === session.user.id,
  };
}
