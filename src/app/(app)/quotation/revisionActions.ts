"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { deepCopyQuotationSections } from "@/lib/quotationRevisions/deepCopy";
import type { Prisma } from "@/generated/prisma/client";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

async function requireQuotationPermission() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "quotation")) {
    return null;
  }
  return session;
}

function revisionCodeFor(n: number): string {
  return `R${String(n).padStart(2, "0")}`;
}

// Locks the QuotationCase row for the duration of the transaction so two
// concurrent "create revision" (or issue/accept/cancel) calls against the
// SAME case can never interleave — the second caller simply waits for the
// first transaction to commit before its own SELECT ... FOR UPDATE
// proceeds. Revisions under DIFFERENT cases are never blocked by each
// other.
async function lockCase(tx: Prisma.TransactionClient, caseId: string): Promise<{ id: string } | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "QuotationCase" WHERE id = ${caseId} FOR UPDATE
  `;
  return rows[0] ?? null;
}

// --- Create Revision --------------------------------------------------

export async function createRevisionAction(
  quotationCaseId: string,
  copyFromRevisionId: string,
  revisionReason: string
): Promise<ActionResult<{ id: string }>> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  if (!revisionReason?.trim()) return { success: false, error: "REVISION_REASON_REQUIRED" };

  const source = await prisma.quotation.findUnique({
    where: { id: copyFromRevisionId },
    select: { id: true, quotationCaseId: true, currency: true, validUntil: true, internalNotes: true, customerId: true, projectId: true, subtotalPremium: true, totalPHCF: true, totalITL: true, totalStampDuty: true, grandTotal: true },
  });
  if (!source || source.quotationCaseId !== quotationCaseId) {
    return { success: false, error: "REVISION_NOT_FOUND" };
  }

  try {
    const { sectionCreates } = await deepCopyQuotationSections(copyFromRevisionId);

    const newRevisionId = await prisma.$transaction(async (tx) => {
      const locked = await lockCase(tx, quotationCaseId);
      if (!locked) throw new Error("CASE_NOT_FOUND");

      const existingDraft = await tx.quotation.findFirst({
        where: { quotationCaseId, revisionStatus: "DRAFT" },
        select: { id: true },
      });
      if (existingDraft) throw new Error("DRAFT_ALREADY_EXISTS");

      const maxRevision = await tx.quotation.aggregate({
        where: { quotationCaseId },
        _max: { revisionNumber: true },
      });
      const nextRevisionNumber = (maxRevision._max.revisionNumber ?? 0) + 1;

      const caseRow = await tx.quotationCase.findUniqueOrThrow({ where: { id: quotationCaseId } });

      const created = await tx.quotation.create({
        data: {
          quotationNumber: caseRow.quotationNumber,
          customerId: source.customerId,
          projectId: source.projectId,
          currency: source.currency,
          validUntil: source.validUntil,
          internalNotes: source.internalNotes,
          status: "DRAFT",
          subtotalPremium: source.subtotalPremium,
          totalPHCF: source.totalPHCF,
          totalITL: source.totalITL,
          totalStampDuty: source.totalStampDuty,
          grandTotal: source.grandTotal,
          createdBy: session.user.id,
          quotationCaseId,
          revisionNumber: nextRevisionNumber,
          revisionCode: revisionCodeFor(nextRevisionNumber),
          revisionReason: revisionReason.trim(),
          revisionStatus: "DRAFT",
          isCurrentRevision: true,
          sections: { create: sectionCreates },
        },
      });

      await tx.quotation.updateMany({
        where: { quotationCaseId, id: { not: created.id } },
        data: { isCurrentRevision: false },
      });

      await tx.quotationCase.update({
        where: { id: quotationCaseId },
        data: { currentRevisionId: created.id, updatedById: session.user.id },
      });

      return created.id;
    });

    revalidatePath("/quotation");
    revalidatePath(`/quotation/case/${quotationCaseId}`);
    return { success: true, id: newRevisionId };
  } catch (err) {
    if (err instanceof Error && err.message === "DRAFT_ALREADY_EXISTS") {
      return { success: false, error: "DRAFT_ALREADY_EXISTS" };
    }
    if (err instanceof Error && err.message === "CASE_NOT_FOUND") {
      return { success: false, error: "CASE_NOT_FOUND" };
    }
    console.error("Failed to create revision:", err);
    return { success: false, error: "REVISION_CREATE_FAILED" };
  }
}

// --- Issue Revision -----------------------------------------------------

export async function issueRevisionAction(revisionId: string): Promise<ActionResult> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  try {
    await prisma.$transaction(async (tx) => {
      const revision = await tx.quotation.findUnique({
        where: { id: revisionId },
        include: { sections: { select: { id: true } } },
      });
      if (!revision || !revision.quotationCaseId) throw new Error("REVISION_NOT_FOUND");
      if (revision.revisionStatus !== "DRAFT") throw new Error("REVISION_NOT_DRAFT");
      if (revision.sections.length === 0) throw new Error("AT_LEAST_ONE_SECTION");

      await lockCase(tx, revision.quotationCaseId);

      const now = new Date();

      // Any other ISSUED revision under this case becomes SUPERSEDED.
      await tx.quotation.updateMany({
        where: { quotationCaseId: revision.quotationCaseId, revisionStatus: "ISSUED", id: { not: revisionId } },
        data: { revisionStatus: "SUPERSEDED", supersededAt: now },
      });

      await tx.quotation.updateMany({
        where: { quotationCaseId: revision.quotationCaseId, id: { not: revisionId } },
        data: { isCurrentRevision: false },
      });

      await tx.quotation.update({
        where: { id: revisionId },
        data: {
          revisionStatus: "ISSUED",
          issuedAt: now,
          issuedById: session.user.id,
          isCurrentRevision: true,
        },
      });

      await tx.quotationCase.update({
        where: { id: revision.quotationCaseId },
        data: { currentRevisionId: revisionId, status: "QUOTED", updatedById: session.user.id },
      });
    });

    revalidatePath("/quotation");
    return { success: true };
  } catch (err) {
    if (err instanceof Error && ["REVISION_NOT_FOUND", "REVISION_NOT_DRAFT", "AT_LEAST_ONE_SECTION"].includes(err.message)) {
      return { success: false, error: err.message };
    }
    console.error("Failed to issue revision:", err);
    return { success: false, error: "ISSUE_FAILED" };
  }
}

// --- Mark Accepted --------------------------------------------------------

export async function acceptRevisionAction(revisionId: string): Promise<ActionResult> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  try {
    await prisma.$transaction(async (tx) => {
      const revision = await tx.quotation.findUnique({ where: { id: revisionId } });
      if (!revision || !revision.quotationCaseId) throw new Error("REVISION_NOT_FOUND");
      if (revision.revisionStatus !== "ISSUED") throw new Error("REVISION_NOT_ISSUED");

      await lockCase(tx, revision.quotationCaseId);

      const alreadyAccepted = await tx.quotation.findFirst({
        where: { quotationCaseId: revision.quotationCaseId, revisionStatus: "ACCEPTED" },
        select: { id: true },
      });
      if (alreadyAccepted) throw new Error("ANOTHER_REVISION_ALREADY_ACCEPTED");

      const now = new Date();

      await tx.quotation.update({
        where: { id: revisionId },
        data: { revisionStatus: "ACCEPTED", acceptedAt: now, acceptedById: session.user.id },
      });

      await tx.quotationCase.update({
        where: { id: revision.quotationCaseId },
        data: {
          acceptedRevisionId: revisionId,
          currentRevisionId: revisionId,
          status: "ACCEPTED",
          updatedById: session.user.id,
        },
      });
    });

    revalidatePath("/quotation");
    return { success: true };
  } catch (err) {
    if (
      err instanceof Error &&
      ["REVISION_NOT_FOUND", "REVISION_NOT_ISSUED", "ANOTHER_REVISION_ALREADY_ACCEPTED"].includes(err.message)
    ) {
      return { success: false, error: err.message };
    }
    console.error("Failed to accept revision:", err);
    return { success: false, error: "ACCEPT_FAILED" };
  }
}

// --- Cancel Revision --------------------------------------------------------

export async function cancelRevisionAction(revisionId: string, cancellationReason: string): Promise<ActionResult> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };
  if (!cancellationReason?.trim()) return { success: false, error: "CANCELLATION_REASON_REQUIRED" };

  try {
    await prisma.$transaction(async (tx) => {
      const revision = await tx.quotation.findUnique({ where: { id: revisionId } });
      if (!revision || !revision.quotationCaseId) throw new Error("REVISION_NOT_FOUND");
      if (revision.revisionStatus !== "DRAFT" && revision.revisionStatus !== "ISSUED") {
        throw new Error("REVISION_NOT_CANCELLABLE");
      }

      await lockCase(tx, revision.quotationCaseId);

      const now = new Date();
      await tx.quotation.update({
        where: { id: revisionId },
        data: {
          revisionStatus: "CANCELLED",
          cancelledAt: now,
          cancelledById: session.user.id,
          cancellationReason: cancellationReason.trim(),
          isCurrentRevision: false,
        },
      });

      if (revision.isCurrentRevision) {
        // Pick the latest non-cancelled revision as the new current one, if
        // any survives; otherwise the case is left with no current
        // revision (a clear, honest state — never silently pick a
        // cancelled row as "current").
        const replacement = await tx.quotation.findFirst({
          where: { quotationCaseId: revision.quotationCaseId, id: { not: revisionId }, revisionStatus: { not: "CANCELLED" } },
          orderBy: { revisionNumber: "desc" },
        });

        if (replacement) {
          await tx.quotation.update({ where: { id: replacement.id }, data: { isCurrentRevision: true } });
        }

        await tx.quotationCase.update({
          where: { id: revision.quotationCaseId },
          data: { currentRevisionId: replacement?.id ?? null, updatedById: session.user.id },
        });
      }
    });

    revalidatePath("/quotation");
    return { success: true };
  } catch (err) {
    if (err instanceof Error && ["REVISION_NOT_FOUND", "REVISION_NOT_CANCELLABLE"].includes(err.message)) {
      return { success: false, error: err.message };
    }
    console.error("Failed to cancel revision:", err);
    return { success: false, error: "CANCEL_FAILED" };
  }
}

// --- Compare Revisions --------------------------------------------------

export type RevisionCompareSide = {
  id: string;
  revisionCode: string;
  createdAt: string;
  createdByName: string;
  revisionReason: string | null;
  grandTotal: string;
  sections: { insuranceType: string; basePremium: string; sectionTotal: string }[];
};

export type RevisionCompareResult = {
  a: RevisionCompareSide;
  b: RevisionCompareSide;
  byType: { insuranceType: string; aGross: string | null; aTotal: string | null; bGross: string | null; bTotal: string | null }[];
  addedTypes: string[];
  removedTypes: string[];
  grandTotalDifference: string;
};

export async function compareRevisionsAction(
  revisionIdA: string,
  revisionIdB: string
): Promise<ActionResult<{ result: RevisionCompareResult }>> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const [revA, revB] = await Promise.all([
    prisma.quotation.findUnique({ where: { id: revisionIdA }, include: { sections: true } }),
    prisma.quotation.findUnique({ where: { id: revisionIdB }, include: { sections: true } }),
  ]);
  if (!revA || !revB) return { success: false, error: "REVISION_NOT_FOUND" };
  if (revA.quotationCaseId !== revB.quotationCaseId) return { success: false, error: "DIFFERENT_CASES" };

  const creators = await prisma.user.findMany({
    where: { id: { in: [revA.createdBy, revB.createdBy] } },
    select: { id: true, fullName: true, username: true },
  });
  const creatorName = (id: string) => {
    const u = creators.find((c) => c.id === id);
    return u ? u.fullName || u.username : "—";
  };

  const toSide = (rev: typeof revA): RevisionCompareSide => ({
    id: rev.id,
    revisionCode: rev.revisionCode ?? "R01",
    createdAt: rev.createdAt.toISOString(),
    createdByName: creatorName(rev.createdBy),
    revisionReason: rev.revisionReason,
    grandTotal: rev.grandTotal.toString(),
    sections: rev.sections.map((s) => ({
      insuranceType: s.insuranceTypeNameSnapshot,
      basePremium: s.basePremium.toString(),
      sectionTotal: s.sectionTotal.toString(),
    })),
  });

  const a = toSide(revA);
  const b = toSide(revB);

  const typesA = new Set(a.sections.map((s) => s.insuranceType));
  const typesB = new Set(b.sections.map((s) => s.insuranceType));
  const allTypes = Array.from(new Set([...typesA, ...typesB]));

  const byType = allTypes.map((insuranceType) => {
    const sa = a.sections.find((s) => s.insuranceType === insuranceType);
    const sb = b.sections.find((s) => s.insuranceType === insuranceType);
    return {
      insuranceType,
      aGross: sa?.basePremium ?? null,
      aTotal: sa?.sectionTotal ?? null,
      bGross: sb?.basePremium ?? null,
      bTotal: sb?.sectionTotal ?? null,
    };
  });

  const addedTypes = allTypes.filter((t) => !typesA.has(t) && typesB.has(t));
  const removedTypes = allTypes.filter((t) => typesA.has(t) && !typesB.has(t));
  const grandTotalDifference = (Number(b.grandTotal) - Number(a.grandTotal)).toFixed(2);

  return { success: true, result: { a, b, byType, addedTypes, removedTypes, grandTotalDifference } };
}

// --- Delete Draft Revision --------------------------------------------------

// Physically deletes a DRAFT revision. If it is the only revision under its
// case, the whole case is deleted too (deleting QuotationCase cascades to
// its sole Quotation, same net effect as the pre-Phase-1
// deleteQuotationAction). Phase 2A added PolicyRecord.sourceQuotationId, so a
// revision with at least one linked policy can never be deleted — blocked
// here with a friendly error rather than relying on the FK's onDelete:
// SetNull (which would silently orphan the policy's quotation reference).
export async function deleteDraftRevisionAction(revisionId: string): Promise<ActionResult> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  try {
    await prisma.$transaction(async (tx) => {
      const revision = await tx.quotation.findUnique({ where: { id: revisionId } });
      if (!revision || !revision.quotationCaseId) throw new Error("REVISION_NOT_FOUND");
      if (revision.revisionStatus !== "DRAFT") throw new Error("ONLY_DRAFT_DELETABLE");

      const linkedPolicyCount = await tx.policyRecord.count({
        where: { sourceQuotationId: revisionId, deletedAt: null },
      });
      if (linkedPolicyCount > 0) throw new Error("REVISION_HAS_LINKED_POLICIES");

      await lockCase(tx, revision.quotationCaseId);

      const siblingCount = await tx.quotation.count({ where: { quotationCaseId: revision.quotationCaseId } });

      if (siblingCount <= 1) {
        await tx.quotationCase.delete({ where: { id: revision.quotationCaseId } });
        return;
      }

      await tx.quotation.delete({ where: { id: revisionId } });

      if (revision.isCurrentRevision) {
        const replacement = await tx.quotation.findFirst({
          where: { quotationCaseId: revision.quotationCaseId, revisionStatus: { not: "CANCELLED" } },
          orderBy: { revisionNumber: "desc" },
        });
        if (replacement) {
          await tx.quotation.update({ where: { id: replacement.id }, data: { isCurrentRevision: true } });
        }
        await tx.quotationCase.update({
          where: { id: revision.quotationCaseId },
          data: { currentRevisionId: replacement?.id ?? null, updatedById: session.user.id },
        });
      }
    });

    revalidatePath("/quotation");
    return { success: true };
  } catch (err) {
    if (
      err instanceof Error &&
      ["REVISION_NOT_FOUND", "ONLY_DRAFT_DELETABLE", "REVISION_HAS_LINKED_POLICIES"].includes(err.message)
    ) {
      return { success: false, error: err.message };
    }
    console.error("Failed to delete draft revision:", err);
    return { success: false, error: "DELETE_FAILED" };
  }
}
