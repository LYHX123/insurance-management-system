import { describe, it, expect, vi, beforeEach } from "vitest";

// VIEW/EDIT permission upgrade — proves the actual server actions reject a
// manually-constructed call from a VIEW-only session (Part 11: "即使用户
// 手工构造请求/调用Server Action，也必须拒绝"), not just the pure permission
// helper in isolation. Mirrors the mocking pattern in
// src/lib/policy/__tests__/deletePolicyRecord.test.ts.

let sessionUser: { id: string; role: string; status: string; permissions: string[] } | null = null;
vi.mock("@/lib/auth", () => ({
  auth: async () => (sessionUser ? { user: sessionUser } : null),
}));

const policyRecordFindUniqueMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    policyRecord: {
      findUnique: (...args: unknown[]) => policyRecordFindUniqueMock(...args),
    },
    $transaction: vi.fn(),
  },
}));

function setSession(permissions: string[], role = "Staff") {
  sessionUser = { id: "user-1", role, status: "ACTIVE", permissions };
}

describe("Policy Motor actions — server-side EDIT enforcement (acceptance module)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionUser = null;
    policyRecordFindUniqueMock.mockResolvedValue({ id: "pol-1", deletedAt: null });
  });

  it("addCustomerReceiptAction (收款): a VIEW-only session is rejected before any database read", async () => {
    setSession(["policy.motor.view"]);
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(policyRecordFindUniqueMock).not.toHaveBeenCalled();
  });

  it("addProviderPaymentAction (付款): a VIEW-only session is rejected before any database read", async () => {
    setSession(["policy.motor.view"]);
    const { addProviderPaymentAction } = await import("../actions");

    const result = await addProviderPaymentAction("pol-1", { paymentDate: "2026-01-01", amount: 100 });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(policyRecordFindUniqueMock).not.toHaveBeenCalled();
  });

  it("a NONE session (no policy.motor permission at all) is rejected the same way", async () => {
    setSession([]);
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("an unauthenticated request (no session at all) is rejected the same way", async () => {
    sessionUser = null;
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("an EDIT session passes the permission gate and proceeds to read the record", async () => {
    setSession(["policy.motor.edit"]);
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).not.toEqual({ success: false, error: "FORBIDDEN" });
    expect(policyRecordFindUniqueMock).toHaveBeenCalledWith({ where: { id: "pol-1", deletedAt: null } });
  });

  it("a legacy bare 'policy.motor' permission (pre-upgrade full access) still passes the gate — existing users are never downgraded", async () => {
    setSession(["policy.motor"]);
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).not.toEqual({ success: false, error: "FORBIDDEN" });
    expect(policyRecordFindUniqueMock).toHaveBeenCalled();
  });

  it("Admin passes the permission gate regardless of the stored permissions array", async () => {
    setSession([], "Admin");
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).not.toEqual({ success: false, error: "FORBIDDEN" });
    expect(policyRecordFindUniqueMock).toHaveBeenCalled();
  });

  it("Policy Non-Motor VIEW does not grant EDIT on Policy Motor (cross-submodule isolation, server-enforced)", async () => {
    setSession(["policy.non_motor.edit"]);
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(policyRecordFindUniqueMock).not.toHaveBeenCalled();
  });
});
