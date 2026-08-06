import type { Prisma } from "@/generated/prisma/client";

// Production Readiness Audit V1, finding H6. See prisma/schema.prisma's
// IdempotencyClaim model comment for the full design rationale (client-
// generated key, server-side atomic claim via a unique constraint — no
// content-based fingerprinting, so two legitimately separate submissions
// are never confused with each other).
export type IdempotencyScope = "policy.customerReceipt" | "policy.providerPayment" | "ledger.manualEntry";

export type ClaimResult =
  | { kind: "claimed" }
  | { kind: "replay"; resourceId: string };

function isUniqueConstraintViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002";
}

// Must be called from inside the SAME transaction that creates the business
// record: if that transaction later fails and rolls back, the claim row
// (inserted here) rolls back with it, so a genuinely failed attempt never
// leaves a permanently "stuck" key — a legitimate retry with the same key
// succeeds normally. The atomicity guarantee under concurrency comes
// entirely from IdempotencyClaim.key's unique index: two transactions
// racing to claim the same key will have one of them block on the
// conflicting insert until the other commits or rolls back, then either see
// "replay" (first committed) or "claimed" (first rolled back) — never both
// "claimed".
export async function claimIdempotencyKey(
  tx: Prisma.TransactionClient,
  scope: IdempotencyScope,
  key: string
): Promise<ClaimResult> {
  try {
    await tx.idempotencyClaim.create({ data: { key, scope, resourceId: "" } });
    return { kind: "claimed" };
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      const existing = await tx.idempotencyClaim.findUnique({ where: { key } });
      // A claim exists but was never fulfilled (resourceId still ""): the
      // transaction that created it is either still in flight (shouldn't be
      // reachable here — that insert would have blocked us, not raced past
      // us) or, more realistically, this is a stale/aborted row from before
      // Prisma's transaction guarantees applied. Either way, treat it as
      // "not yet usable for replay" and surface the original error rather
      // than fabricating a resourceId that doesn't correspond to any record.
      if (existing?.resourceId) {
        return { kind: "replay", resourceId: existing.resourceId };
      }
    }
    throw err;
  }
}

export async function fulfillIdempotencyClaim(tx: Prisma.TransactionClient, key: string, resourceId: string): Promise<void> {
  await tx.idempotencyClaim.update({ where: { key }, data: { resourceId } });
}
