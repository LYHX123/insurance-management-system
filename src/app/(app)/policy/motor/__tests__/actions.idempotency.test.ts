import { describe, it, expect, vi, beforeEach } from "vitest";

// Production Readiness Audit V1, finding H6: addCustomerReceiptAction /
// addProviderPaymentAction now require an idempotencyKey and atomically
// claim it inside the same transaction that creates the receipt/payment —
// a retried submission (same key) must never create a second record, while
// a genuinely new submission (different key) for the same policy and
// amount must still succeed as its own real record.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "user-1", role: "Staff", status: "ACTIVE", permissions: ["policy.motor.edit"] } })),
}));

type ClaimRow = { key: string; scope: string; resourceId: string };
type ReceiptRow = { id: string; policyRecordId: string; amount: string; receiptDate: Date };
type PaymentRow = { id: string; policyRecordId: string; amount: string; paymentDate: Date };

let claims: Map<string, ClaimRow>;
let receipts: ReceiptRow[];
let payments: PaymentRow[];
let idCounter = 0;

class FakeUniqueConstraintError extends Error {
  code = "P2002";
}

function buildTx() {
  return {
    idempotencyClaim: {
      create: vi.fn(async ({ data }: { data: ClaimRow }) => {
        if (claims.has(data.key)) throw new FakeUniqueConstraintError("unique");
        claims.set(data.key, { ...data });
        return { ...data };
      }),
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => claims.get(where.key) ?? null),
      update: vi.fn(async ({ where, data }: { where: { key: string }; data: { resourceId: string } }) => {
        const row = claims.get(where.key)!;
        row.resourceId = data.resourceId;
        return row;
      }),
    },
    policyCustomerReceipt: {
      create: vi.fn(async ({ data }: { data: { policyRecordId: string; amount: unknown; receiptDate: Date } }) => {
        idCounter += 1;
        const row: ReceiptRow = { id: `receipt-${idCounter}`, policyRecordId: data.policyRecordId, amount: String(data.amount), receiptDate: data.receiptDate };
        receipts.push(row);
        return row;
      }),
    },
    policyProviderPayment: {
      create: vi.fn(async ({ data }: { data: { policyRecordId: string; amount: unknown; paymentDate: Date } }) => {
        idCounter += 1;
        const row: PaymentRow = { id: `payment-${idCounter}`, policyRecordId: data.policyRecordId, amount: String(data.amount), paymentDate: data.paymentDate };
        payments.push(row);
        return row;
      }),
    },
    policyActivity: { create: vi.fn(async () => ({})) },
  };
}

let txQueue: Promise<unknown> = Promise.resolve();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    policyRecord: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "pol-1" ? { id: "pol-1", deletedAt: null, category: "MOTOR" } : null
      ),
    },
    $transaction: vi.fn((cb: (tx: ReturnType<typeof buildTx>) => Promise<unknown>) => {
      const run = txQueue.then(
        () => cb(buildTx()),
        () => cb(buildTx())
      );
      txQueue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }),
  },
}));

