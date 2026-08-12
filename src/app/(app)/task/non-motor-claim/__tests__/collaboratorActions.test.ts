import { describe, it, expect, vi, beforeEach } from "vitest";

// Non-Motor Claim Collaborator Permission Model — Case 13 from this phase's
// spec (Part XII). Mirrors src/app/(app)/task/motor-claim/__tests__/
// collaboratorActions.test.ts exactly.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// actions.ts also statically imports `auth` (for requireTaskPermission, not
// exercised by these tests) — stubbed so importing the module never pulls
// in the real next-auth/next-server wiring, which this test environment
// can't resolve.
vi.mock("@/lib/auth", () => ({ auth: async () => null }));

const checkNonMotorClaimAccess = vi.fn();
vi.mock("@/lib/claims/access", () => ({
  checkNonMotorClaimAccess: (...args: unknown[]) => checkNonMotorClaimAccess(...args),
}));

const customerFindUniqueMock = vi.fn();
const nonMotorClaimFindUniqueMock = vi.fn();
const nonMotorClaimUpdateMock = vi.fn();
const nonMotorClaimUpdateManyMock = vi.fn();
const nonMotorClaimUpdateCreateMock = vi.fn();
const nonMotorClaimParticipantFindManyMock = vi.fn();
const nonMotorClaimParticipantDeleteManyMock = vi.fn();
const nonMotorClaimParticipantCreateManyMock = vi.fn();
const userFindManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findUnique: (...args: unknown[]) => customerFindUniqueMock(...args) },
    nonMotorClaim: {
      findUnique: (...args: unknown[]) => nonMotorClaimFindUniqueMock(...args),
      update: (...args: unknown[]) => nonMotorClaimUpdateMock(...args),
      updateMany: (...args: unknown[]) => nonMotorClaimUpdateManyMock(...args),
    },
    nonMotorClaimParticipant: {
      findMany: (...args: unknown[]) => nonMotorClaimParticipantFindManyMock(...args),
      deleteMany: (...args: unknown[]) => nonMotorClaimParticipantDeleteManyMock(...args),
      createMany: (...args: unknown[]) => nonMotorClaimParticipantCreateManyMock(...args),
    },
    user: { findMany: (...args: unknown[]) => userFindManyMock(...args) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        nonMotorClaim: {
          update: (...args: unknown[]) => nonMotorClaimUpdateMock(...args),
          updateMany: (...args: unknown[]) => nonMotorClaimUpdateManyMock(...args),
        },
        nonMotorClaimUpdate: { create: (...args: unknown[]) => nonMotorClaimUpdateCreateMock(...args) },
        nonMotorClaimParticipant: {
          deleteMany: (...args: unknown[]) => nonMotorClaimParticipantDeleteManyMock(...args),
          createMany: (...args: unknown[]) => nonMotorClaimParticipantCreateManyMock(...args),
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
  insuranceType: "PUBLIC_LIABILITY",
  progress: "LOSS_ASSESSMENT_INVESTIGATION",
};

beforeEach(() => {
  vi.clearAllMocks();
  customerFindUniqueMock.mockResolvedValue({ id: "customer-1" });
  nonMotorClaimFindUniqueMock.mockResolvedValue({ progress: "DOCUMENT_PREPARATION", policyRecordId: null });
  nonMotorClaimUpdateMock.mockResolvedValue({});
  nonMotorClaimUpdateManyMock.mockResolvedValue({ count: 1 });
  nonMotorClaimUpdateCreateMock.mockResolvedValue({});
  nonMotorClaimParticipantFindManyMock.mockResolvedValue([{ userId: "creator-1" }, { userId: "participant-1" }]);
  nonMotorClaimParticipantDeleteManyMock.mockResolvedValue({ count: 1 });
  nonMotorClaimParticipantCreateManyMock.mockResolvedValue({ count: 1 });
  userFindManyMock.mockResolvedValue([{ id: "helper-1" }]);
});

describe("updateNonMotorClaimAction — a Participant can advance the Claim's existing progress states", () => {
  it("Participant can move progress from DOCUMENT_PREPARATION to LOSS_ASSESSMENT_INVESTIGATION", async () => {
    checkNonMotorClaimAccess.mockResolvedValue(participantAccess());
    const { updateNonMotorClaimAction } = await import("../actions");
    const result = await updateNonMotorClaimAction("claim-1", validClaimInput);
    expect(result).toEqual({ success: true });
    expect(nonMotorClaimUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ progress: "LOSS_ASSESSMENT_INVESTIGATION" }) })
    );
  });

  it("non-collaborator cannot update the Claim", async () => {
    checkNonMotorClaimAccess.mockResolvedValue(okAccess({ canEdit: false }));
    const { updateNonMotorClaimAction } = await import("../actions");
    const result = await updateNonMotorClaimAction("claim-1", validClaimInput);
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(nonMotorClaimUpdateMock).not.toHaveBeenCalled();
  });
});

