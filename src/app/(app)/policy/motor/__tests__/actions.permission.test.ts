import { describe, it, expect, vi, beforeEach } from "vitest";

// VIEW/EDIT permission upgrade — proves the actual server actions reject a
// manually-constructed call from a VIEW-only session (Part 11: "即使用户
// 手工构造请求/调用Server Action，也必须拒绝"), not just the pure permission
// helper in isolation. Mirrors the mocking pattern in
// src/lib/policy/__tests__/deletePolicyRecord.test.ts.
//
// Production Readiness Audit V1, finding C1 (fixed): addCustomerReceiptAction,
// addProviderPaymentAction, updateCommissionAction and
// resolveBalanceVerificationAction are shared by all four Policy categories'
// Financial tabs (see e.g. bond-financial-tab.tsx), so permission must now be
// resolved from the target record's REAL category — never hardcoded to
// policy.motor. Because that requires reading the record first, these tests
// no longer assert "rejected before any database read" for the shared
// financial actions (unlike a hardcoded-permission check, the record must be
// fetched to know which permission key even applies — same pattern already
// used by documentActions.ts's requirePolicyPermission(category)).

let sessionUser: { id: string; role: string; status: string; permissions: string[] } | null = null;
vi.mock("@/lib/auth", () => ({
  auth: async () => (sessionUser ? { user: sessionUser } : null),
}));

type MockCategory = "MOTOR" | "NON_MOTOR" | "BOND" | "WORK_PERMIT";

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

function mockRecord(category: MockCategory) {
  policyRecordFindUniqueMock.mockResolvedValue({
    id: "pol-1",
    deletedAt: null,
    category,
    insurerBalanceVerification: "UNVERIFIED",
    clientBalanceVerification: "UNVERIFIED",
  });
}

