"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit, hasPermission } from "@/lib/permissions";
import { checkMotorClaimAccess } from "@/lib/claims/access";
import { generateMotorClaimNumber } from "@/lib/claims/motorClaimNumber";
import { isMotorClaimNature, isMotorClaimProgress, type MotorClaimNatureValue, type MotorClaimProgressValue } from "@/lib/claims/enums";
import { MOTOR_PROGRESS_EN_LABEL } from "@/lib/claims/systemLabels";
import { getMotorPolicyLinkOptions, validatePolicyLink } from "@/lib/claims/policyLink";
import { initializeUnreadMotorClaimReadStates, getUnreadMotorClaimIds } from "@/lib/claims/readState";
import { publishTaskActivityAfterMutation } from "@/lib/task/liveNotifications";
import type { ClaimPolicyOption } from "@/components/claims/types";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

const CONTACT_MAX_LENGTH = 200;
const INSURER_MAX_LENGTH = 200;
const PLATE_MAX_LENGTH = 50;
const CONTENT_MAX_LENGTH = 4000;

async function requireTaskPermission() {
  const session = await auth();
  if (!session?.user || !canEdit(session.user, "claim.motor")) return null;
  return session;
}

function touchMotorClaim(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], claimId: string) {
  // Audit finding (2026-08-24): an empty `data: {}` does NOT bump
  // @updatedAt in this Prisma version/adapter — see touchTask's comment in
  // src/app/(app)/task/actions.ts for the empirical confirmation. Passing
  // `updatedAt` explicitly is the fix; still makes MotorClaim.updatedAt
  // reflect activity that lives in a different table (participants,
  // timeline), which the list ordering depends on (see this phase's spec,
  // Part F.20).
  return tx.motorClaim.update({ where: { id: claimId }, data: { updatedAt: new Date() } });
}

// Claim User-Level Unread Indicator, Part B2/B17 — mirrors
// src/app/(app)/task/actions.ts's touchOwnTaskReadState exactly: brings the
// ACTING user's own read state forward to now whenever they cause
// MotorClaim.updatedAt to move, so their own edit never makes their own copy
// of the Claim they're looking at show up as unread.
function touchOwnMotorClaimReadState(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], motorClaimId: string, userId: string) {
  return tx.motorClaimReadState.upsert({
    where: { motorClaimId_userId: { motorClaimId, userId } },
    create: { motorClaimId, userId, lastViewedAt: new Date() },
    update: { lastViewedAt: new Date() },
  });
}

async function validateProjectForCustomer(
  customerId: string,
  projectId: string | null | undefined
): Promise<{ error: string } | { ok: true; projectId: string | null }> {
  if (!projectId) return { ok: true, projectId: null };
  const project = await prisma.customerProject.findUnique({ where: { id: projectId }, select: { customerId: true } });
  // A direct server-action request must never be able to attach another
  // Customer's Project (see this phase's spec, Part B.3) — checked
  // independently of whatever the client displayed.
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
  const result = await validatePolicyLink(policyRecordId, customerId, "MOTOR");
  if (!result.ok) return { error: result.error };
  return { ok: true, policyRecordId };
}

// Customer-scoped Motor Policy candidates for the client-side "Linked
// Policy" selector, re-fetched whenever the Customer field changes inside
// the create/edit modal (never trusted from client state — see Part 2).
export async function getMotorClaimPolicyOptionsAction(customerId: string): Promise<ClaimPolicyOption[]> {
  const session = await requireTaskPermission();
  if (!session || !customerId) return [];
  return getMotorPolicyLinkOptions(customerId);
}

export type MotorClaimInput = {
  reportedAt: string;
  customerId: string;
  projectId?: string | null;
  contactName: string;
  contactPhone: string;
  insurer: string;
  numberPlate: string;
  claimNature: string;
  progress: string;
  policyRecordId?: string | null;
};

type ValidatedMotorClaim = {
  reportedAt: Date;
  customerId: string;
  contactName: string;
  contactPhone: string;
  insurer: string;
  numberPlate: string;
  claimNature: MotorClaimNatureValue;
  progress: MotorClaimProgressValue;
};

function validateInput(input: MotorClaimInput): { error: string } | { ok: true; data: ValidatedMotorClaim } {
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

  const numberPlate = input.numberPlate?.trim();
  if (!numberPlate) return { error: "NUMBER_PLATE_REQUIRED" };
  if (numberPlate.length > PLATE_MAX_LENGTH) return { error: "NUMBER_PLATE_TOO_LONG" };

  if (!isMotorClaimNature(input.claimNature)) return { error: "CLAIM_NATURE_INVALID" };
  if (!isMotorClaimProgress(input.progress)) return { error: "PROGRESS_INVALID" };

  return {
    ok: true,
    data: { reportedAt, customerId: input.customerId, contactName, contactPhone, insurer, numberPlate, claimNature: input.claimNature, progress: input.progress },
  };
}

