import { describe, it, expect, vi, beforeEach } from "vitest";

// Non-Motor Claim User-Level Unread Indicator — mirrors
// src/app/(app)/task/motor-claim/__tests__/unreadIndicator.test.ts exactly.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

const checkNonMotorClaimAccess = vi.fn();
vi.mock("@/lib/claims/access", () => ({
  checkNonMotorClaimAccess: (...args: unknown[]) => checkNonMotorClaimAccess(...args),
}));

type FakeClaim = { id: string; status: "OPEN" | "CLOSED"; createdById: string; updatedAt: Date; deletedAt: Date | null };
type FakeReadState = { nonMotorClaimId: string; userId: string; lastViewedAt: Date };

const BASE_MS = Date.UTC(2026, 0, 1);
let clock = 0;
function tick(): Date {
  clock += 1;
  return new Date(BASE_MS + clock);
}

let claims: Map<string, FakeClaim>;
let readStates: Map<string, FakeReadState>;
let updates: Map<string, { id: string; nonMotorClaimId: string; content: string; isInitial: boolean; deletedAt: Date | null }>;
let participants: Map<string, { nonMotorClaimId: string; userId: string }>;
let users: Map<string, { id: string; status: string }>;
let updateCounter: number;

function rsKey(claimId: string, userId: string) {
  return `${claimId}:${userId}`;
}

function createPrismaDouble() {
  const double = {
    nonMotorClaim: {
      findMany: async ({ where, select }: { where: { id: { in: string[] } }; select?: { updatedAt?: boolean } }) =>
        [...claims.values()]
          .filter((c) => where.id.in.includes(c.id))
          .map((c) => (select?.updatedAt ? { id: c.id, updatedAt: c.updatedAt } : { id: c.id })),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const c = claims.get(where.id);
        if (!c) throw new Error("claim not found");
        Object.assign(c, data);
        c.updatedAt = tick();
        return c;
      },
      updateMany: async ({ where, data }: { where: { id: string; status?: string; deletedAt?: null }; data: Record<string, unknown> }) => {
        const c = claims.get(where.id);
        if (!c || (where.status && c.status !== where.status)) return { count: 0 };
        Object.assign(c, data);
        c.updatedAt = tick();
        return { count: 1 };
      },
    },
    nonMotorClaimUpdate: {
      create: async ({ data }: { data: { nonMotorClaimId: string; content: string; createdById: string; isInitial?: boolean } }) => {
        const id = `update-${++updateCounter}`;
        const row = { id, nonMotorClaimId: data.nonMotorClaimId, content: data.content, isInitial: data.isInitial ?? false, deletedAt: null as Date | null };
        updates.set(id, row);
        return row;
      },
    },
    nonMotorClaimParticipant: {
      findMany: async ({ where }: { where: { nonMotorClaimId: string } }) =>
        [...participants.values()].filter((p) => p.nonMotorClaimId === where.nonMotorClaimId).map((p) => ({ userId: p.userId })),
      createMany: async ({ data }: { data: { nonMotorClaimId: string; userId: string }[] }) => {
        for (const d of data) participants.set(rsKey(d.nonMotorClaimId, d.userId), d);
        return { count: data.length };
      },
      deleteMany: async ({ where }: { where: { nonMotorClaimId: string; userId: { in: string[] } } }) => {
        let count = 0;
        for (const uid of where.userId.in) if (participants.delete(rsKey(where.nonMotorClaimId, uid))) count++;
        return { count };
      },
    },
    nonMotorClaimReadState: {
      findFirst: async ({ where }: { where: { userId: string } }) => [...readStates.values()].find((r) => r.userId === where.userId) ?? null,
      findMany: async ({ where }: { where: { userId: string; nonMotorClaimId: { in: string[] } } }) =>
        [...readStates.values()].filter((r) => r.userId === where.userId && where.nonMotorClaimId.in.includes(r.nonMotorClaimId)),
      createMany: async ({ data }: { data: FakeReadState[] }) => {
        let count = 0;
        for (const d of data) {
          const k = rsKey(d.nonMotorClaimId, d.userId);
          if (!readStates.has(k)) {
            readStates.set(k, { ...d });
            count++;
          }
        }
        return { count };
      },
      upsert: async ({ where }: { where: { nonMotorClaimId_userId: { nonMotorClaimId: string; userId: string } } }) => {
        const { nonMotorClaimId, userId } = where.nonMotorClaimId_userId;
        const row: FakeReadState = { nonMotorClaimId, userId, lastViewedAt: tick() };
        readStates.set(rsKey(nonMotorClaimId, userId), row);
        return row;
      },
    },
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] }; status: string } }) =>
        [...users.values()].filter((u) => where.id.in.includes(u.id) && u.status === where.status),
    },
  };
  return Object.assign(double, { $transaction: async (cb: (tx: unknown) => unknown) => cb(double) });
}

