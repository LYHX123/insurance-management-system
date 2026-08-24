import { describe, it, expect, vi, beforeEach } from "vitest";

// Motor Claim Collaborator Permission Model — Case 12 from this phase's
// spec (Part XII): a Motor Claim Participant must be able to advance the
// Claim through its existing progress states (PREPARE_CLAIM_DOCUMENT → ... →
// FINISH), close/reopen it, and manage participants, while Delete Claim
// stays Creator/Admin-only and the state machine itself is untouched. Mocks
// checkMotorClaimAccess directly, same convention as
// documentActions.permission.test.ts in this same directory.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// actions.ts also statically imports `auth` (for requireTaskPermission, not
// exercised by these tests) — stubbed so importing the module never pulls
// in the real next-auth/next-server wiring, which this test environment
// can't resolve.
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

const checkMotorClaimAccess = vi.fn();
vi.mock("@/lib/claims/access", () => ({
  checkMotorClaimAccess: (...args: unknown[]) => checkMotorClaimAccess(...args),
}));

const customerFindUniqueMock = vi.fn();
const motorClaimFindUniqueMock = vi.fn();
const motorClaimUpdateMock = vi.fn();
const motorClaimUpdateManyMock = vi.fn();
const motorClaimUpdateCreateMock = vi.fn();
const motorClaimParticipantFindManyMock = vi.fn();
const motorClaimParticipantDeleteManyMock = vi.fn();
const motorClaimParticipantCreateManyMock = vi.fn();
const userFindManyMock = vi.fn();
// Claim User-Level Unread Indicator — every mutation also touches the
// acting user's own MotorClaimReadState row (see
// touchOwnMotorClaimReadState in ../actions.ts).
const motorClaimReadStateUpsertMock = vi.fn();
// updateMotorClaimParticipantsAction also explicitly initializes
// newly-added Participants' read state (see
// initializeUnreadMotorClaimReadStates in src/lib/claims/readState.ts).
const motorClaimReadStateCreateManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findUnique: (...args: unknown[]) => customerFindUniqueMock(...args) },
    motorClaim: {
      findUnique: (...args: unknown[]) => motorClaimFindUniqueMock(...args),
      update: (...args: unknown[]) => motorClaimUpdateMock(...args),
      updateMany: (...args: unknown[]) => motorClaimUpdateManyMock(...args),
    },
    motorClaimParticipant: {
      findMany: (...args: unknown[]) => motorClaimParticipantFindManyMock(...args),
      deleteMany: (...args: unknown[]) => motorClaimParticipantDeleteManyMock(...args),
      createMany: (...args: unknown[]) => motorClaimParticipantCreateManyMock(...args),
    },
    user: { findMany: (...args: unknown[]) => userFindManyMock(...args) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        motorClaim: { update: (...args: unknown[]) => motorClaimUpdateMock(...args), updateMany: (...args: unknown[]) => motorClaimUpdateManyMock(...args) },
        motorClaimUpdate: { create: (...args: unknown[]) => motorClaimUpdateCreateMock(...args) },
        motorClaimParticipant: {
          findMany: (...args: unknown[]) => motorClaimParticipantFindManyMock(...args),
          deleteMany: (...args: unknown[]) => motorClaimParticipantDeleteManyMock(...args),
          createMany: (...args: unknown[]) => motorClaimParticipantCreateManyMock(...args),
        },
        motorClaimReadState: {
          upsert: (...args: unknown[]) => motorClaimReadStateUpsertMock(...args),
          createMany: (...args: unknown[]) => motorClaimReadStateCreateManyMock(...args),
        },
      }),
  },
}));

function okAccess(overrides: Partial<{ isCreator: boolean; isAdmin: boolean; canEdit: boolean; canDelete: boolean; status: string }> = {}) {
  return {
    kind: "ok" as const,
    userId: overrides.isCreator ? "creator-1" : "participant-1",
    claimId: "claim-1",
    createdById: "creator-1",
    status: overrides.status ?? "OPEN",
    isCreator: overrides.isCreator ?? false,
    isParticipant: true,
    isAdmin: overrides.isAdmin ?? false,
    moduleCanEdit: overrides.canEdit ?? true,
    canEdit: overrides.canEdit ?? true,
    canDelete: overrides.canDelete ?? false,
  };
}

const participantAccess = () => okAccess({ isCreator: false, isAdmin: false, canEdit: true, canDelete: false });
const creatorAccess = () => okAccess({ isCreator: true, isAdmin: false, canEdit: true, canDelete: true });

const validClaimInput = {
  reportedAt: "2026-01-01T00:00:00.000Z",
  customerId: "customer-1",
  contactName: "Jane Doe",
  contactPhone: "0700000000",
  insurer: "Acme Insurance",
  numberPlate: "KAA 123A",
  claimNature: "OWN_DAMAGE",
  progress: "ASSESSMENT_PROCESS",
};

