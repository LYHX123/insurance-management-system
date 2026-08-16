import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 1+2 "Generate Policy Records", Part 10 — cancelling a revision that
// already produced real PolicyRecords must warn (not silently proceed, and
// not hard-block) on the first, unconfirmed call, then proceed exactly once
// confirmedDespiteLinkedPolicies=true is passed — and must never touch any
// PolicyRecord row either way (no delete, no source-field rewrite).

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "user-1", role: "Staff", status: "ACTIVE", permissions: ["quotation.edit"] } })),
}));

vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return { ...actual, canEdit: () => true };
});

let linkedPolicyCount = 0;
let revisionRow: { id: string; quotationCaseId: string; revisionStatus: string; isCurrentRevision: boolean } | null;
const policyRecordCountMock = vi.fn(async () => linkedPolicyCount);
const quotationUpdateMock = vi.fn(async () => ({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    policyRecord: { count: () => policyRecordCountMock() },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) =>
      cb({
        $queryRaw: vi.fn(async () => (revisionRow ? [{ id: revisionRow.quotationCaseId }] : [])),
        quotation: {
          findUnique: vi.fn(async () => revisionRow),
          update: () => quotationUpdateMock(),
          findFirst: vi.fn(async () => null),
        },
        quotationCase: {
          update: vi.fn(async () => ({})),
        },
      })
    ),
  },
}));

describe("cancelRevisionAction — linked-policy confirmation gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    linkedPolicyCount = 0;
    revisionRow = { id: "rev-1", quotationCaseId: "case-1", revisionStatus: "ISSUED", isCurrentRevision: true };
  });

  it("cancels immediately when the revision has no linked PolicyRecords", async () => {
    linkedPolicyCount = 0;
    const { cancelRevisionAction } = await import("../revisionActions");
    const result = await cancelRevisionAction("rev-1", "Cancelled");
    expect(result).toEqual({ success: true });
    expect(quotationUpdateMock).toHaveBeenCalled();
  });

  it("returns a confirmation-required result (not an error, not a silent cancel) when linked PolicyRecords exist", async () => {
    linkedPolicyCount = 2;
    const { cancelRevisionAction } = await import("../revisionActions");
    const result = await cancelRevisionAction("rev-1", "Cancelled");
    expect(result).toEqual({ success: false, error: "HAS_LINKED_POLICIES_CONFIRM_REQUIRED", linkedPolicyCount: 2 });
    // The transaction (and therefore the actual cancellation) must never
    // run on this first, unconfirmed call.
    expect(quotationUpdateMock).not.toHaveBeenCalled();
  });

  it("proceeds and cancels once confirmedDespiteLinkedPolicies=true is passed, without touching PolicyRecord", async () => {
    linkedPolicyCount = 2;
    const { cancelRevisionAction } = await import("../revisionActions");
    const result = await cancelRevisionAction("rev-1", "Cancelled", true);
    expect(result).toEqual({ success: true });
    expect(quotationUpdateMock).toHaveBeenCalled();
    // No policyRecord.update/delete mock exists on the fake prisma client
    // at all — if cancelRevisionAction ever tried to mutate a PolicyRecord,
    // this call would have thrown instead of resolving successfully.
  });

  it("re-checks the count on every unconfirmed call (never caches a stale count)", async () => {
    linkedPolicyCount = 1;
    const { cancelRevisionAction } = await import("../revisionActions");
    const first = await cancelRevisionAction("rev-1", "Cancelled");
    expect(first).toEqual({ success: false, error: "HAS_LINKED_POLICIES_CONFIRM_REQUIRED", linkedPolicyCount: 1 });

    linkedPolicyCount = 3;
    const second = await cancelRevisionAction("rev-1", "Cancelled");
    expect(second).toEqual({ success: false, error: "HAS_LINKED_POLICIES_CONFIRM_REQUIRED", linkedPolicyCount: 3 });
  });
});
