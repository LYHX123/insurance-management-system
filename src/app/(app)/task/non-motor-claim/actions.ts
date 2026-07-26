"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { checkNonMotorClaimAccess } from "@/lib/claims/access";
import { generateNonMotorClaimNumber } from "@/lib/claims/nonMotorClaimNumber";
import { isNonMotorClaimProgress, type NonMotorClaimProgressValue } from "@/lib/claims/enums";
import { isNonMotorCoverType, type NonMotorCoverType } from "@/lib/policy/nonMotorCoverTypes";
import { NON_MOTOR_PROGRESS_EN_LABEL } from "@/lib/claims/systemLabels";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

const CONTACT_MAX_LENGTH = 200;
const INSURER_MAX_LENGTH = 200;
const CONTENT_MAX_LENGTH = 4000;

async function requireTaskPermission() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "task")) return null;
  return session;
}

function touchNonMotorClaim(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], claimId: string) {
  return tx.nonMotorClaim.update({ where: { id: claimId }, data: {} });
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

export type NonMotorClaimInput = {
  reportedAt: string;
  customerId: string;
  projectId?: string | null;
  contactName: string;
  contactPhone: string;
  insurer: string;
  insuranceType: string;
  progress: string;
};

type ValidatedNonMotorClaim = {
  reportedAt: Date;
  customerId: string;
  contactName: string;
  contactPhone: string;
  insurer: string;
  insuranceType: NonMotorCoverType;
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

  return {
    ok: true,
    data: { reportedAt, customerId: input.customerId, contactName, contactPhone, insurer, insuranceType: input.insuranceType, progress: input.progress },
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
          progress: validated.data.progress,
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
      return created;
    });

    revalidatePath("/task/non-motor-claim");
    return { success: true, id: claim.id, claimNumber: claim.claimNumber };
  } catch (err) {
    console.error("Failed to create Non-Motor Claim:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

// ============================================================================
// Core edit (creator-only, OPEN-only)
// ============================================================================

export async function updateNonMotorClaimAction(id: string, input: NonMotorClaimInput): Promise<ActionResult> {
  const access = await checkNonMotorClaimAccess(id);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.isCreator) return { success: false, error: "FORBIDDEN" };
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };

  const validated = validateInput(input);
  if (!("ok" in validated)) return { success: false, error: validated.error };

  const customer = await prisma.customer.findUnique({ where: { id: validated.data.customerId }, select: { id: true } });
  if (!customer) return { success: false, error: "CUSTOMER_NOT_FOUND" };

  const projectResult = await validateProjectForCustomer(validated.data.customerId, input.projectId);
  if (!("ok" in projectResult)) return { success: false, error: projectResult.error };

  const existing = await prisma.nonMotorClaim.findUnique({ where: { id }, select: { progress: true } });
  if (!existing) return { success: false, error: "CLAIM_NOT_FOUND" };

  try {
    await prisma.$transaction(async (tx) => {
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
          progress: validated.data.progress,
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
    });
    revalidatePath("/task/non-motor-claim");
    return { success: true };
  } catch (err) {
    console.error("Failed to update Non-Motor Claim:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

// ============================================================================
// Participants (creator-only, OPEN-only)
// ============================================================================

export async function updateNonMotorClaimParticipantsAction(claimId: string, participantIds: string[]): Promise<ActionResult> {
  const access = await checkNonMotorClaimAccess(claimId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.isCreator) return { success: false, error: "FORBIDDEN" };
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
      await touchNonMotorClaim(tx, claimId);
    });
    revalidatePath("/task/non-motor-claim");
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
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };

  const trimmed = content?.trim();
  if (!trimmed) return { success: false, error: "CONTENT_REQUIRED" };
  if (trimmed.length > CONTENT_MAX_LENGTH) return { success: false, error: "CONTENT_TOO_LONG" };

  try {
    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.nonMotorClaimUpdate.create({ data: { nonMotorClaimId: claimId, content: trimmed, createdById: access.userId } });
      await touchNonMotorClaim(tx, claimId);
      return created;
    });
    revalidatePath("/task/non-motor-claim");
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
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };
  if (entry.createdById !== access.userId && !access.isCreator) return { success: false, error: "FORBIDDEN" };

  const trimmed = content?.trim();
  if (!trimmed) return { success: false, error: "CONTENT_REQUIRED" };
  if (trimmed.length > CONTENT_MAX_LENGTH) return { success: false, error: "CONTENT_TOO_LONG" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.nonMotorClaimUpdate.update({ where: { id: updateId }, data: { content: trimmed, editedAt: new Date() } });
      await touchNonMotorClaim(tx, entry.nonMotorClaimId);
    });
    revalidatePath("/task/non-motor-claim");
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
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };
  if (entry.createdById !== access.userId && !access.isCreator) return { success: false, error: "FORBIDDEN" };

  const visibleCount = await prisma.nonMotorClaimUpdate.count({ where: { nonMotorClaimId: entry.nonMotorClaimId, deletedAt: null } });
  if (visibleCount <= 1) return { success: false, error: "MIN_TIMELINE_REQUIRED" };

  try {
    await prisma.$transaction(async (tx) => {
      const result = await tx.nonMotorClaimUpdate.updateMany({
        where: { id: updateId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: access.userId },
      });
      if (result.count > 0) await touchNonMotorClaim(tx, entry.nonMotorClaimId);
    });
    revalidatePath("/task/non-motor-claim");
    return { success: true };
  } catch (err) {
    console.error("Failed to delete Non-Motor Claim update:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

// ============================================================================
// Close / reopen / delete (creator-only)
// ============================================================================

export async function closeNonMotorClaimAction(id: string): Promise<ActionResult> {
  const access = await checkNonMotorClaimAccess(id);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.isCreator) return { success: false, error: "FORBIDDEN" };

  const result = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.nonMotorClaim.updateMany({
      where: { id, deletedAt: null, status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date(), closedById: access.userId },
    });
    if (updateResult.count === 1) {
      await tx.nonMotorClaimUpdate.create({ data: { nonMotorClaimId: id, content: "Claim closed.", createdById: access.userId } });
    }
    return updateResult.count;
  });
  if (result === 0) return { success: false, error: "CLAIM_NOT_OPEN" };

  revalidatePath("/task/non-motor-claim");
  return { success: true };
}

export async function reopenNonMotorClaimAction(id: string): Promise<ActionResult> {
  const access = await checkNonMotorClaimAccess(id);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.isCreator) return { success: false, error: "FORBIDDEN" };

  const result = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.nonMotorClaim.updateMany({
      where: { id, deletedAt: null, status: "CLOSED" },
      data: { status: "OPEN", closedAt: null, closedById: null },
    });
    if (updateResult.count === 1) {
      await tx.nonMotorClaimUpdate.create({ data: { nonMotorClaimId: id, content: "Claim reopened.", createdById: access.userId } });
    }
    return updateResult.count;
  });
  if (result === 0) return { success: false, error: "CLAIM_NOT_CLOSED" };

  revalidatePath("/task/non-motor-claim");
  return { success: true };
}

export async function deleteNonMotorClaimAction(id: string): Promise<ActionResult> {
  const access = await checkNonMotorClaimAccess(id);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (!access.isCreator) return { success: false, error: "FORBIDDEN" };

  const result = await prisma.nonMotorClaim.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), deletedById: access.userId },
  });
  if (result.count === 0) return { success: false, error: "ALREADY_DELETED" };

  revalidatePath("/task/non-motor-claim");
  return { success: true };
}
