import type { Prisma } from "@/generated/prisma/client";
import type { PolicyActivityActionType } from "@/generated/prisma/enums";

// Shared, category-agnostic PolicyActivity writer (Phase 1B). Always call
// this from inside the same $transaction as the business change it
// describes, so the log entry and the change it records can never diverge
// (an activity row without a matching change, or vice versa). `details` is
// a plain optional string, not Json — this codebase never uses Json columns
// (see PolicyActivity's schema comment) — so pass an already-formatted
// human-readable line, not a structured object.
export async function recordPolicyActivity(
  tx: Prisma.TransactionClient,
  input: {
    policyRecordId: string;
    actionType: PolicyActivityActionType;
    summary: string;
    details?: string | null;
    performedById?: string | null;
  }
): Promise<void> {
  await tx.policyActivity.create({
    data: {
      policyRecordId: input.policyRecordId,
      actionType: input.actionType,
      summary: input.summary,
      details: input.details ?? null,
      performedById: input.performedById ?? null,
    },
  });
}

// Phase 1B, Section 10: a Motor policy created before this phase existed has
// no activity history at all. Rather than inventing events with no reliable
// metadata, this backfills exactly one POLICY_CREATED entry — and only when
// the record's own createdAt/createdById can honestly support it — the first
// time that record's Activity tab is ever viewed. Idempotent via
// check-count-then-insert: called on every page load, so it must never
// create a second entry on repeat views (a small unguarded race is
// acceptable here, matching this phase's "idempotent where practical" spec —
// worst case a concurrent double-view creates one extra row, never an
// invented history).
export async function ensurePolicyCreatedActivityBackfilled(
  tx: Prisma.TransactionClient,
  record: {
    id: string;
    createdById: string | null;
    createdAt: Date;
    recordNumber: string;
    source: "MANUAL" | "HISTORICAL_IMPORT";
  }
): Promise<void> {
  if (!record.createdById) return;

  const existingCount = await tx.policyActivity.count({ where: { policyRecordId: record.id } });
  if (existingCount > 0) return;

  const isHistorical = record.source === "HISTORICAL_IMPORT";
  await tx.policyActivity.create({
    data: {
      policyRecordId: record.id,
      actionType: isHistorical ? "HISTORICAL_POLICY_IMPORTED" : "POLICY_CREATED",
      summary: isHistorical
        ? `Motor policy ${record.recordNumber} imported from historical data`
        : `Motor policy ${record.recordNumber} created`,
      performedById: record.createdById,
      createdAt: record.createdAt,
    },
  });
}
