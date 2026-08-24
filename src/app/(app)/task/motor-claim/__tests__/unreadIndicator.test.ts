import { describe, it, expect, vi, beforeEach } from "vitest";

// Motor Claim User-Level Unread Indicator — mirrors
// src/app/(app)/task/__tests__/unreadIndicator.test.ts exactly (same
// in-memory fake Prisma double technique), scoped to the Motor Claim
// actions (addMotorClaimUpdateAction, closeMotorClaimAction,
// reopenMotorClaimAction, updateMotorClaimParticipantsAction).

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

const checkMotorClaimAccess = vi.fn();
vi.mock("@/lib/claims/access", () => ({
  checkMotorClaimAccess: (...args: unknown[]) => checkMotorClaimAccess(...args),
}));

type FakeClaim = { id: string; status: "OPEN" | "CLOSED"; createdById: string; updatedAt: Date; deletedAt: Date | null };
type FakeReadState = { motorClaimId: string; userId: string; lastViewedAt: Date };

const BASE_MS = Date.UTC(2026, 0, 1);
let clock = 0;
function tick(): Date {
  clock += 1;
  return new Date(BASE_MS + clock);
}

let claims: Map<string, FakeClaim>;
let readStates: Map<string, FakeReadState>;
let updates: Map<string, { id: string; motorClaimId: string; content: string; isInitial: boolean; deletedAt: Date | null }>;
let participants: Map<string, { motorClaimId: string; userId: string }>;
let users: Map<string, { id: string; status: string }>;
let updateCounter: number;

function rsKey(claimId: string, userId: string) {
  return `${claimId}:${userId}`;
}

