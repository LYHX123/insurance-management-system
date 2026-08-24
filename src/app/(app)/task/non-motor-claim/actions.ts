"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit, hasPermission } from "@/lib/permissions";
import { checkNonMotorClaimAccess } from "@/lib/claims/access";
import { generateNonMotorClaimNumber } from "@/lib/claims/nonMotorClaimNumber";
import { isNonMotorClaimProgress, type NonMotorClaimProgressValue } from "@/lib/claims/enums";
import { isNonMotorCoverType, type NonMotorCoverType } from "@/lib/policy/nonMotorCoverTypes";
import { NON_MOTOR_PROGRESS_EN_LABEL } from "@/lib/claims/systemLabels";
import { getNonMotorPolicyLinkOptions, validatePolicyLink } from "@/lib/claims/policyLink";
import { initializeUnreadNonMotorClaimReadStates, getUnreadNonMotorClaimIds } from "@/lib/claims/readState";
import { publishTaskActivityAfterMutation } from "@/lib/task/liveNotifications";
import type { ClaimPolicyOption } from "@/components/claims/types";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

const CONTACT_MAX_LENGTH = 200;
const INSURER_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 4000;
const INJURED_NAME_MAX_LENGTH = 200;

// The single insuranceType value that requires Injured Name — see
// NonMotorClaim.injuredName's schema comment. Sourced from the existing
// NonMotorCoverType enum (never a hardcoded/duplicated string literal
// elsewhere), so this stays correct even if the enum's values change.
const WIBA_INSURANCE_TYPE: NonMotorCoverType = "WIBA";

async function requireTaskPermission() {
  const session = await auth();
  if (!session?.user || !canEdit(session.user, "claim.non_motor")) return null;
  return session;
}

function touchNonMotorClaim(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], claimId: string) {
  // Audit finding (2026-08-24): an empty `data: {}` does NOT bump
  // @updatedAt in this Prisma version/adapter — see touchTask's comment in
  // src/app/(app)/task/actions.ts for the empirical confirmation. Passing
  // `updatedAt` explicitly is the fix.
  return tx.nonMotorClaim.update({ where: { id: claimId }, data: { updatedAt: new Date() } });
}

// Claim User-Level Unread Indicator — mirrors touchOwnMotorClaimReadState in
// src/app/(app)/task/motor-claim/actions.ts exactly (see that file's doc
// comment).
function touchOwnNonMotorClaimReadState(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], nonMotorClaimId: string, userId: string) {
  return tx.nonMotorClaimReadState.upsert({
    where: { nonMotorClaimId_userId: { nonMotorClaimId, userId } },
    create: { nonMotorClaimId, userId, lastViewedAt: new Date() },
    update: { lastViewedAt: new Date() },
  });
}

async function validateProjectForCustomer(
  customerId: string,
  projectId: string | null | undefined
): Promise<{ error: string } | { ok: true; projectId: string | null }> {
  if (!projectId) return { ok: true, projectId: null };
  const project = await prisma.customerProject.findUnique({ where: { id: projectId }, select: { customerId: true } });
  if (!project || project.customerId !== customerId) return { error: "PROJECT_NOT_FOUND" };
  return { ok: true, projectId };
}

// Re-validates a submitted policyRecordId against the Claim's OWN customerId
// (never trusts the client's selection alone — see this phase's spec, Part
// 15.I5/I6 and src/lib/claims/policyLink.ts).
async function resolvePolicyRecordId(
  customerId: string,
  policyRecordId: string | null | undefined
): Promise<{ error: string } | { ok: true; policyRecordId: string | null }> {
  if (!policyRecordId) return { ok: true, policyRecordId: null };
  const result = await validatePolicyLink(policyRecordId, customerId, "NON_MOTOR");
  if (!result.ok) return { error: result.error };
  return { ok: true, policyRecordId };
}

// Customer-scoped Non-Motor Policy candidates for the client-side "Linked
// Policy" selector, re-fetched whenever the Customer field changes inside
// the create/edit modal (never trusted from client state — see Part 2).
export async function getNonMotorClaimPolicyOptionsAction(customerId: string): Promise<ClaimPolicyOption[]> {
  const session = await requireTaskPermission();
  if (!session || !customerId) return [];
  return getNonMotorPolicyLinkOptions(customerId);
}

