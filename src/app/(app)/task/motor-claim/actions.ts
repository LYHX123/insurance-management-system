"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { checkMotorClaimAccess } from "@/lib/claims/access";
import { generateMotorClaimNumber } from "@/lib/claims/motorClaimNumber";
import { isMotorClaimNature, isMotorClaimProgress, type MotorClaimNatureValue, type MotorClaimProgressValue } from "@/lib/claims/enums";
import { MOTOR_PROGRESS_EN_LABEL } from "@/lib/claims/systemLabels";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

const CONTACT_MAX_LENGTH = 200;
const INSURER_MAX_LENGTH = 200;
const PLATE_MAX_LENGTH = 50;
const CONTENT_MAX_LENGTH = 4000;

async function requireTaskPermission() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "task")) return null;
  return session;
}

function touchMotorClaim(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], claimId: string) {
  // Same "empty update bumps @updatedAt" pattern as touchTask (see
  // src/app/(app)/task/actions.ts) — makes MotorClaim.updatedAt reflect
  // activity that lives in a different table (participants, timeline),
  // which the list ordering depends on (see this phase's spec, Part F.20).
  return tx.motorClaim.update({ where: { id: claimId }, data: {} });
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
      return created;
    });

    revalidatePath("/task/motor-claim");
    return { success: true, id: claim.id, claimNumber: claim.claimNumber };
  } catch (err) {
    console.error("Failed to create Motor Claim:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

// ============================================================================
// Core edit (creator-only, OPEN-only)
// ============================================================================

export async function updateMotorClaimAction(id: string, input: MotorClaimInput): Promise<ActionResult> {
  const access = await checkMotorClaimAccess(id);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.isCreator) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };

  const validated = validateInput(input);
  if (!("ok" in validated)) return { success: false, error: validated.error };

  const customer = await prisma.customer.findUnique({ where: { id: validated.data.customerId }, select: { id: true } });
  if (!customer) return { success: false, error: "CUSTOMER_NOT_FOUND" };

  const projectResult = await validateProjectForCustomer(validated.data.customerId, input.projectId);
  if (!("ok" in projectResult)) return { success: false, error: projectResult.error };

  const existing = await prisma.motorClaim.findUnique({ where: { id }, select: { progress: true } });
  if (!existing) return { success: false, error: "CLAIM_NOT_FOUND" };

  try {
    await prisma.$transaction(async (tx) => {
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
    });
    revalidatePath("/task/motor-claim");
    return { success: true };
  } catch (err) {
    console.error("Failed to update Motor Claim:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

// ============================================================================
// Participants (creator-only, OPEN-only)
// ============================================================================

export async function updateMotorClaimParticipantsAction(claimId: string, participantIds: string[]): Promise<ActionResult> {
  const access = await checkMotorClaimAccess(claimId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.isCreator) return { success: false, error: "FORBIDDEN" };
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
      await touchMotorClaim(tx, claimId);
    });
    revalidatePath("/task/motor-claim");
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
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };

  const trimmed = content?.trim();
  if (!trimmed) return { success: false, error: "CONTENT_REQUIRED" };
  if (trimmed.length > CONTENT_MAX_LENGTH) return { success: false, error: "CONTENT_TOO_LONG" };

  try {
    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.motorClaimUpdate.create({ data: { motorClaimId: claimId, content: trimmed, createdById: access.userId } });
      await touchMotorClaim(tx, claimId);
      return created;
    });
    revalidatePath("/task/motor-claim");
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
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };
  if (entry.createdById !== access.userId && !access.isCreator) return { success: false, error: "FORBIDDEN" };

  const trimmed = content?.trim();
  if (!trimmed) return { success: false, error: "CONTENT_REQUIRED" };
  if (trimmed.length > CONTENT_MAX_LENGTH) return { success: false, error: "CONTENT_TOO_LONG" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.motorClaimUpdate.update({ where: { id: updateId }, data: { content: trimmed, editedAt: new Date() } });
      await touchMotorClaim(tx, entry.motorClaimId);
    });
    revalidatePath("/task/motor-claim");
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
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };
  if (entry.createdById !== access.userId && !access.isCreator) return { success: false, error: "FORBIDDEN" };

  const visibleCount = await prisma.motorClaimUpdate.count({ where: { motorClaimId: entry.motorClaimId, deletedAt: null } });
  if (visibleCount <= 1) return { success: false, error: "MIN_TIMELINE_REQUIRED" };

  try {
    await prisma.$transaction(async (tx) => {
      const result = await tx.motorClaimUpdate.updateMany({
        where: { id: updateId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: access.userId },
      });
      if (result.count > 0) await touchMotorClaim(tx, entry.motorClaimId);
    });
    revalidatePath("/task/motor-claim");
    return { success: true };
  } catch (err) {
    console.error("Failed to delete Motor Claim update:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

// ============================================================================
// Close / reopen / delete (creator-only)
// ============================================================================

// Idempotent by construction; the timeline entry is only appended inside the
// same transaction as a status transition that actually happened (count ===
// 1), so a retry never creates a duplicate entry (see this phase's spec,
// Part H.33).
export async function closeMotorClaimAction(id: string): Promise<ActionResult> {
  const access = await checkMotorClaimAccess(id);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.isCreator) return { success: false, error: "FORBIDDEN" };

  const result = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.motorClaim.updateMany({
      where: { id, deletedAt: null, status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date(), closedById: access.userId },
    });
    if (updateResult.count === 1) {
      await tx.motorClaimUpdate.create({ data: { motorClaimId: id, content: "Claim closed.", createdById: access.userId } });
    }
    return updateResult.count;
  });
  if (result === 0) return { success: false, error: "CLAIM_NOT_OPEN" };

  revalidatePath("/task/motor-claim");
  return { success: true };
}

export async function reopenMotorClaimAction(id: string): Promise<ActionResult> {
  const access = await checkMotorClaimAccess(id);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.isCreator) return { success: false, error: "FORBIDDEN" };

  const result = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.motorClaim.updateMany({
      where: { id, deletedAt: null, status: "CLOSED" },
      data: { status: "OPEN", closedAt: null, closedById: null },
    });
    if (updateResult.count === 1) {
      await tx.motorClaimUpdate.create({ data: { motorClaimId: id, content: "Claim reopened.", createdById: access.userId } });
    }
    return updateResult.count;
  });
  if (result === 0) return { success: false, error: "CLAIM_NOT_CLOSED" };

  revalidatePath("/task/motor-claim");
  return { success: true };
}

export async function deleteMotorClaimAction(id: string): Promise<ActionResult> {
  const access = await checkMotorClaimAccess(id);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.isCreator) return { success: false, error: "FORBIDDEN" };

  const result = await prisma.motorClaim.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: access.userId },
  });
  if (result.count === 0) return { success: false, error: "ALREADY_DELETED" };

  revalidatePath("/task/motor-claim");
  return { success: true };
}