function createPrismaDouble() {
  const double = {
    motorClaim: {
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
    motorClaimUpdate: {
      create: async ({ data }: { data: { motorClaimId: string; content: string; createdById: string; isInitial?: boolean } }) => {
        const id = `update-${++updateCounter}`;
        const row = { id, motorClaimId: data.motorClaimId, content: data.content, isInitial: data.isInitial ?? false, deletedAt: null as Date | null };
        updates.set(id, row);
        return row;
      },
    },
    motorClaimParticipant: {
      findMany: async ({ where }: { where: { motorClaimId: string } }) =>
        [...participants.values()].filter((p) => p.motorClaimId === where.motorClaimId).map((p) => ({ userId: p.userId })),
      createMany: async ({ data }: { data: { motorClaimId: string; userId: string }[] }) => {
        for (const d of data) participants.set(rsKey(d.motorClaimId, d.userId), d);
        return { count: data.length };
      },
      deleteMany: async ({ where }: { where: { motorClaimId: string; userId: { in: string[] } } }) => {
        let count = 0;
        for (const uid of where.userId.in) if (participants.delete(rsKey(where.motorClaimId, uid))) count++;
        return { count };
      },
    },
    motorClaimReadState: {
      findFirst: async ({ where }: { where: { userId: string } }) => [...readStates.values()].find((r) => r.userId === where.userId) ?? null,
      findMany: async ({ where }: { where: { userId: string; motorClaimId: { in: string[] } } }) =>
        [...readStates.values()].filter((r) => r.userId === where.userId && where.motorClaimId.in.includes(r.motorClaimId)),
      createMany: async ({ data }: { data: FakeReadState[] }) => {
        let count = 0;
        for (const d of data) {
          const k = rsKey(d.motorClaimId, d.userId);
          if (!readStates.has(k)) {
            readStates.set(k, { ...d });
            count++;
          }
        }
        return { count };
      },
      upsert: async ({ where }: { where: { motorClaimId_userId: { motorClaimId: string; userId: string } } }) => {
        const { motorClaimId, userId } = where.motorClaimId_userId;
        const row: FakeReadState = { motorClaimId, userId, lastViewedAt: tick() };
        readStates.set(rsKey(motorClaimId, userId), row);
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
  participants.set(rsKey("claim-1", "creator-1"), { motorClaimId: "claim-1", userId: "creator-1" });
  participants.set(rsKey("claim-1", "user-a"), { motorClaimId: "claim-1", userId: "user-a" });
  participants.set(rsKey("claim-1", "user-b"), { motorClaimId: "claim-1", userId: "user-b" });
  users.set("helper-1", { id: "helper-1", status: "ACTIVE" });
});

describe("Case 17: Motor Claim update -> other participants unread, actor stays read", () => {
  it("addMotorClaimUpdateAction makes every other caught-up participant unread, never the actor", async () => {
    const { markMotorClaimViewed, getUnreadMotorClaimIds } = await import("@/lib/claims/readState");
    const { addMotorClaimUpdateAction } = await import("../actions");

    await markMotorClaimViewed("user-a", "claim-1");
    await markMotorClaimViewed("user-b", "claim-1");

    checkMotorClaimAccess.mockResolvedValue(okAccess({ userId: "user-b" }));
    const result = await addMotorClaimUpdateAction("claim-1", "Assessment scheduled.");
    expect(result.success).toBe(true);

    const claim = claims.get("claim-1")!;
    expect((await getUnreadMotorClaimIds("user-a", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(true);
    expect((await getUnreadMotorClaimIds("user-b", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(false);
  });

  it("closeMotorClaimAction / reopenMotorClaimAction each independently produce unread for other participants", async () => {
    const { markMotorClaimViewed, getUnreadMotorClaimIds } = await import("@/lib/claims/readState");
    const { closeMotorClaimAction, reopenMotorClaimAction } = await import("../actions");

    await markMotorClaimViewed("user-a", "claim-1");
    await markMotorClaimViewed("user-b", "claim-1");

    checkMotorClaimAccess.mockResolvedValue(okAccess({ userId: "user-b" }));
    expect(await closeMotorClaimAction("claim-1")).toEqual({ success: true });

    let claim = claims.get("claim-1")!;
    expect((await getUnreadMotorClaimIds("user-a", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(true);
    expect((await getUnreadMotorClaimIds("user-b", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(false);

    await markMotorClaimViewed("user-a", "claim-1");
    expect(await reopenMotorClaimAction("claim-1")).toEqual({ success: true });

    claim = claims.get("claim-1")!;
    expect((await getUnreadMotorClaimIds("user-a", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(true);
    expect((await getUnreadMotorClaimIds("user-b", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(false);
  });

  it("updateMotorClaimParticipantsAction: acting participant stays read, other caught-up participants go unread, and the newly-added participant is unread immediately (2026-08-24 new-Participant fix)", async () => {
    const { markMotorClaimViewed, getUnreadMotorClaimIds } = await import("@/lib/claims/readState");
    const { updateMotorClaimParticipantsAction } = await import("../actions");

    await markMotorClaimViewed("user-a", "claim-1");
    await markMotorClaimViewed("user-b", "claim-1");

    checkMotorClaimAccess.mockResolvedValue(okAccess({ userId: "user-b" }));
    // helper-1 is brand new to this Claim (and has zero MotorClaimReadState
    // rows anywhere) — before the fix, helper-1's very first
    // getUnreadMotorClaimIds call below would trip
    // ensureMotorClaimReadStateBaseline's old "has any row anywhere" gate
    // and silently mark this Claim as already caught up instead of unread.
    const result = await updateMotorClaimParticipantsAction("claim-1", ["user-a", "user-b", "helper-1"]);
    expect(result).toEqual({ success: true });

    const claim = claims.get("claim-1")!;
    expect((await getUnreadMotorClaimIds("user-a", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(true);
    expect((await getUnreadMotorClaimIds("user-b", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(false);
    expect((await getUnreadMotorClaimIds("helper-1", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(true);

    await markMotorClaimViewed("helper-1", "claim-1");
    expect((await getUnreadMotorClaimIds("helper-1", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(false);
  });
});

describe("Motor Claim — initializeUnreadMotorClaimReadStates (the exact helper createMotorClaimAction calls for its other chosen Participants)", () => {
  it("writes a deterministically-earlier-than-parent lastViewedAt for every given user, making the Claim unread for them but leaving an already-caught-up actor alone", async () => {
    const { initializeUnreadMotorClaimReadStates, getUnreadMotorClaimIds, markMotorClaimViewed } = await import("@/lib/claims/readState");
    const { prisma } = await import("@/lib/prisma");

    // creator-1 is caught up (as touchOwnMotorClaimReadState would leave
    // them right after createMotorClaimAction's own transaction).
    await markMotorClaimViewed("creator-1", "claim-1");
    const claim = claims.get("claim-1")!;

    await prisma.$transaction((tx) =>
      initializeUnreadMotorClaimReadStates(tx as never, "claim-1", claim.updatedAt, ["user-a", "helper-1"])
    );

    expect((await getUnreadMotorClaimIds("creator-1", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(false);
    expect((await getUnreadMotorClaimIds("user-a", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(true);
    expect((await getUnreadMotorClaimIds("helper-1", [{ id: "claim-1", updatedAt: claim.updatedAt }])).has("claim-1")).toBe(true);
  });
});