export type NonMotorClaimInput = {
  reportedAt: string;
  customerId: string;
  projectId?: string | null;
  contactName: string;
  contactPhone: string;
  insurer: string;
  insuranceType: string;
  // WIBA-only — see NonMotorClaim.injuredName's schema comment. Ignored
  // (never persisted) for every other insuranceType, regardless of what
  // the client sends.
  injuredName?: string | null;
  progress: string;
  policyRecordId?: string | null;
};

type ValidatedNonMotorClaim = {
  reportedAt: Date;
  customerId: string;
  contactName: string;
  contactPhone: string;
  insurer: string;
  insuranceType: NonMotorCoverType;
  injuredName: string | null;
  progress: NonMotorClaimProgressValue;
};

function validateInput(input: NonMotorClaimInput): { error: string } | { ok: true; data: ValidatedNonMotorClaim } {
  if (!input.reportedAt) return { error: "REPORTED_AT_REQUIRED" };
  const reportedAt = new Date(input.reportedAt);
  if (Number.isNaN(reportedAt.getTime())) return { error: "REPORTED_AT_REQUIRED" };

  if (!input.customerId) return { error: "CUSTOMER_REQUIRED" };

  const contactName = input.contactName?.trim();
  if (!contactName) return { error: "CONTACT_NAME_REQUIRED" };
  if (contactName.length > CONTACT_MAX_LENGTH) return { error: "CONTACT_NAME_TOO_LONG" };

  const contactPhone = input.contactPhone?.trim();
  if (!contactPhone) return { error: "CONTACT_PHONE_REQUIRED" };
  if (contactPhone.length > CONTACT_MAX_LENGTH) return { error: "CONTACT_PHONE_TOO_LONG" };

  const insurer = input.insurer?.trim();
  if (!insurer) return { error: "INSURER_REQUIRED" };
  if (insurer.length > INSURER_MAX_LENGTH) return { error: "INSURER_TOO_LONG" };

  // Only ever the shared Non-Motor cover-type set — a Motor/Bond/Work
  // Permit value submitted directly is rejected here (see this phase's
  // spec, Part G.32 from Phase 6B, unchanged).
  if (!isNonMotorCoverType(input.insuranceType)) return { error: "INSURANCE_TYPE_INVALID" };
  if (!isNonMotorClaimProgress(input.progress)) return { error: "PROGRESS_INVALID" };

  // WIBA Injured Name — required (and trimmed) only for WIBA; silently
  // discarded (never persisted) for every other insuranceType so a stray
  // client-sent value from a since-switched-away form field can never leak
  // into the database (see NonMotorClaim.injuredName's schema comment).
  const isWiba = input.insuranceType === WIBA_INSURANCE_TYPE;
  let injuredName: string | null = null;
  if (isWiba) {
    const trimmed = input.injuredName?.trim() ?? "";
    if (!trimmed) return { error: "INJURED_NAME_REQUIRED" };
    if (trimmed.length > INJURED_NAME_MAX_LENGTH) return { error: "INJURED_NAME_TOO_LONG" };
    injuredName = trimmed;
  }

  return {
    ok: true,
    data: { reportedAt, customerId: input.customerId, contactName, contactPhone, insurer, insuranceType: input.insuranceType, injuredName, progress: input.progress },
  };
}

// ============================================================================
// Creation
// ============================================================================

export type CreateNonMotorClaimInput = NonMotorClaimInput & { participantIds: string[] };