describe("addCustomerReceiptAction — H6 idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txQueue = Promise.resolve();
    idCounter = 0;
    claims = new Map();
    receipts = [];
  });

  it("1. a normal receipt is created successfully", async () => {
    const { addCustomerReceiptAction } = await import("../actions");
    const result = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-08-01", amount: 100000, idempotencyKey: "key-1" });
    expect(result.success).toBe(true);
    expect(receipts).toHaveLength(1);
  });

  it("2. submitting the same idempotency key twice in sequence (double-click / retry) creates only one receipt", async () => {
    const { addCustomerReceiptAction } = await import("../actions");
    const r1 = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-08-01", amount: 100000, idempotencyKey: "key-2" });
    const r2 = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-08-01", amount: 100000, idempotencyKey: "key-2" });

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    if (r1.success && r2.success) expect(r2.id).toBe(r1.id); // the retry replays the original result, not an error
    expect(receipts).toHaveLength(1);
  });

  it("3. Promise.all with the SAME idempotency key -> only one receipt is created", async () => {
    const { addCustomerReceiptAction } = await import("../actions");

    const [r1, r2] = await Promise.all([
      addCustomerReceiptAction("pol-1", { receiptDate: "2026-08-01", amount: 100000, idempotencyKey: "key-3" }),
      addCustomerReceiptAction("pol-1", { receiptDate: "2026-08-01", amount: 100000, idempotencyKey: "key-3" }),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    if (r1.success && r2.success) expect(r2.id).toBe(r1.id);
    expect(receipts).toHaveLength(1);
  });

  it("4. a DIFFERENT idempotency key for the same policy and same amount creates a second, real receipt (two legitimate KES 100,000 payments)", async () => {
    const { addCustomerReceiptAction } = await import("../actions");

    const r1 = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-08-01", amount: 100000, idempotencyKey: "key-4a" });
    const r2 = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-08-01", amount: 100000, idempotencyKey: "key-4b" });

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    if (r1.success && r2.success) expect(r2.id).not.toBe(r1.id);
    expect(receipts).toHaveLength(2);
  });

  it("a missing idempotency key is rejected before any write", async () => {
    const { addCustomerReceiptAction } = await import("../actions");
    const result = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-08-01", amount: 100000, idempotencyKey: "" });
    expect(result).toEqual({ success: false, error: "IDEMPOTENCY_KEY_REQUIRED" });
    expect(receipts).toHaveLength(0);
  });

  it("Phase A's NaN/Infinity amount validation still runs before idempotency claiming", async () => {
    const { addCustomerReceiptAction } = await import("../actions");
    const result = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-08-01", amount: Infinity, idempotencyKey: "key-5" });
    expect(result).toEqual({ success: false, error: "AMOUNT_INVALID" });
    expect(claims.size).toBe(0); // the key was never even claimed for an invalid submission
  });

  it("VIEW-only cannot create a receipt (Phase A's C1 category-aware check still applies)", async () => {
    const { auth } = await import("@/lib/auth");
    (auth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "user-1", role: "Staff", status: "ACTIVE", permissions: ["policy.motor.view"] },
    });
    const { addCustomerReceiptAction } = await import("../actions");
    const result = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-08-01", amount: 100000, idempotencyKey: "key-6" });
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("Admin can create a receipt", async () => {
    const { auth } = await import("@/lib/auth");
    (auth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: { id: "admin-1", role: "Admin", status: "ACTIVE", permissions: [] } });
    const { addCustomerReceiptAction } = await import("../actions");
    const result = await addCustomerReceiptAction("pol-1", { receiptDate: "2026-08-01", amount: 100000, idempotencyKey: "key-7" });
    expect(result.success).toBe(true);
  });
});

describe("addProviderPaymentAction — H6 idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txQueue = Promise.resolve();
    idCounter = 0;
    claims = new Map();
    payments = [];
  });

  it("1. a normal payment is created successfully", async () => {
    const { addProviderPaymentAction } = await import("../actions");
    const result = await addProviderPaymentAction("pol-1", { paymentDate: "2026-08-01", amount: 50000, idempotencyKey: "p-key-1" });
    expect(result.success).toBe(true);
    expect(payments).toHaveLength(1);
  });

  it("2. same key submitted twice -> only one payment, replay returns the same id", async () => {
    const { addProviderPaymentAction } = await import("../actions");
    const r1 = await addProviderPaymentAction("pol-1", { paymentDate: "2026-08-01", amount: 50000, idempotencyKey: "p-key-2" });
    const r2 = await addProviderPaymentAction("pol-1", { paymentDate: "2026-08-01", amount: 50000, idempotencyKey: "p-key-2" });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    if (r1.success && r2.success) expect(r2.id).toBe(r1.id);
    expect(payments).toHaveLength(1);
  });

  it("3. Promise.all with the same key -> only one payment", async () => {
    const { addProviderPaymentAction } = await import("../actions");
    const [r1, r2] = await Promise.all([
      addProviderPaymentAction("pol-1", { paymentDate: "2026-08-01", amount: 50000, idempotencyKey: "p-key-3" }),
      addProviderPaymentAction("pol-1", { paymentDate: "2026-08-01", amount: 50000, idempotencyKey: "p-key-3" }),
    ]);
    expect([r1.success, r2.success]).toEqual([true, true]);
    expect(payments).toHaveLength(1);
  });

  it("4. a different key allows a second, legitimate payment of the same amount", async () => {
    const { addProviderPaymentAction } = await import("../actions");
    await addProviderPaymentAction("pol-1", { paymentDate: "2026-08-01", amount: 50000, idempotencyKey: "p-key-4a" });
    await addProviderPaymentAction("pol-1", { paymentDate: "2026-08-01", amount: 50000, idempotencyKey: "p-key-4b" });
    expect(payments).toHaveLength(2);
  });
});