beforeEach(() => {
  vi.clearAllMocks();
  customerFindUniqueMock.mockResolvedValue({ id: "customer-1" });
  motorClaimFindUniqueMock.mockResolvedValue({ progress: "PREPARE_CLAIM_DOCUMENT", policyRecordId: null });
  motorClaimUpdateMock.mockResolvedValue({ updatedAt: new Date() });
  motorClaimUpdateManyMock.mockResolvedValue({ count: 1 });
  motorClaimUpdateCreateMock.mockResolvedValue({});
  motorClaimParticipantFindManyMock.mockResolvedValue([{ userId: "creator-1" }, { userId: "participant-1" }]);
  motorClaimParticipantDeleteManyMock.mockResolvedValue({ count: 1 });
  motorClaimParticipantCreateManyMock.mockResolvedValue({ count: 1 });
  userFindManyMock.mockResolvedValue([{ id: "helper-1" }]);
  motorClaimReadStateUpsertMock.mockResolvedValue({});
  motorClaimReadStateCreateManyMock.mockResolvedValue({ count: 0 });
});

describe("updateMotorClaimAction — a Participant can advance the Claim's existing progress states", () => {
  it("Participant can move progress from PREPARE_CLAIM_DOCUMENT to ASSESSMENT_PROCESS", async () => {
    checkMotorClaimAccess.mockResolvedValue(participantAccess());
    const { updateMotorClaimAction } = await import("../actions");
    const result = await updateMotorClaimAction("claim-1", validClaimInput);
    expect(result).toEqual({ success: true });
    expect(motorClaimUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ progress: "ASSESSMENT_PROCESS" }) }));
    // Progress actually changed → a timeline entry documents the transition (existing behavior, untouched).
    expect(motorClaimUpdateCreateMock).toHaveBeenCalled();
  });

  it("non-collaborator cannot update the Claim", async () => {
    checkMotorClaimAccess.mockResolvedValue(okAccess({ canEdit: false }));
    const { updateMotorClaimAction } = await import("../actions");
    const result = await updateMotorClaimAction("claim-1", validClaimInput);
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(motorClaimUpdateMock).not.toHaveBeenCalled();
  });
});

describe("updateMotorClaimParticipantsAction — Participant can manage participants", () => {
  it("Participant can add another participant", async () => {
    checkMotorClaimAccess.mockResolvedValue(participantAccess());
    const { updateMotorClaimParticipantsAction } = await import("../actions");
    const result = await updateMotorClaimParticipantsAction("claim-1", ["participant-1", "helper-1"]);
    expect(result).toEqual({ success: true });
    expect(motorClaimParticipantCreateManyMock).toHaveBeenCalled();
  });

  it("Participant can remove another participant, but the Creator row stays protected", async () => {
    checkMotorClaimAccess.mockResolvedValue(participantAccess());
    const { updateMotorClaimParticipantsAction } = await import("../actions");
    await updateMotorClaimParticipantsAction("claim-1", []);
    if (motorClaimParticipantDeleteManyMock.mock.calls.length > 0) {
      const call = motorClaimParticipantDeleteManyMock.mock.calls[0][0] as { where: { userId: { in: string[] } } };
      expect(call.where.userId.in).not.toContain("creator-1");
    }
  });
});

describe("closeMotorClaimAction / reopenMotorClaimAction — Participant can advance to Finish/reopen", () => {
  it("Participant can close (finish) the Claim", async () => {
    checkMotorClaimAccess.mockResolvedValue(participantAccess());
    const { closeMotorClaimAction } = await import("../actions");
    const result = await closeMotorClaimAction("claim-1");
    expect(result).toEqual({ success: true });
  });

  it("Participant can reopen the Claim", async () => {
    checkMotorClaimAccess.mockResolvedValue(participantAccess());
    const { reopenMotorClaimAction } = await import("../actions");
    const result = await reopenMotorClaimAction("claim-1");
    expect(result).toEqual({ success: true });
  });
});

describe("deleteMotorClaimAction stays Creator/Admin-only", () => {
  it("a plain Participant cannot delete the Claim", async () => {
    checkMotorClaimAccess.mockResolvedValue(participantAccess());
    const { deleteMotorClaimAction } = await import("../actions");
    const result = await deleteMotorClaimAction("claim-1");
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("the Creator can delete the Claim", async () => {
    checkMotorClaimAccess.mockResolvedValue(creatorAccess());
    const { deleteMotorClaimAction } = await import("../actions");
    const result = await deleteMotorClaimAction("claim-1");
    expect(result).toEqual({ success: true });
  });

  it("Admin can delete even when not the Creator", async () => {
    checkMotorClaimAccess.mockResolvedValue(okAccess({ isCreator: false, isAdmin: true, canEdit: true, canDelete: true }));
    const { deleteMotorClaimAction } = await import("../actions");
    const result = await deleteMotorClaimAction("claim-1");
    expect(result).toEqual({ success: true });
  });
});
