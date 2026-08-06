import { describe, it, expect, vi, beforeEach } from "vitest";

// Production Readiness Audit V1, finding H6: createManualEntryAction now
// requires an idempotencyKey and atomically claims it inside the same
// transaction that creates the entry.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "user-1", role: "Staff", status: "ACTIVE", permissions: ["ledger.manual_record.edit"] } })),
}));

type ClaimRow = { key: string; scope: string; resourceId: string };
type EntryRow = { id: string; amount: string; categoryId: string };

let claims: Map<string, ClaimRow>;
let entries: EntryRow[];
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
    ledgerManualEntry: {
      create: vi.fn(async ({ data }: { data: { categoryId: string; amount: unknown } }) => {
        idCounter += 1;
        const row: EntryRow = { id: `entry-${idCounter}`, categoryId: data.categoryId, amount: String(data.amount) };
        entries.push(row);
        return row;
      }),
    },
  };
}

let txQueue: Promise<unknown> = Promise.resolve();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ledgerCategory: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "cat-1" ? { id: "cat-1", name: "Office Supplies", transactionType: "EXPENSE", isActive: true } : null
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

const baseInput = { transactionDate: "2026-08-01", transactionType: "EXPENSE", categoryId: "cat-1" };

describe("createManualEntryAction — H6 idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txQueue = Promise.resolve();
    idCounter = 0;
    claims = new Map();
    entries = [];
  });

  it("1. a normal entry is created successfully", async () => {
    const { createManualEntryAction } = await import("../actions");
    const result = await createManualEntryAction({ ...baseInput, amount: 5000, idempotencyKey: "m-key-1" });
    expect(result.success).toBe(true);
    expect(entries).toHaveLength(1);
  });

  it("2. the same key submitted twice (double-click / retry) creates only one entry", async () => {
    const { createManualEntryAction } = await import("../actions");
    const r1 = await createManualEntryAction({ ...baseInput, amount: 5000, idempotencyKey: "m-key-2" });
    const r2 = await createManualEntryAction({ ...baseInput, amount: 5000, idempotencyKey: "m-key-2" });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    if (r1.success && r2.success) expect(r2.id).toBe(r1.id);
    expect(entries).toHaveLength(1);
  });

  it("3. Promise.all with the same key -> only one entry", async () => {
    const { createManualEntryAction } = await import("../actions");
    const [r1, r2] = await Promise.all([
      createManualEntryAction({ ...baseInput, amount: 5000, idempotencyKey: "m-key-3" }),
      createManualEntryAction({ ...baseInput, amount: 5000, idempotencyKey: "m-key-3" }),
    ]);
    expect([r1.success, r2.success]).toEqual([true, true]);
    expect(entries).toHaveLength(1);
  });

  it("4. a different key allows a second, legitimate entry of the same amount", async () => {
    const { createManualEntryAction } = await import("../actions");
    await createManualEntryAction({ ...baseInput, amount: 5000, idempotencyKey: "m-key-4a" });
    await createManualEntryAction({ ...baseInput, amount: 5000, idempotencyKey: "m-key-4b" });
    expect(entries).toHaveLength(2);
  });

  it("a missing idempotency key is rejected before any write", async () => {
    const { createManualEntryAction } = await import("../actions");
    const result = await createManualEntryAction({ ...baseInput, amount: 5000, idempotencyKey: "" });
    expect(result).toEqual({ success: false, error: "IDEMPOTENCY_KEY_REQUIRED" });
    expect(entries).toHaveLength(0);
  });

  it("H5's non-finite amount validation still runs before idempotency claiming", async () => {
    const { createManualEntryAction } = await import("../actions");
    const result = await createManualEntryAction({ ...baseInput, amount: NaN, idempotencyKey: "m-key-5" });
    expect(result).toEqual({ success: false, error: "AMOUNT_INVALID" });
    expect(claims.size).toBe(0);
  });

  it("VIEW-only cannot create a manual entry", async () => {
    const { auth } = await import("@/lib/auth");
    (auth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "user-1", role: "Staff", status: "ACTIVE", permissions: ["ledger.manual_record.view"] },
    });
    const { createManualEntryAction } = await import("../actions");
    const result = await createManualEntryAction({ ...baseInput, amount: 5000, idempotencyKey: "m-key-6" });
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("Admin can create a manual entry", async () => {
    const { auth } = await import("@/lib/auth");
    (auth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ user: { id: "admin-1", role: "Admin", status: "ACTIVE", permissions: [] } });
    const { createManualEntryAction } = await import("../actions");
    const result = await createManualEntryAction({ ...baseInput, amount: 5000, idempotencyKey: "m-key-7" });
    expect(result.success).toBe(true);
  });
});