vi.mock("@/lib/prisma", () => ({ prisma: createPrismaDouble() }));

function okAccess(overrides: Partial<{ isCreator: boolean; isAdmin: boolean; canEdit: boolean; canDelete: boolean; userId: string }> = {}) {
  return {
    kind: "ok" as const,
    userId: overrides.userId ?? "participant-1",
    claimId: "claim-1",
    createdById: "creator-1",
    status: "OPEN" as const,
    isCreator: overrides.isCreator ?? false,
    isParticipant: true,
    isAdmin: overrides.isAdmin ?? false,
    moduleCanEdit: overrides.canEdit ?? true,
    canEdit: overrides.canEdit ?? true,
    canDelete: overrides.canDelete ?? false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  claims = new Map();
  readStates = new Map();
  updates = new Map();
  participants = new Map();
  users = new Map();
  updateCounter = 0;
  clock = 0;

  claims.set("claim-1", { id: "claim-1", status: "OPEN", createdById: "creator-1", updatedAt: tick(), deletedAt: null });
  participants.set(rsKey("claim-1", "creator-1"), { nonMotorClaimId: "claim-1", userId: "creator-1" });
  participants.set(rsKey("claim-1", "user-a"), { nonMotorClaimId: "claim-1", userId: "user-a" });
  participants.set(rsKey("claim-1", "user-b"), { nonMotorClaimId: "claim-1", userId: "user-b" });
  users.set("helper-1", { id: "helper-1", status: "ACTIVE" });
});

describe("Case 18: Non-Motor Claim update -> other participants unread, actor stays read", () => {
  it("addNonMotorClaimUpdateAction makes every other caught-up participant unread, never the actor", async () => {
    const { markNonMotorClaimViewed, getUnreadNonMotorClaimIds } = await import("@/lib/claims/readState");
    const { addNonMotorClaimUpdateAction } = await import("../actions");

    await markNonMotorClaimViewed("user-a", "claim-1");
    await markNonMotorClaimViewed("user-b", "claim-1");

    checkNonMotorClaimAccess.mockResolvedValue(okAccess({ userId: "user-b" }));
    const result = await addNonMotorClaimUpdateAction("claim-1", "Loss assessment scheduled.");
    expect(result.success).toBe(true);

    const claim = claims.get("claim-1")!;
    expect((await getUnreadNonMotorClaimIds("user-a", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(true);
    expect((await getUnreadNonMotorClaimIds("user-b", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(false);
  });

  it("closeNonMotorClaimAction / reopenNonMotorClaimAction each independently produce unread for other participants", async () => {
    const { markNonMotorClaimViewed, getUnreadNonMotorClaimIds } = await import("@/lib/claims/readState");
    const { closeNonMotorClaimAction, reopenNonMotorClaimAction } = await import("../actions");

    await markNonMotorClaimViewed("user-a", "claim-1");
    await markNonMotorClaimViewed("user-b", "claim-1");

    checkNonMotorClaimAccess.mockResolvedValue(okAccess({ userId: "user-b" }));
    expect(await closeNonMotorClaimAction("claim-1")).toEqual({ success: true });

    let claim = claims.get("claim-1")!;
    expect((await getUnreadNonMotorClaimIds("user-a", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(true);
    expect((await getUnreadNonMotorClaimIds("user-b", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(false);

    await markNonMotorClaimViewed("user-a", "claim-1");
    expect(await reopenNonMotorClaimAction("claim-1")).toEqual({ success: true });

    claim = claims.get("claim-1")!;
    expect((await getUnreadNonMotorClaimIds("user-a", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(true);
    expect((await getUnreadNonMotorClaimIds("user-b", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(false);
  });

  it("updateNonMotorClaimParticipantsAction: acting participant stays read, other caught-up participants go unread", async () => {
    const { markNonMotorClaimViewed, getUnreadNonMotorClaimIds } = await import("@/lib/claims/readState");
    const { updateNonMotorClaimParticipantsAction } = await import("../actions");

    await markNonMotorClaimViewed("user-a", "claim-1");
    await markNonMotorClaimViewed("user-b", "claim-1");

    checkNonMotorClaimAccess.mockResolvedValue(okAccess({ userId: "user-b" }));
    const result = await updateNonMotorClaimParticipantsAction("claim-1", ["user-a", "user-b", "helper-1"]);
    expect(result).toEqual({ success: true });

    const claim = claims.get("claim-1")!;
    expect((await getUnreadNonMotorClaimIds("user-a", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(true);
    expect((await getUnreadNonMotorClaimIds("user-b", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(false);
  });
});
