import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit, hasPermission, isAdmin } from "@/lib/permissions";
import type { ClaimStatus } from "@/generated/prisma/enums";

export type ClaimAuthResult =
  | { kind: "no-module-access" }
  | { kind: "not-found" }
  | {
      kind: "ok";
      userId: string;
      claimId: string;
      createdById: string;
      status: ClaimStatus;
      isCreator: boolean;
      isParticipant: boolean;
      isAdmin: boolean;
      // Module-level claim.motor/claim.non_motor VIEW/EDIT permission —
      // independent of this specific Claim. Mirrors
      // src/lib/task/access.ts's TaskAuthResult.moduleCanEdit.
      moduleCanEdit: boolean;
      // Collaborator capability for THIS Claim: Admin OR Creator OR
      // Participant — a Claim Participant is a full collaborator who can
      // advance the claim through its existing progress states, manage
      // participants, and manage documents, not just view (see this
      // phase's spec, Part VIII). Every mutating action except Delete
      // Claim gates on this alone.
      canEdit: boolean;
      // Admin OR Creator only — deleting a Claim stays creator/admin-only,
      // matching Task's Delete restriction (Part VI).
      canDelete: boolean;
    };

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

  const userIsAdmin = isAdmin(session.user);
  const userIsCreator = claim.createdById === session.user.id;
  // See checkTaskAccess's identical comment — the WHERE clause above
  // already restricted the match to participants, so this is always true.
  const userIsParticipant = true;

  return {
    kind: "ok",
    userId: session.user.id,
    claimId: claim.id,
    createdById: claim.createdById,
    status: claim.status,
    isCreator: userIsCreator,
    isParticipant: userIsParticipant,
    isAdmin: userIsAdmin,
    moduleCanEdit: canEdit(session.user, "claim.motor"),
    canEdit: userIsAdmin || userIsCreator || userIsParticipant,
    canDelete: userIsAdmin || userIsCreator,
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

  const userIsAdmin = isAdmin(session.user);
  const userIsCreator = claim.createdById === session.user.id;
  const userIsParticipant = true;

  return {
    kind: "ok",
    userId: session.user.id,
    claimId: claim.id,
    createdById: claim.createdById,
    status: claim.status,
    isCreator: userIsCreator,
    isParticipant: userIsParticipant,
    isAdmin: userIsAdmin,
    moduleCanEdit: canEdit(session.user, "claim.non_motor"),
    canEdit: userIsAdmin || userIsCreator || userIsParticipant,
    canDelete: userIsAdmin || userIsCreator,
  };
}