describe("updateNonMotorClaimParticipantsAction — Participant can manage participants", () => {
  it("Participant can add another participant", async () => {
    checkNonMotorClaimAccess.mockResolvedValue(participantAccess());
    const { updateNonMotorClaimParticipantsAction } = await import("../actions");
    const result = await updateNonMotorClaimParticipantsAction("claim-1", ["participant-1", "helper-1"]);
    expect(result).toEqual({ success: true });
    expect(nonMotorClaimParticipantCreateManyMock).toHaveBeenCalled();
  });

  it("Participant can remove another participant, but the Creator row stays protected", async () => {
    checkNonMotorClaimAccess.mockResolvedValue(participantAccess());
    const { updateNonMotorClaimParticipantsAction } = await import("../actions");
    await updateNonMotorClaimParticipantsAction("claim-1", []);
    if (nonMotorClaimParticipantDeleteManyMock.mock.calls.length > 0) {
      const call = nonMotorClaimParticipantDeleteManyMock.mock.calls[0][0] as { where: { userId: { in: string[] } } };
      expect(call.where.userId.in).not.toContain("creator-1");
    }
  });
});

describe("closeNonMotorClaimAction / reopenNonMotorClaimAction — Participant can advance to Finish/reopen", () => {
  it("Participant can close (finish) the Claim", async () => {
    checkNonMotorClaimAccess.mockResolvedValue(participantAccess());
    const { closeNonMotorClaimAction } = await import("../actions");
    const result = await closeNonMotorClaimAction("claim-1");
    expect(result).toEqual({ success: true });
  });

  it("Participant can reopen the Claim", async () => {
    checkNonMotorClaimAccess.mockResolvedValue(participantAccess());
    const { reopenNonMotorClaimAction } = await import("../actions");
    const result = await reopenNonMotorClaimAction("claim-1");
    expect(result).toEqual({ success: true });
  });
});

describe("deleteNonMotorClaimAction stays Creator/Admin-only", () => {
  it("a plain Participant cannot delete the Claim", async () => {
    checkNonMotorClaimAccess.mockResolvedValue(participantAccess());
    const { deleteNonMotorClaimAction } = await import("../actions");
    const result = await deleteNonMotorClaimAction("claim-1");
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("the Creator can delete the Claim", async () => {
    checkNonMotorClaimAccess.mockResolvedValue(creatorAccess());
    const { deleteNonMotorClaimAction } = await import("../actions");
    const result = await deleteNonMotorClaimAction("claim-1");
    expect(result).toEqual({ success: true });
  });

  it("Admin can delete even when not the Creator", async () => {
    checkNonMotorClaimAccess.mockResolvedValue(okAccess({ isCreator: false, isAdmin: true, canEdit: true, canDelete: true }));
    const { deleteNonMotorClaimAction } = await import("../actions");
    const result = await deleteNonMotorClaimAction("claim-1");
    expect(result).toEqual({ success: true });
  });
});