describe("Policy Motor actions — server-side EDIT enforcement (acceptance module)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionUser = null;
    mockRecord("MOTOR");
  });

  it("addCustomerReceiptAction (收款): a VIEW-only session is rejected", async () => {
    setSession(["policy.motor.view"]);
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("addProviderPaymentAction (付款): a VIEW-only session is rejected", async () => {
    setSession(["policy.motor.view"]);
    const { addProviderPaymentAction } = await import("../actions");

    const result = await addProviderPaymentAction("pol-1", { paymentDate: "2026-01-01", amount: 100 });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
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

  it("a missing record is reported as RECORD_NOT_FOUND (never leaks permission state for a nonexistent id)", async () => {
    setSession(["policy.motor.edit"]);
    policyRecordFindUniqueMock.mockResolvedValue(null);
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-missing", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).toEqual({ success: false, error: "RECORD_NOT_FOUND" });
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

  it("Policy Non-Motor EDIT does not grant EDIT on a Policy Motor record (cross-submodule isolation, server-enforced)", async () => {
    setSession(["policy.non_motor.edit"]);
    mockRecord("MOTOR");
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });
});

// ---------------------------------------------------------------------------
// C1 — cross-category financial-write authorization (Production Readiness
// Audit V1). addCustomerReceiptAction / addProviderPaymentAction /
// updateCommissionAction / resolveBalanceVerificationAction are the single
// shared implementation reused by Bond, Non-Motor and Work Permit's
// Financial tabs — permission must be resolved from the record's REAL
// category, never hardcoded to policy.motor.
// ---------------------------------------------------------------------------
describe("Policy financial actions — C1 cross-category authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionUser = null;
  });

  // CASE C1-1 / C1-2 / C1-3: a Motor-only EDIT user must be FORBIDDEN from
  // writing to a Bond record via the shared receipt/payment/commission actions.
  it("C1-1: policy.motor.edit-only user cannot Receive Customer Payment on a Bond record", async () => {
    setSession(["policy.motor.edit"]);
    mockRecord("BOND");
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-bond", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("C1-2: policy.motor.edit-only user cannot record a Provider Payment on a Bond record", async () => {
    setSession(["policy.motor.edit"]);
    mockRecord("BOND");
    const { addProviderPaymentAction } = await import("../actions");

    const result = await addProviderPaymentAction("pol-bond", { paymentDate: "2026-01-01", amount: 100 });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("C1-3: policy.motor.edit-only user cannot Update Commission on a Bond record", async () => {
    setSession(["policy.motor.edit"]);
    mockRecord("BOND");
    const { updateCommissionAction } = await import("../actions");

    const result = await updateCommissionAction("pol-bond", { commissionReceived: false });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  // CASE C1-4: same user, Non-Motor financial write.
  it("C1-4: policy.motor.edit-only user cannot Receive Customer Payment on a Non-Motor record", async () => {
    setSession(["policy.motor.edit"]);
    mockRecord("NON_MOTOR");
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-nm", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  // CASE C1-5: same user, Work Permit financial write.
  it("C1-5: policy.motor.edit-only user cannot Receive Customer Payment on a Work Permit record", async () => {
    setSession(["policy.motor.edit"]);
    mockRecord("WORK_PERMIT");
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-wp", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  // CASE C1-6/C1-7/C1-8: the matching category's own EDIT permission passes.
  it("C1-6: policy.bond.edit user CAN Receive Customer Payment on a Bond record", async () => {
    setSession(["policy.bond.edit"]);
    mockRecord("BOND");
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-bond", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).not.toEqual({ success: false, error: "FORBIDDEN" });
    expect(policyRecordFindUniqueMock).toHaveBeenCalledWith({ where: { id: "pol-bond", deletedAt: null } });
  });

  it("C1-7: policy.non_motor.edit user CAN Receive Customer Payment on a Non-Motor record", async () => {
    setSession(["policy.non_motor.edit"]);
    mockRecord("NON_MOTOR");
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-nm", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).not.toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("C1-8: policy.work_permit.edit user CAN Receive Customer Payment on a Work Permit record", async () => {
    setSession(["policy.work_permit.edit"]);
    mockRecord("WORK_PERMIT");
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-wp", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).not.toEqual({ success: false, error: "FORBIDDEN" });
  });

  // CASE C1-9: VIEW-only on the matching category still cannot write.
  it("C1-9: policy.bond.view (VIEW-only, matching category) cannot Receive Customer Payment on a Bond record", async () => {
    setSession(["policy.bond.view"]);
    mockRecord("BOND");
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-bond", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  // CASE C1-10: Admin is unaffected by the category fix, on every category.
  it("C1-10: Admin can Receive Customer Payment on Bond/Non-Motor/Work Permit records regardless of stored permissions", async () => {
    setSession([], "Admin");
    const { addCustomerReceiptAction } = await import("../actions");

    for (const category of ["BOND", "NON_MOTOR", "WORK_PERMIT"] as const) {
      mockRecord(category);
      const result = await addCustomerReceiptAction("pol-x", { receiptDate: "2026-01-01", amount: 100 });
      expect(result).not.toEqual({ success: false, error: "FORBIDDEN" });
    }
  });

  // resolveBalanceVerificationAction is the fourth action in this shared
  // group (Production Readiness Audit V1, C1's "INFO — not yet reachable
  // cross-category via the UI" note) — covered here too so the fix is
  // complete, not just the three UI-reachable actions.
  it("resolveBalanceVerificationAction: policy.motor.edit-only user cannot resolve a Bond record's balance verification", async () => {
    setSession(["policy.motor.edit"]);
    mockRecord("BOND");
    const { resolveBalanceVerificationAction } = await import("../actions");

    const result = await resolveBalanceVerificationAction("pol-bond", { side: "insurer", note: "corrected" });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("resolveBalanceVerificationAction: policy.bond.edit user CAN resolve a Bond record's balance verification", async () => {
    setSession(["policy.bond.edit"]);
    mockRecord("BOND");
    const { resolveBalanceVerificationAction } = await import("../actions");

    const result = await resolveBalanceVerificationAction("pol-bond", { side: "insurer", note: "corrected" });

    expect(result).not.toEqual({ success: false, error: "FORBIDDEN" });
  });

  // Fail-closed: an unrecognized/garbage category (never a real Prisma enum
  // value in practice, but this proves there is no hidden fallback to
  // policy.motor if POLICY_CATEGORY_PERMISSION ever failed to resolve a key).
  it("fails closed (never falls back to policy.motor) when the category has no mapped permission key", async () => {
    setSession(["policy.motor.edit"]);
    policyRecordFindUniqueMock.mockResolvedValue({
      id: "pol-weird",
      deletedAt: null,
      category: "SOMETHING_UNMAPPED" as unknown as MockCategory,
    });
    const { addCustomerReceiptAction } = await import("../actions");

    const result = await addCustomerReceiptAction("pol-weird", { receiptDate: "2026-01-01", amount: 100 });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });
});

// ---------------------------------------------------------------------------
// H5 — finite-amount validation (Production Readiness Audit V1). A bare
// `Number(x) <= 0` check lets NaN/Infinity/-Infinity through silently; these
// must all be rejected the same way an ordinary invalid amount is.
// ---------------------------------------------------------------------------
describe("Policy financial actions — H5 finite-amount validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionUser = null;
    setSession(["policy.motor.edit"]);
    mockRecord("MOTOR");
  });

  const validAmounts = [1, 100, 100.5, 999999.99];
  const invalidAmounts: unknown[] = [0, -1, NaN, Infinity, -Infinity, "Infinity", "-Infinity", "NaN", "abc", "", "   "];

  it.each(validAmounts)("accepts a valid customer receipt amount: %s", async (amount) => {
    const { addCustomerReceiptAction } = await import("../actions");
    const result = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-01-01", amount });
    expect(result).not.toEqual({ success: false, error: "AMOUNT_INVALID" });
  });

  it.each(invalidAmounts)("rejects an invalid customer receipt amount: %p", async (amount) => {
    const { addCustomerReceiptAction } = await import("../actions");
    const result = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-01-01", amount: amount as number | string });
    expect(result).toEqual({ success: false, error: "AMOUNT_INVALID" });
  });

  it.each(invalidAmounts)("rejects an invalid provider payment amount: %p", async (amount) => {
    const { addProviderPaymentAction } = await import("../actions");
    const result = await addProviderPaymentAction("pol-1", { paymentDate: "2026-01-01", amount: amount as number | string });
    expect(result).toEqual({ success: false, error: "AMOUNT_INVALID" });
  });

  // Commission's pre-existing business rule (preserved, not changed by this
  // phase) rejects amounts `< 0`, not `<= 0` like receipt/payment — so 0 and
  // a whitespace-only string (which Number() coerces to 0) are excluded here
  // and asserted as accepted separately below. Every non-finite value must
  // still be rejected regardless of that threshold.
  const nonFiniteAmounts = invalidAmounts.filter((a) => a !== 0 && a !== "   ");

  it.each(nonFiniteAmounts)("rejects a non-finite/negative commission amount when commissionReceived=true: %p", async (amount) => {
    const { updateCommissionAction } = await import("../actions");
    const result = await updateCommissionAction("pol-1", {
      commissionReceived: true,
      commissionAmount: amount as number | string,
      commissionReceivedDate: "2026-01-01",
    });
    expect(result).toEqual({ success: false, error: "COMMISSION_AMOUNT_INVALID" });
  });

  it("accepts a zero commission amount when commissionReceived=true (pre-existing business rule, unchanged)", async () => {
    const { updateCommissionAction } = await import("../actions");
    const result = await updateCommissionAction("pol-1", {
      commissionReceived: true,
      commissionAmount: 0,
      commissionReceivedDate: "2026-01-01",
    });
    expect(result).not.toEqual({ success: false, error: "COMMISSION_AMOUNT_INVALID" });
  });

  it("accepts a valid commission amount when commissionReceived=true", async () => {
    const { updateCommissionAction } = await import("../actions");
    const result = await updateCommissionAction("pol-1", {
      commissionReceived: true,
      commissionAmount: 250.75,
      commissionReceivedDate: "2026-01-01",
    });
    expect(result).not.toEqual({ success: false, error: "COMMISSION_AMOUNT_INVALID" });
  });

  it.each([Infinity, -Infinity, NaN, "Infinity", "NaN"])(
    "rejects a non-finite correctedAmount in resolveBalanceVerificationAction: %p",
    async (amount) => {
      const { resolveBalanceVerificationAction } = await import("../actions");
      const result = await resolveBalanceVerificationAction("pol-1", {
        side: "insurer",
        note: "corrected",
        correctedAmount: amount as number | string,
      });
      expect(result).toEqual({ success: false, error: "AMOUNT_INVALID" });
    }
  );
});