export async function createNonMotorClaimAction(
  input: CreateNonMotorClaimInput
): Promise<ActionResult<{ id: string; claimNumber: string }>> {
  const session = await requireTaskPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const validated = validateInput(input);
  if (!("ok" in validated)) return { success: false, error: validated.error };

  const customer = await prisma.customer.findUnique({ where: { id: validated.data.customerId }, select: { id: true } });
  if (!customer) return { success: false, error: "CUSTOMER_NOT_FOUND" };

  const projectResult = await validateProjectForCustomer(validated.data.customerId, input.projectId);
  if (!("ok" in projectResult)) return { success: false, error: projectResult.error };

  const policyResult = await resolvePolicyRecordId(validated.data.customerId, input.policyRecordId);
  if (!("ok" in policyResult)) return { success: false, error: policyResult.error };

  const submittedIds = new Set((input.participantIds ?? []).filter((id) => id && id !== session.user.id));
  let activeParticipants: { id: string }[] = [];
  if (submittedIds.size > 0) {
    activeParticipants = await prisma.user.findMany({ where: { id: { in: [...submittedIds] }, status: "ACTIVE" }, select: { id: true } });
    if (activeParticipants.length !== submittedIds.size) return { success: false, error: "USER_INACTIVE" };
  }
  const participantUserIds = [session.user.id, ...activeParticipants.map((u) => u.id)];

  try {
    const claim = await prisma.$transaction(async (tx) => {
      const claimNumber = await generateNonMotorClaimNumber(tx);
      const created = await tx.nonMotorClaim.create({
        data: {
          claimNumber,
          reportedAt: validated.data.reportedAt,
          customerId: validated.data.customerId,
          projectId: projectResult.projectId,
          contactName: validated.data.contactName,
          contactPhone: validated.data.contactPhone,
          insurer: validated.data.insurer,
          insuranceType: validated.data.insuranceType,
          injuredName: validated.data.injuredName,
          progress: validated.data.progress,
          policyRecordId: policyResult.policyRecordId,
          createdById: session.user.id,
        },
      });
      await tx.nonMotorClaimParticipant.createMany({
        data: participantUserIds.map((userId) => ({ nonMotorClaimId: created.id, userId, addedById: session.user.id })),
      });
      await tx.nonMotorClaimUpdate.create({
        data: {
          nonMotorClaimId: created.id,
          content: `Claim created. Initial progress: ${NON_MOTOR_PROGRESS_EN_LABEL[validated.data.progress]}.`,
          isInitial: true,
          createdById: session.user.id,
        },
      });
      await touchOwnNonMotorClaimReadState(tx, created.id, session.user.id);
      // Same "being added to a new Claim is itself unread" rule as
      // createTaskAction (see src/app/(app)/task/actions.ts and
      // src/lib/claims/readState.ts's initializeUnreadNonMotorClaimReadStates).
      const otherParticipantIds = participantUserIds.filter((id) => id !== session.user.id);
      if (otherParticipantIds.length > 0) {
        await initializeUnreadNonMotorClaimReadStates(tx, created.id, created.updatedAt, otherParticipantIds);
      }
      return created;
    });

    revalidatePath("/task/non-motor-claim");
    publishTaskActivityAfterMutation({ scope: "NON_MOTOR_CLAIM", entityId: claim.id, actorUserId: session.user.id, participantUserIds: participantUserIds });
    return { success: true, id: claim.id, claimNumber: claim.claimNumber };
  } catch (err) {
    console.error("Failed to create Non-Motor Claim:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

// ============================================================================
// Core edit (collaborator, OPEN-only)
// ============================================================================

// Collaborator-level, not Creator-only — see the identical Motor Claim
// rationale in src/app/(app)/task/motor-claim/actions.ts. This is also how
// the Claim's `progress` field advances; the state machine itself is
// unchanged, only who may call this action.
export async function updateNonMotorClaimAction(id: string, input: NonMotorClaimInput): Promise<ActionResult> {
  const access = await checkNonMotorClaimAccess(id);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };

  const validated = validateInput(input);
  if (!("ok" in validated)) return { success: false, error: validated.error };

  const customer = await prisma.customer.findUnique({ where: { id: validated.data.customerId }, select: { id: true } });
  if (!customer) return { success: false, error: "CUSTOMER_NOT_FOUND" };

  const projectResult = await validateProjectForCustomer(validated.data.customerId, input.projectId);
  if (!("ok" in projectResult)) return { success: false, error: projectResult.error };

  const existing = await prisma.nonMotorClaim.findUnique({ where: { id }, select: { progress: true, policyRecordId: true } });
  if (!existing) return { success: false, error: "CLAIM_NOT_FOUND" };

  const policyResult = await resolvePolicyRecordId(validated.data.customerId, input.policyRecordId);
  if (!("ok" in policyResult)) return { success: false, error: policyResult.error };

  // Part 10/11 — see the identical Motor Claim rationale in
  // src/app/(app)/task/motor-claim/actions.ts.
  if (policyResult.policyRecordId !== existing.policyRecordId) {
    const syncedDocumentCount = await prisma.nonMotorClaimDocument.count({
      where: { nonMotorClaimId: id, dropboxSync: { syncStatus: "SYNCED" } },
    });
    if (syncedDocumentCount > 0) return { success: false, error: "CLAIM_POLICY_REASSIGNMENT_BLOCKED" };
  }

  try {
    const participantIds = await prisma.$transaction(async (tx) => {
      await tx.nonMotorClaim.update({
        where: { id },
        data: {
          reportedAt: validated.data.reportedAt,
          customerId: validated.data.customerId,
          projectId: projectResult.projectId,
          contactName: validated.data.contactName,
          contactPhone: validated.data.contactPhone,
          insurer: validated.data.insurer,
          insuranceType: validated.data.insuranceType,
          injuredName: validated.data.injuredName,
          progress: validated.data.progress,
          policyRecordId: policyResult.policyRecordId,
          updatedById: access.userId,
        },
      });
      if (existing.progress !== validated.data.progress) {
        await tx.nonMotorClaimUpdate.create({
          data: {
            nonMotorClaimId: id,
            content: `Progress changed from ${NON_MOTOR_PROGRESS_EN_LABEL[existing.progress]} to ${NON_MOTOR_PROGRESS_EN_LABEL[validated.data.progress]}.`,
            createdById: access.userId,
          },
        });
      }
      await touchOwnNonMotorClaimReadState(tx, id, access.userId);
      const participants = await tx.nonMotorClaimParticipant.findMany({ where: { nonMotorClaimId: id }, select: { userId: true } });
      return participants.map((p) => p.userId);
    });
    revalidatePath("/task/non-motor-claim");
    publishTaskActivityAfterMutation({ scope: "NON_MOTOR_CLAIM", entityId: id, actorUserId: access.userId, participantUserIds: participantIds });
    return { success: true };
  } catch (err) {
    console.error("Failed to update Non-Motor Claim:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

// ============================================================================
// Participants (collaborator, OPEN-only)
// ============================================================================

// Collaborator-level, not Creator-only — mirrors Task's
// updateParticipantsAction. The Creator can never be removed by anyone
// (enforced below), matching Claim visibility being scoped to
// `participants: { some: { userId } }` in checkNonMotorClaimAccess.
export async function updateNonMotorClaimParticipantsAction(claimId: string, participantIds: string[]): Promise<ActionResult> {
  const access = await checkNonMotorClaimAccess(claimId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };

  const current = await prisma.nonMotorClaimParticipant.findMany({ where: { nonMotorClaimId: claimId }, select: { userId: true } });
  const currentIds = new Set(current.map((p) => p.userId));

  const desiredIds = new Set([access.createdById, ...(participantIds ?? [])]);
  const toAdd = [...desiredIds].filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !desiredIds.has(id) && id !== access.createdById);

  if (toAdd.length > 0) {
    const activeUsers = await prisma.user.findMany({ where: { id: { in: toAdd }, status: "ACTIVE" }, select: { id: true } });
    if (activeUsers.length !== toAdd.length) return { success: false, error: "USER_INACTIVE" };
  }
  if (toAdd.length === 0 && toRemove.length === 0) return { success: true };

  try {
    await prisma.$transaction(async (tx) => {
      if (toRemove.length > 0) await tx.nonMotorClaimParticipant.deleteMany({ where: { nonMotorClaimId: claimId, userId: { in: toRemove } } });
      if (toAdd.length > 0) {
        await tx.nonMotorClaimParticipant.createMany({ data: toAdd.map((userId) => ({ nonMotorClaimId: claimId, userId, addedById: access.userId })) });
      }
      await tx.nonMotorClaimUpdate.create({ data: { nonMotorClaimId: claimId, content: "Participants updated.", createdById: access.userId } });
      const touchedClaim = await touchNonMotorClaim(tx, claimId);
      await touchOwnNonMotorClaimReadState(tx, claimId, access.userId);
      if (toAdd.length > 0) {
        await initializeUnreadNonMotorClaimReadStates(tx, claimId, touchedClaim.updatedAt, toAdd);
      }
    });
    revalidatePath("/task/non-motor-claim");
    publishTaskActivityAfterMutation({ scope: "NON_MOTOR_CLAIM", entityId: claimId, actorUserId: access.userId, participantUserIds: [...desiredIds] });
    return { success: true };
  } catch (err) {
    console.error("Failed to update Non-Motor Claim participants:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

// ============================================================================
// Timeline
// ============================================================================

export async function addNonMotorClaimUpdateAction(claimId: string, content: string): Promise<ActionResult<{ id: string }>> {
  const access = await checkNonMotorClaimAccess(claimId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };

  const trimmed = content?.trim();
  if (!trimmed) return { success: false, error: "CONTENT_REQUIRED" };
  if (trimmed.length > CONTENT_MAX_LENGTH) return { success: false, error: "CONTENT_TOO_LONG" };

  try {
    const { entry, participantIds } = await prisma.$transaction(async (tx) => {
      const created = await tx.nonMotorClaimUpdate.create({ data: { nonMotorClaimId: claimId, content: trimmed, createdById: access.userId } });
      await touchNonMotorClaim(tx, claimId);
      await touchOwnNonMotorClaimReadState(tx, claimId, access.userId);
      const participants = await tx.nonMotorClaimParticipant.findMany({ where: { nonMotorClaimId: claimId }, select: { userId: true } });
      return { entry: created, participantIds: participants.map((p) => p.userId) };
    });
    revalidatePath("/task/non-motor-claim");
    publishTaskActivityAfterMutation({ scope: "NON_MOTOR_CLAIM", entityId: claimId, actorUserId: access.userId, participantUserIds: participantIds });
    return { success: true, id: entry.id };
  } catch (err) {
    console.error("Failed to add Non-Motor Claim update:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

export async function editNonMotorClaimUpdateAction(updateId: string, content: string): Promise<ActionResult> {
  const entry = await prisma.nonMotorClaimUpdate.findUnique({
    where: { id: updateId },
    select: { nonMotorClaimId: true, createdById: true, deletedAt: true, isInitial: true },
  });
  if (!entry || entry.deletedAt) return { success: false, error: "UPDATE_NOT_FOUND" };
  if (entry.isInitial) return { success: false, error: "FORBIDDEN" };

  const access = await checkNonMotorClaimAccess(entry.nonMotorClaimId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };
  if (entry.createdById !== access.userId && !access.isCreator && !access.isAdmin) return { success: false, error: "FORBIDDEN" };

  const trimmed = content?.trim();
  if (!trimmed) return { success: false, error: "CONTENT_REQUIRED" };
  if (trimmed.length > CONTENT_MAX_LENGTH) return { success: false, error: "CONTENT_TOO_LONG" };

  try {
    const participantIds = await prisma.$transaction(async (tx) => {
      await tx.nonMotorClaimUpdate.update({ where: { id: updateId }, data: { content: trimmed, editedAt: new Date() } });
      await touchNonMotorClaim(tx, entry.nonMotorClaimId);
      await touchOwnNonMotorClaimReadState(tx, entry.nonMotorClaimId, access.userId);
      const participants = await tx.nonMotorClaimParticipant.findMany({ where: { nonMotorClaimId: entry.nonMotorClaimId }, select: { userId: true } });
      return participants.map((p) => p.userId);
    });
    revalidatePath("/task/non-motor-claim");
    publishTaskActivityAfterMutation({ scope: "NON_MOTOR_CLAIM", entityId: entry.nonMotorClaimId, actorUserId: access.userId, participantUserIds: participantIds });
    return { success: true };
  } catch (err) {
    console.error("Failed to edit Non-Motor Claim update:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

export async function deleteNonMotorClaimUpdateAction(updateId: string): Promise<ActionResult> {
  const entry = await prisma.nonMotorClaimUpdate.findUnique({
    where: { id: updateId },
    select: { nonMotorClaimId: true, createdById: true, deletedAt: true, isInitial: true },
  });
  if (!entry || entry.deletedAt) return { success: false, error: "UPDATE_NOT_FOUND" };
  if (entry.isInitial) return { success: false, error: "FORBIDDEN" };

  const access = await checkNonMotorClaimAccess(entry.nonMotorClaimId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };
  if (entry.createdById !== access.userId && !access.isCreator && !access.isAdmin) return { success: false, error: "FORBIDDEN" };

  const visibleCount = await prisma.nonMotorClaimUpdate.count({ where: { nonMotorClaimId: entry.nonMotorClaimId, deletedAt: null } });
  if (visibleCount <= 1) return { success: false, error: "MIN_TIMELINE_REQUIRED" };

  try {
    const participantIds = await prisma.$transaction(async (tx) => {
      const result = await tx.nonMotorClaimUpdate.updateMany({
        where: { id: updateId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: access.userId },
      });
      if (result.count === 0) return [];
      await touchNonMotorClaim(tx, entry.nonMotorClaimId);
      await touchOwnNonMotorClaimReadState(tx, entry.nonMotorClaimId, access.userId);
      const participants = await tx.nonMotorClaimParticipant.findMany({ where: { nonMotorClaimId: entry.nonMotorClaimId }, select: { userId: true } });
      return participants.map((p) => p.userId);
    });
    revalidatePath("/task/non-motor-claim");
    publishTaskActivityAfterMutation({ scope: "NON_MOTOR_CLAIM", entityId: entry.nonMotorClaimId, actorUserId: access.userId, participantUserIds: participantIds });
    return { success: true };
  } catch (err) {
    console.error("Failed to delete Non-Motor Claim update:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

// ============================================================================
// Close / reopen (collaborator) / delete (creator-only)
// ============================================================================

// Collaborator-level, not Creator-only — see the identical Motor Claim
// rationale in src/app/(app)/task/motor-claim/actions.ts.
export async function closeNonMotorClaimAction(id: string): Promise<ActionResult> {
  const access = await checkNonMotorClaimAccess(id);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };

  const { count, participantIds } = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.nonMotorClaim.updateMany({
      where: { id, deletedAt: null, status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date(), closedById: access.userId },
    });
    if (updateResult.count !== 1) return { count: updateResult.count, participantIds: [] as string[] };
    await tx.nonMotorClaimUpdate.create({ data: { nonMotorClaimId: id, content: "Claim closed.", createdById: access.userId } });
    await touchOwnNonMotorClaimReadState(tx, id, access.userId);
    const participants = await tx.nonMotorClaimParticipant.findMany({ where: { nonMotorClaimId: id }, select: { userId: true } });
    return { count: updateResult.count, participantIds: participants.map((p) => p.userId) };
  });
  if (count === 0) return { success: false, error: "CLAIM_NOT_OPEN" };

  revalidatePath("/task/non-motor-claim");
  publishTaskActivityAfterMutation({ scope: "NON_MOTOR_CLAIM", entityId: id, actorUserId: access.userId, participantUserIds: participantIds });
  return { success: true };
}

export async function reopenNonMotorClaimAction(id: string): Promise<ActionResult> {
  const access = await checkNonMotorClaimAccess(id);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };

  const { count, participantIds } = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.nonMotorClaim.updateMany({
      where: { id, deletedAt: null, status: "CLOSED" },
      data: { status: "OPEN", closedAt: null, closedById: null },
    });
    if (updateResult.count !== 1) return { count: updateResult.count, participantIds: [] as string[] };
    await tx.nonMotorClaimUpdate.create({ data: { nonMotorClaimId: id, content: "Claim reopened.", createdById: access.userId } });
    await touchOwnNonMotorClaimReadState(tx, id, access.userId);
    const participants = await tx.nonMotorClaimParticipant.findMany({ where: { nonMotorClaimId: id }, select: { userId: true } });
    return { count: updateResult.count, participantIds: participants.map((p) => p.userId) };
  });
  if (count === 0) return { success: false, error: "CLAIM_NOT_CLOSED" };

  revalidatePath("/task/non-motor-claim");
  publishTaskActivityAfterMutation({ scope: "NON_MOTOR_CLAIM", entityId: id, actorUserId: access.userId, participantUserIds: participantIds });
  return { success: true };
}

// Delete stays Creator/Admin-only — matches Task's deleteTaskAction (Part
// VI).
export async function deleteNonMotorClaimAction(id: string): Promise<ActionResult> {
  const access = await checkNonMotorClaimAccess(id);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.canDelete) return { success: false, error: "FORBIDDEN" };

  const participants = await prisma.nonMotorClaimParticipant.findMany({ where: { nonMotorClaimId: id }, select: { userId: true } });

  const result = await prisma.nonMotorClaim.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: access.userId },
  });
  if (result.count === 0) return { success: false, error: "ALREADY_DELETED" };

  revalidatePath("/task/non-motor-claim");
  publishTaskActivityAfterMutation({ scope: "NON_MOTOR_CLAIM", entityId: id, actorUserId: access.userId, participantUserIds: participants.map((p) => p.userId) });
  return { success: true };
}

// ============================================================================
// Phase 8 — real-time row-level unread refresh
// ============================================================================

// See refreshTaskUnreadStatusAction in src/app/(app)/task/actions.ts for the
// full rationale — identical shape, scoped to Non-Motor Claim.
export async function refreshNonMotorClaimUnreadStatusAction(claimIds: string[]): Promise<Record<string, boolean>> {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "claim.non_motor") || claimIds.length === 0) return {};

  const claims = await prisma.nonMotorClaim.findMany({
    where: { id: { in: claimIds }, deletedAt: null, participants: { some: { userId: session.user.id } } },
    select: { id: true, updatedAt: true },
  });
  if (claims.length === 0) return {};

  const unreadIds = await getUnreadNonMotorClaimIds(session.user.id, claims);
  const result: Record<string, boolean> = {};
  for (const c of claims) result[c.id] = unreadIds.has(c.id);
  return result;
}
