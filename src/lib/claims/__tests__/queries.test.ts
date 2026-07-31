import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 8.1 Part 4 — getMotorClaims/getNonMotorClaims gain an optional
// customerId narrowing filter for the "View All Motor/Non-Motor Claims"
// deep-link from Customer Detail. This is THE critical regression to guard:
// Claims are participant-scoped (a user, even an admin, only ever sees a
// Claim they are a `participants` member of) — customerId must always be
// merged into the SAME where clause alongside `participants: { some:
// { userId } }`, never replacing or weakening it. Real behavioral test with
// a mocked prisma client (precedent: src/lib/policy/__tests__/
// deletePolicyRecord.test.ts), not just a source-text assertion, since
// this module is plain server-side logic with no React involved.

const motorFindManyMock = vi.fn();
const nonMotorFindManyMock = vi.fn();
const userFindManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    motorClaim: { findMany: (...args: unknown[]) => motorFindManyMock(...args) },
    nonMotorClaim: { findMany: (...args: unknown[]) => nonMotorFindManyMock(...args) },
    user: { findMany: (...args: unknown[]) => userFindManyMock(...args) },
    customer: { findMany: vi.fn(async () => []) },
  },
}));

type FindManyArgs = { where: Record<string, unknown> };

describe("getMotorClaims / getNonMotorClaims — participant scoping is never bypassed by customerId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    motorFindManyMock.mockResolvedValue([]);
    nonMotorFindManyMock.mockResolvedValue([]);
    userFindManyMock.mockResolvedValue([]);
  });

  it("getMotorClaims: with a customerId, merges it into the same where clause as the participant filter (both present)", async () => {
    const { getMotorClaims } = await import("../queries");
    await getMotorClaims("user-1", "cust-1");

    // Two queries fire (OPEN + CLOSED) — every single one must carry both
    // the participant filter and the customerId filter together.
    expect(motorFindManyMock).toHaveBeenCalledTimes(2);
    for (const call of motorFindManyMock.mock.calls) {
      const { where } = call[0] as FindManyArgs;
      expect(where.deletedAt).toBeNull();
      expect(where.participants).toEqual({ some: { userId: "user-1" } });
      expect(where.customerId).toBe("cust-1");
    }
  });

  it("getMotorClaims: without a customerId, the participant filter is still present and customerId is simply absent (not narrowed to everything)", async () => {
    const { getMotorClaims } = await import("../queries");
    await getMotorClaims("user-1");

    expect(motorFindManyMock).toHaveBeenCalledTimes(2);
    for (const call of motorFindManyMock.mock.calls) {
      const { where } = call[0] as FindManyArgs;
      expect(where.participants).toEqual({ some: { userId: "user-1" } });
      expect("customerId" in where).toBe(false);
    }
  });

  it("getNonMotorClaims: with a customerId, merges it into the same where clause as the participant filter (both present)", async () => {
    const { getNonMotorClaims } = await import("../queries");
    await getNonMotorClaims("user-2", "cust-2");

    expect(nonMotorFindManyMock).toHaveBeenCalledTimes(2);
    for (const call of nonMotorFindManyMock.mock.calls) {
      const { where } = call[0] as FindManyArgs;
      expect(where.deletedAt).toBeNull();
      expect(where.participants).toEqual({ some: { userId: "user-2" } });
      expect(where.customerId).toBe("cust-2");
    }
  });

  it("getNonMotorClaims: without a customerId, the participant filter is still present and customerId is simply absent", async () => {
    const { getNonMotorClaims } = await import("../queries");
    await getNonMotorClaims("user-2");

    expect(nonMotorFindManyMock).toHaveBeenCalledTimes(2);
    for (const call of nonMotorFindManyMock.mock.calls) {
      const { where } = call[0] as FindManyArgs;
      expect(where.participants).toEqual({ some: { userId: "user-2" } });
      expect("customerId" in where).toBe(false);
    }
  });

  it("a customerId for a DIFFERENT user never widens visibility — the participant filter still scopes to the requesting user, not the customer", async () => {
    const { getMotorClaims } = await import("../queries");
    await getMotorClaims("user-3", "some-other-customer");

    for (const call of motorFindManyMock.mock.calls) {
      const { where } = call[0] as FindManyArgs;
      // The participant filter is keyed to the requesting user, and
      // customerId is additive — it can only narrow further, never replace
      // the participants clause with something customer-scoped instead.
      expect(where.participants).toEqual({ some: { userId: "user-3" } });
    }
  });
});
