import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// WIBA Injured Name feature — createNonMotorClaimAction/updateNonMotorClaimAction
// gain a WIBA-only `injuredName` field (see NonMotorClaim.injuredName's schema
// comment). Mirrors the mocking conventions of the existing
// collaboratorActions.test.ts (simple per-method prisma mocks) in this same
// directory.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => authMock(...args) }));

const canEditMock = vi.fn();
vi.mock("@/lib/permissions", () => ({ canEdit: (...args: unknown[]) => canEditMock(...args) }));

const checkNonMotorClaimAccess = vi.fn();
vi.mock("@/lib/claims/access", () => ({
  checkNonMotorClaimAccess: (...args: unknown[]) => checkNonMotorClaimAccess(...args),
}));

const generateNonMotorClaimNumberMock = vi.fn();
vi.mock("@/lib/claims/nonMotorClaimNumber", () => ({
  generateNonMotorClaimNumber: (...args: unknown[]) => generateNonMotorClaimNumberMock(...args),
}));

const customerFindUniqueMock = vi.fn();
const nonMotorClaimFindUniqueMock = vi.fn();
const nonMotorClaimCreateMock = vi.fn();
const nonMotorClaimUpdateMock = vi.fn();
const nonMotorClaimParticipantCreateManyMock = vi.fn();
const nonMotorClaimUpdateCreateMock = vi.fn();
const nonMotorClaimReadStateUpsertMock = vi.fn();
const userFindManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findUnique: (...args: unknown[]) => customerFindUniqueMock(...args) },
    nonMotorClaim: {
      findUnique: (...args: unknown[]) => nonMotorClaimFindUniqueMock(...args),
    },
    user: { findMany: (...args: unknown[]) => userFindManyMock(...args) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        nonMotorClaim: {
          create: (...args: unknown[]) => nonMotorClaimCreateMock(...args),
          update: (...args: unknown[]) => nonMotorClaimUpdateMock(...args),
        },
        nonMotorClaimParticipant: { createMany: (...args: unknown[]) => nonMotorClaimParticipantCreateManyMock(...args) },
        nonMotorClaimUpdate: { create: (...args: unknown[]) => nonMotorClaimUpdateCreateMock(...args) },
        nonMotorClaimReadState: { upsert: (...args: unknown[]) => nonMotorClaimReadStateUpsertMock(...args) },
      }),
  },
}));

function okAccess(overrides: Partial<{ canEdit: boolean; status: string }> = {}) {
  return {
    kind: "ok" as const,
    userId: "participant-1",
    claimId: "claim-1",
    createdById: "creator-1",
    status: overrides.status ?? "OPEN",
    isCreator: false,
    isParticipant: true,
    isAdmin: false,
    moduleCanEdit: overrides.canEdit ?? true,
    canEdit: overrides.canEdit ?? true,
    canDelete: false,
  };
}

const baseCreateInput = (overrides: Record<string, unknown> = {}) => ({
  reportedAt: "2026-01-01T00:00:00.000Z",
  customerId: "customer-1",
  contactName: "Jane Doe",
  contactPhone: "0700000000",
  insurer: "Acme Insurance",
  insuranceType: "WIBA",
  progress: "DOCUMENT_PREPARATION",
  participantIds: [] as string[],
  ...overrides,
});

const baseUpdateInput = (overrides: Record<string, unknown> = {}) => ({
  reportedAt: "2026-01-01T00:00:00.000Z",
  customerId: "customer-1",
  contactName: "Jane Doe",
  contactPhone: "0700000000",
  insurer: "Acme Insurance",
  insuranceType: "WIBA",
  progress: "DOCUMENT_PREPARATION",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "user-1" } });
  canEditMock.mockReturnValue(true);
  generateNonMotorClaimNumberMock.mockResolvedValue("NC202608-0001");
  customerFindUniqueMock.mockResolvedValue({ id: "customer-1" });
  nonMotorClaimCreateMock.mockImplementation(async ({ data }: { data: { claimNumber: string } }) => ({ id: "claim-new", claimNumber: data.claimNumber }));
  nonMotorClaimUpdateMock.mockResolvedValue({});
  nonMotorClaimParticipantCreateManyMock.mockResolvedValue({ count: 1 });
  nonMotorClaimUpdateCreateMock.mockResolvedValue({});
  nonMotorClaimReadStateUpsertMock.mockResolvedValue({});
  userFindManyMock.mockResolvedValue([]);
  nonMotorClaimFindUniqueMock.mockResolvedValue({ progress: "DOCUMENT_PREPARATION", policyRecordId: null });
  checkNonMotorClaimAccess.mockResolvedValue(okAccess());
});

