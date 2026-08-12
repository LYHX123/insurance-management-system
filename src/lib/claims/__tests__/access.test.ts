import { describe, it, expect, vi, beforeEach } from "vitest";

// Claim Collaborator Permission Model — checkMotorClaimAccess /
// checkNonMotorClaimAccess mirror src/lib/task/access.ts's checkTaskAccess
// exactly (see this phase's spec, Part VIII). Same composition:
//   canEdit   = Admin OR Creator OR Participant
//   canDelete = Admin OR Creator only

let sessionUser: { id: string; role: string; status: string; permissions: string[] } | null = null;
vi.mock("@/lib/auth", () => ({
  auth: async () => (sessionUser ? { user: sessionUser } : null),
}));

type FakeClaim = { id: string; createdById: string; status: string; participantIds: string[] };
let motorClaims: Record<string, FakeClaim>;
let nonMotorClaims: Record<string, FakeClaim>;

function makeFindFirst(store: () => Record<string, FakeClaim>) {
  return vi.fn(async ({ where }: { where: { id: string; participants: { some: { userId: string } } } }) => {
    const claim = store()[where.id];
    if (!claim) return null;
    if (!claim.participantIds.includes(where.participants.some.userId)) return null;
    return { id: claim.id, createdById: claim.createdById, status: claim.status };
  });
}

const motorFindFirstMock = makeFindFirst(() => motorClaims);
const nonMotorFindFirstMock = makeFindFirst(() => nonMotorClaims);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    motorClaim: { findFirst: (...args: unknown[]) => motorFindFirstMock(...(args as [never])) },
    nonMotorClaim: { findFirst: (...args: unknown[]) => nonMotorFindFirstMock(...(args as [never])) },
  },
}));

function setSession(overrides: Partial<{ id: string; role: string; permissions: string[] }> = {}) {
  sessionUser = {
    id: overrides.id ?? "user-1",
    role: overrides.role ?? "Staff",
    status: "ACTIVE",
    permissions: overrides.permissions ?? [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionUser = null;
  motorClaims = { "claim-1": { id: "claim-1", createdById: "creator-1", status: "OPEN", participantIds: ["creator-1", "participant-1"] } };
  nonMotorClaims = { "claim-1": { id: "claim-1", createdById: "creator-1", status: "OPEN", participantIds: ["creator-1", "participant-1"] } };
});

describe("checkMotorClaimAccess — Case 12", () => {
  it("Creator: canEdit + canDelete", async () => {
    setSession({ id: "creator-1", permissions: ["claim.motor.edit"] });
    const { checkMotorClaimAccess } = await import("../access");
    const result = await checkMotorClaimAccess("claim-1");
    expect(result).toMatchObject({ kind: "ok", isCreator: true, canEdit: true, canDelete: true });
  });

  it("Participant (even VIEW-only module permission): canEdit true, canDelete false — can advance/close/manage participants but not delete", async () => {
    setSession({ id: "participant-1", permissions: ["claim.motor.view"] });
    const { checkMotorClaimAccess } = await import("../access");
    const result = await checkMotorClaimAccess("claim-1");
    expect(result).toMatchObject({ kind: "ok", isCreator: false, isParticipant: true, canEdit: true, canDelete: false });
  });

  it("non-participant: not-found, regardless of module permission", async () => {
    setSession({ id: "outsider-1", permissions: ["claim.motor.edit"] });
    const { checkMotorClaimAccess } = await import("../access");
    expect(await checkMotorClaimAccess("claim-1")).toEqual({ kind: "not-found" });
  });

  it("Admin: full collaborator + delete rights", async () => {
    motorClaims["claim-1"].participantIds.push("admin-1");
    setSession({ id: "admin-1", role: "ADMIN", permissions: [] });
    const { checkMotorClaimAccess } = await import("../access");
    const result = await checkMotorClaimAccess("claim-1");
    expect(result).toMatchObject({ kind: "ok", isAdmin: true, canEdit: true, canDelete: true });
  });
});

describe("checkNonMotorClaimAccess — Case 13", () => {
  it("Creator: canEdit + canDelete", async () => {
    setSession({ id: "creator-1", permissions: ["claim.non_motor.edit"] });
    const { checkNonMotorClaimAccess } = await import("../access");
    const result = await checkNonMotorClaimAccess("claim-1");
    expect(result).toMatchObject({ kind: "ok", isCreator: true, canEdit: true, canDelete: true });
  });

  it("Participant (even VIEW-only module permission): canEdit true, canDelete false", async () => {
    setSession({ id: "participant-1", permissions: ["claim.non_motor.view"] });
    const { checkNonMotorClaimAccess } = await import("../access");
    const result = await checkNonMotorClaimAccess("claim-1");
    expect(result).toMatchObject({ kind: "ok", isCreator: false, isParticipant: true, canEdit: true, canDelete: false });
  });

  it("non-participant: not-found", async () => {
    setSession({ id: "outsider-1", permissions: ["claim.non_motor.edit"] });
    const { checkNonMotorClaimAccess } = await import("../access");
    expect(await checkNonMotorClaimAccess("claim-1")).toEqual({ kind: "not-found" });
  });

  it("NONE permission: no-module-access", async () => {
    setSession({ id: "participant-1", permissions: [] });
    const { checkNonMotorClaimAccess } = await import("../access");
    expect(await checkNonMotorClaimAccess("claim-1")).toEqual({ kind: "no-module-access" });
  });
});