// ============================================================================
// Creation
// ============================================================================

export type CreateMotorClaimInput = MotorClaimInput & { participantIds: string[] };

export async function createMotorClaimAction(
  input: CreateMotorClaimInput
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

  // Never trust submitted participant ids: the creator is always forced in,
  // and every other submitted id must resolve to a real, currently-active
  // user (see this phase's spec, Part C.6).
  const submittedIds = new Set((input.participantIds ?? []).filter((id) => id && id !== session.user.id));
  let activeParticipants: { id: string }[] = [];
  if (submittedIds.size > 0) {
    activeParticipants = await prisma.user.findMany({ where: { id: { in: [...submittedIds] }, status: "ACTIVE" }, select: { id: true } });
    if (activeParticipants.length !== submittedIds.size) return { success: false, error: "USER_INACTIVE" };
  }
  const participantUserIds = [session.user.id, ...activeParticipants.map((u) => u.id)];

  try {
    const claim = await prisma.$transaction(async (tx) => {
      const claimNumber = await generateMotorClaimNumber(tx);
      const created = await tx.motorClaim.create({
        data: {
          claimNumber,
          reportedAt: validated.data.reportedAt,
          customerId: validated.data.customerId,
          projectId: projectResult.projectId,
          contactName: validated.data.contactName,
          contactPhone: validated.data.contactPhone,
          insurer: validated.data.insurer,
          numberPlate: validated.data.numberPlate,
          claimNature: validated.data.claimNature,
          progress: validated.data.progress,
          policyRecordId: policyResult.policyRecordId,
          createdById: session.user.id,
        },
      });
      await tx.motorClaimParticipant.createMany({
        data: participantUserIds.map((userId) => ({ motorClaimId: created.id, userId, addedById: session.user.id })),
      });
      await tx.motorClaimUpdate.create({
        data: {
          motorClaimId: created.id,
          content: `Claim created. Initial progress: ${MOTOR_PROGRESS_EN_LABEL[validated.data.progress]}.`,
          isInitial: true,
          createdById: session.user.id,
        },
      });
      await touchOwnMotorClaimReadState(tx, created.id, session.user.id);
      // Same "being added to a new Claim is itself unread" rule as
      // createTaskAction (see src/app/(app)/task/actions.ts and
      // src/lib/claims/readState.ts's initializeUnreadMotorClaimReadStates).
      const otherParticipantIds = participantUserIds.filter((id) => id !== session.user.id);
      if (otherParticipantIds.length > 0) {
        await initializeUnreadMotorClaimReadStates(tx, created.id, created.updatedAt, otherParticipantIds);
      }
      return created;
    });

    revalidatePath("/task/motor-claim");
    publishTaskActivityAfterMutation({ scope: "MOTOR_CLAIM", entityId: claim.id, actorUserId: session.user.id, participantUserIds: participantUserIds });
    return { success: true, id: claim.id, claimNumber: claim.claimNumber };
  } catch (err) {
    console.error("Failed to create Motor Claim:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

// ============================================================================
// Core edit (collaborator, OPEN-only)
// ============================================================================

// Collaborator-level, not Creator-only — this is also how a Claim's
// `progress` field advances through its stages (PREPARE_CLAIM_DOCUMENT →
// ... → FINISH), so a Participant needs this action to actually process the
// Claim they were added to (see this phase's spec, Part VIII). The
// underlying progress state machine itself is unchanged — only who may call
// this action.
export async function updateMotorClaimAction(id: string, input: MotorClaimInput): Promise<ActionResult> {
  const access = await checkMotorClaimAccess(id);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };

  const validated = validateInput(input);
  if (!("ok" in validated)) return { success: false, error: validated.error };

  const customer = await prisma.customer.findUnique({ where: { id: validated.data.customerId }, select: { id: true } });
  if (!customer) return { success: false, error: "CUSTOMER_NOT_FOUND" };

  const projectResult = await validateProjectForCustomer(validated.data.customerId, input.projectId);
  if (!("ok" in projectResult)) return { success: false, error: projectResult.error };

  const existing = await prisma.motorClaim.findUnique({ where: { id }, select: { progress: true, policyRecordId: true } });
  if (!existing) return { success: false, error: "CLAIM_NOT_FOUND" };

  const policyResult = await resolvePolicyRecordId(validated.data.customerId, input.policyRecordId);
  if (!("ok" in policyResult)) return { success: false, error: policyResult.error };

  // Part 10/11 — once a document has already synced to Dropbox under the
  // claim's CURRENT business-folder resolution, changing (or clearing) the
  // linked Policy would silently split future uploads into a different
  // folder while past ones remain under the old path. Block the change
  // rather than allow a divergent folder structure; the fallback business
  // folder / Claim itself are entirely unaffected.
  if (policyResult.policyRecordId !== existing.policyRecordId) {
    const syncedDocumentCount = await prisma.motorClaimDocument.count({
      where: { motorClaimId: id, dropboxSync: { syncStatus: "SYNCED" } },
    });
    if (syncedDocumentCount > 0) return { success: false, error: "CLAIM_POLICY_REASSIGNMENT_BLOCKED" };
  }

  try {
    const participantIds = await prisma.$transaction(async (tx) => {
      await tx.motorClaim.update({
        where: { id },
        data: {
          reportedAt: validated.data.reportedAt,
          customerId: validated.data.customerId,
          projectId: projectResult.projectId,
          contactName: validated.data.contactName,
          contactPhone: validated.data.contactPhone,
          insurer: validated.data.insurer,
          numberPlate: validated.data.numberPlate,
          claimNature: validated.data.claimNature,
          progress: validated.data.progress,
          policyRecordId: policyResult.policyRecordId,
          updatedById: access.userId,
        },
      });
      // A system timeline entry only when Progress actually changed — never
      // for a no-op re-save of the same value (see this phase's spec, Part
      // H.32).
      if (existing.progress !== validated.data.progress) {
        await tx.motorClaimUpdate.create({
          data: {
            motorClaimId: id,
            content: `Progress changed from ${MOTOR_PROGRESS_EN_LABEL[existing.progress]} to ${MOTOR_PROGRESS_EN_LABEL[validated.data.progress]}.`,
            createdById: access.userId,
          },
        });
      }
      await touchOwnMotorClaimReadState(tx, id, access.userId);
      const participants = await tx.motorClaimParticipant.findMany({ where: { motorClaimId: id }, select: { userId: true } });
      return participants.map((p) => p.userId);
    });
    revalidatePath("/task/motor-claim");
    publishTaskActivityAfterMutation({ scope: "MOTOR_CLAIM", entityId: id, actorUserId: access.userId, participantUserIds: participantIds });
    return { success: true };
  } catch (err) {
    console.error("Failed to update Motor Claim:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

// ============================================================================
// Participants (collaborator, OPEN-only)
// ============================================================================

// Collaborator-level, not Creator-only — mirrors Task's
// updateParticipantsAction (see src/app/(app)/task/actions.ts): any
// Participant may add or remove others. The Creator can never be removed by
// anyone (enforced below), matching Claim visibility being scoped to
// `participants: { some: { userId } }` in checkMotorClaimAccess.
export async function updateMotorClaimParticipantsAction(claimId: string, participantIds: string[]): Promise<ActionResult> {
  const access = await checkMotorClaimAccess(claimId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };

  const current = await prisma.motorClaimParticipant.findMany({ where: { motorClaimId: claimId }, select: { userId: true } });
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
      if (toRemove.length > 0) await tx.motorClaimParticipant.deleteMany({ where: { motorClaimId: claimId, userId: { in: toRemove } } });
      if (toAdd.length > 0) {
        await tx.motorClaimParticipant.createMany({ data: toAdd.map((userId) => ({ motorClaimId: claimId, userId, addedById: access.userId })) });
      }
      await tx.motorClaimUpdate.create({ data: { motorClaimId: claimId, content: "Participants updated.", createdById: access.userId } });
      const touchedClaim = await touchMotorClaim(tx, claimId);
      await touchOwnMotorClaimReadState(tx, claimId, access.userId);
      if (toAdd.length > 0) {
        await initializeUnreadMotorClaimReadStates(tx, claimId, touchedClaim.updatedAt, toAdd);
      }
    });
    revalidatePath("/task/motor-claim");
    publishTaskActivityAfterMutation({ scope: "MOTOR_CLAIM", entityId: claimId, actorUserId: access.userId, participantUserIds: [...desiredIds] });
    return { success: true };
  } catch (err) {
    console.error("Failed to update Motor Claim participants:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

// ============================================================================
// Timeline
// ============================================================================

export async function addMotorClaimUpdateAction(claimId: string, content: string): Promise<ActionResult<{ id: string }>> {
  const access = await checkMotorClaimAccess(claimId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };

  const trimmed = content?.trim();
  if (!trimmed) return { success: false, error: "CONTENT_REQUIRED" };
  if (trimmed.length > CONTENT_MAX_LENGTH) return { success: false, error: "CONTENT_TOO_LONG" };

  try {
    const { entry, participantIds } = await prisma.$transaction(async (tx) => {
      const created = await tx.motorClaimUpdate.create({ data: { motorClaimId: claimId, content: trimmed, createdById: access.userId } });
      await touchMotorClaim(tx, claimId);
      await touchOwnMotorClaimReadState(tx, claimId, access.userId);
      const participants = await tx.motorClaimParticipant.findMany({ where: { motorClaimId: claimId }, select: { userId: true } });
      return { entry: created, participantIds: participants.map((p) => p.userId) };
    });
    revalidatePath("/task/motor-claim");
    publishTaskActivityAfterMutation({ scope: "MOTOR_CLAIM", entityId: claimId, actorUserId: access.userId, participantUserIds: participantIds });
    return { success: true, id: entry.id };
  } catch (err) {
    console.error("Failed to add Motor Claim update:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

export async function editMotorClaimUpdateAction(updateId: string, content: string): Promise<ActionResult> {
  const entry = await prisma.motorClaimUpdate.findUnique({
    where: { id: updateId },
    select: { motorClaimId: true, createdById: true, deletedAt: true, isInitial: true },
  });
  if (!entry || entry.deletedAt) return { success: false, error: "UPDATE_NOT_FOUND" };
  if (entry.isInitial) return { success: false, error: "FORBIDDEN" };

  const access = await checkMotorClaimAccess(entry.motorClaimId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };
  if (entry.createdById !== access.userId && !access.isCreator && !access.isAdmin) return { success: false, error: "FORBIDDEN" };

  const trimmed = content?.trim();
  if (!trimmed) return { success: false, error: "CONTENT_REQUIRED" };
  if (trimmed.length > CONTENT_MAX_LENGTH) return { success: false, error: "CONTENT_TOO_LONG" };

  try {
    const participantIds = await prisma.$transaction(async (tx) => {
      await tx.motorClaimUpdate.update({ where: { id: updateId }, data: { content: trimmed, editedAt: new Date() } });
      await touchMotorClaim(tx, entry.motorClaimId);
      await touchOwnMotorClaimReadState(tx, entry.motorClaimId, access.userId);
      const participants = await tx.motorClaimParticipant.findMany({ where: { motorClaimId: entry.motorClaimId }, select: { userId: true } });
      return participants.map((p) => p.userId);
    });
    revalidatePath("/task/motor-claim");
    publishTaskActivityAfterMutation({ scope: "MOTOR_CLAIM", entityId: entry.motorClaimId, actorUserId: access.userId, participantUserIds: participantIds });
    return { success: true };
  } catch (err) {
    console.error("Failed to edit Motor Claim update:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

export async function deleteMotorClaimUpdateAction(updateId: string): Promise<ActionResult> {
  const entry = await prisma.motorClaimUpdate.findUnique({
    where: { id: updateId },
    select: { motorClaimId: true, createdById: true, deletedAt: true, isInitial: true },
  });
  if (!entry || entry.deletedAt) return { success: false, error: "UPDATE_NOT_FOUND" };
  if (entry.isInitial) return { success: false, error: "FORBIDDEN" };

  const access = await checkMotorClaimAccess(entry.motorClaimId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };
  if (entry.createdById !== access.userId && !access.isCreator && !access.isAdmin) return { success: false, error: "FORBIDDEN" };

  const visibleCount = await prisma.motorClaimUpdate.count({ where: { motorClaimId: entry.motorClaimId, deletedAt: null } });
  if (visibleCount <= 1) return { success: false, error: "MIN_TIMELINE_REQUIRED" };

  try {
    const participantIds = await prisma.$transaction(async (tx) => {
      const result = await tx.motorClaimUpdate.updateMany({
        where: { id: updateId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: access.userId },
      });
      if (result.count === 0) return [];
      await touchMotorClaim(tx, entry.motorClaimId);
      await touchOwnMotorClaimReadState(tx, entry.motorClaimId, access.userId);
      const participants = await tx.motorClaimParticipant.findMany({ where: { motorClaimId: entry.motorClaimId }, select: { userId: true } });
      return participants.map((p) => p.userId);
    });
    revalidatePath("/task/motor-claim");
    publishTaskActivityAfterMutation({ scope: "MOTOR_CLAIM", entityId: entry.motorClaimId, actorUserId: access.userId, participantUserIds: participantIds });
    return { success: true };
  } catch (err) {
    console.error("Failed to delete Motor Claim update:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

// ============================================================================
// Close / reopen (collaborator) / delete (creator-only)
// ============================================================================

// Idempotent by construction; the timeline entry is only appended inside the
// same transaction as a status transition that actually happened (count ===
// 1), so a retry never creates a duplicate entry (see this phase's spec,
// Part H.33). Collaborator-level, not Creator-only — closing/finishing a
// Claim is part of "advancing the Claim through its existing flow" that any
// Participant must be able to do (see this phase's spec, Part VIII).
export async function closeMotorClaimAction(id: string): Promise<ActionResult> {
  const access = await checkMotorClaimAccess(id);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };

  const { count, participantIds } = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.motorClaim.updateMany({
      where: { id, deletedAt: null, status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date(), closedById: access.userId },
    });
    if (updateResult.count !== 1) return { count: updateResult.count, participantIds: [] as string[] };
    await tx.motorClaimUpdate.create({ data: { motorClaimId: id, content: "Claim closed.", createdById: access.userId } });
    await touchOwnMotorClaimReadState(tx, id, access.userId);
    const participants = await tx.motorClaimParticipant.findMany({ where: { motorClaimId: id }, select: { userId: true } });
    return { count: updateResult.count, participantIds: participants.map((p) => p.userId) };
  });
  if (count === 0) return { success: false, error: "CLAIM_NOT_OPEN" };

  revalidatePath("/task/motor-claim");
  publishTaskActivityAfterMutation({ scope: "MOTOR_CLAIM", entityId: id, actorUserId: access.userId, participantUserIds: participantIds });
  return { success: true };
}

export async function reopenMotorClaimAction(id: string): Promise<ActionResult> {
  const access = await checkMotorClaimAccess(id);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.canEdit) return { success: false, error: "FORBIDDEN" };

  const { count, participantIds } = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.motorClaim.updateMany({
      where: { id, deletedAt: null, status: "CLOSED" },
      data: { status: "OPEN", closedAt: null, closedById: null },
    });
    if (updateResult.count !== 1) return { count: updateResult.count, participantIds: [] as string[] };
    await tx.motorClaimUpdate.create({ data: { motorClaimId: id, content: "Claim reopened.", createdById: access.userId } });
    await touchOwnMotorClaimReadState(tx, id, access.userId);
    const participants = await tx.motorClaimParticipant.findMany({ where: { motorClaimId: id }, select: { userId: true } });
    return { count: updateResult.count, participantIds: participants.map((p) => p.userId) };
  });
  if (count === 0) return { success: false, error: "CLAIM_NOT_CLOSED" };

  revalidatePath("/task/motor-claim");
  publishTaskActivityAfterMutation({ scope: "MOTOR_CLAIM", entityId: id, actorUserId: access.userId, participantUserIds: participantIds });
  return { success: true };
}

// Delete stays Creator/Admin-only — matches Task's deleteTaskAction (Part
// VI): a collaborator can fully process a Claim, but not permanently remove
// the business record.
export async function deleteMotorClaimAction(id: string): Promise<ActionResult> {
  const access = await checkMotorClaimAccess(id);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.canDelete) return { success: false, error: "FORBIDDEN" };

  const participants = await prisma.motorClaimParticipant.findMany({ where: { motorClaimId: id }, select: { userId: true } });

  const result = await prisma.motorClaim.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: access.userId },
  });
  if (result.count === 0) return { success: false, error: "ALREADY_DELETED" };

  revalidatePath("/task/motor-claim");
  publishTaskActivityAfterMutation({ scope: "MOTOR_CLAIM", entityId: id, actorUserId: access.userId, participantUserIds: participants.map((p) => p.userId) });
  return { success: true };
}

// ============================================================================
// Phase 8 — real-time row-level unread refresh
// ============================================================================

// See refreshTaskUnreadStatusAction in src/app/(app)/task/actions.ts for the
// full rationale — identical shape, scoped to Motor Claim.
export async function refreshMotorClaimUnreadStatusAction(claimIds: string[]): Promise<Record<string, boolean>> {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "claim.motor") || claimIds.length === 0) return {};

  const claims = await prisma.motorClaim.findMany({
    where: { id: { in: claimIds }, deletedAt: null, participants: { some: { userId: session.user.id } } },
    select: { id: true, updatedAt: true },
  });
  if (claims.length === 0) return {};

  const unreadIds = await getUnreadMotorClaimIds(session.user.id, claims);
  const result: Record<string, boolean> = {};
  for (const c of claims) result[c.id] = unreadIds.has(c.id);
  return result;
}