describe("createNonMotorClaimAction — WIBA Injured Name", () => {
  it("Case 1: WIBA claim with Injured Name saves successfully, persisting the trimmed name", async () => {
    const { createNonMotorClaimAction } = await import("../actions");
    const result = await createNonMotorClaimAction(baseCreateInput({ injuredName: "  John Kamau  " }));
    expect(result.success).toBe(true);
    expect(nonMotorClaimCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ injuredName: "John Kamau" }) })
    );
  });

  it("Case 2: WIBA claim without Injured Name is rejected with INJURED_NAME_REQUIRED", async () => {
    const { createNonMotorClaimAction } = await import("../actions");
    const result = await createNonMotorClaimAction(baseCreateInput());
    expect(result).toEqual({ success: false, error: "INJURED_NAME_REQUIRED" });
    expect(nonMotorClaimCreateMock).not.toHaveBeenCalled();
  });

  it("Case 3: WIBA claim with a whitespace-only Injured Name is rejected with INJURED_NAME_REQUIRED", async () => {
    const { createNonMotorClaimAction } = await import("../actions");
    const result = await createNonMotorClaimAction(baseCreateInput({ injuredName: "   " }));
    expect(result).toEqual({ success: false, error: "INJURED_NAME_REQUIRED" });
    expect(nonMotorClaimCreateMock).not.toHaveBeenCalled();
  });

  it("Case 4: a plain (non-WIBA) Non-Motor Claim needs no Injured Name and saves with injuredName = null", async () => {
    const { createNonMotorClaimAction } = await import("../actions");
    const result = await createNonMotorClaimAction(baseCreateInput({ insuranceType: "PUBLIC_LIABILITY" }));
    expect(result.success).toBe(true);
    expect(nonMotorClaimCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ injuredName: null }) })
    );
  });

  it("a stray Injured Name submitted for a non-WIBA insuranceType is never persisted (server-side defense, not just UI)", async () => {
    const { createNonMotorClaimAction } = await import("../actions");
    const result = await createNonMotorClaimAction(baseCreateInput({ insuranceType: "PUBLIC_LIABILITY", injuredName: "Leftover WIBA Name" }));
    expect(result.success).toBe(true);
    expect(nonMotorClaimCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ injuredName: null }) })
    );
  });
});

describe("updateNonMotorClaimAction — WIBA Injured Name", () => {
  it("Case 5: editing a WIBA claim's Injured Name saves the new value", async () => {
    const { updateNonMotorClaimAction } = await import("../actions");
    const result = await updateNonMotorClaimAction("claim-1", baseUpdateInput({ injuredName: "Updated Name" }));
    expect(result).toEqual({ success: true });
    expect(nonMotorClaimUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ injuredName: "Updated Name" }) })
    );
  });

  it("a WIBA claim cannot be saved with a blank Injured Name", async () => {
    const { updateNonMotorClaimAction } = await import("../actions");
    const result = await updateNonMotorClaimAction("claim-1", baseUpdateInput({ injuredName: "   " }));
    expect(result).toEqual({ success: false, error: "INJURED_NAME_REQUIRED" });
    expect(nonMotorClaimUpdateMock).not.toHaveBeenCalled();
  });

  it("Case 6 (server side): a historical WIBA claim with injuredName = null can still be edited — as long as the edit supplies a name, save succeeds without crashing", async () => {
    nonMotorClaimFindUniqueMock.mockResolvedValue({ progress: "DOCUMENT_PREPARATION", policyRecordId: null });
    const { updateNonMotorClaimAction } = await import("../actions");
    const result = await updateNonMotorClaimAction("claim-1", baseUpdateInput({ injuredName: "Filled In Later" }));
    expect(result).toEqual({ success: true });
  });

  it("switching away from WIBA on edit clears injuredName server-side, never carrying the old value forward", async () => {
    const { updateNonMotorClaimAction } = await import("../actions");
    const result = await updateNonMotorClaimAction("claim-1", baseUpdateInput({ insuranceType: "FIRE_ALLIED_PERILS", injuredName: "Should Not Be Saved" }));
    expect(result).toEqual({ success: true });
    expect(nonMotorClaimUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ injuredName: null }) })
    );
  });

  it("Case 10: an Injured-Name-only edit still touches the acting user's own read state (existing unread/read-state behavior unchanged)", async () => {
    const { updateNonMotorClaimAction } = await import("../actions");
    const result = await updateNonMotorClaimAction("claim-1", baseUpdateInput({ injuredName: "Name Change Only" }));
    expect(result).toEqual({ success: true });
    expect(nonMotorClaimReadStateUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { nonMotorClaimId_userId: { nonMotorClaimId: "claim-1", userId: "participant-1" } } })
    );
  });
});

describe("Case 11: Motor Claim is completely unaffected by the WIBA Injured Name feature", () => {
  it("Motor Claim's actions.ts has no injuredName field anywhere", () => {
    const motorActionsSource = readFileSync(
      join(__dirname, "..", "..", "motor-claim", "actions.ts"),
      "utf8"
    );
    expect(motorActionsSource).not.toMatch(/injuredName/);
  });
});
