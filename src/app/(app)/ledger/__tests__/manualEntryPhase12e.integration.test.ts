import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { config as loadDotenv } from "dotenv";

loadDotenv();

// Phase 12E — real-Postgres tests for the Manual Ledger entry upgrades:
// counterparty, standard payment method dropdown + server validation,
// leaf-only category selection, deactivation hiding a subtree, and legacy
// payment-method compatibility.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

let dbReachable = true;
let prisma: typeof import("@/lib/prisma").prisma;
let actions: typeof import("@/app/(app)/ledger/actions");
let auth: ReturnType<typeof vi.fn>;

const TAG = `p12e-me-${randomUUID().slice(0, 8)}`;
let userId = "";
const EDIT_USER = { id: "", role: "Staff", status: "ACTIVE", permissions: ["ledger.manual_record.edit"] };

let rootId = "";
let branchId = "";
let leafId = "";
let leaf2Id = "";

const key = () => randomUUID();

async function createEntry(overrides: Record<string, unknown>) {
  auth.mockResolvedValue({ user: EDIT_USER });
  return actions.createManualEntryAction({
    transactionDate: "2026-09-06",
    transactionType: "EXPENSE",
    categoryId: leafId,
    amount: 500,
    idempotencyKey: key(),
    ...overrides,
  });
}
async function entryRow(id: string) {
  return prisma.ledgerManualEntry.findUniqueOrThrow({ where: { id } });
}

beforeAll(async () => {
  try {
    ({ prisma } = await import("@/lib/prisma"));
    actions = await import("@/app/(app)/ledger/actions");
    ({ auth } = (await import("@/lib/auth")) as unknown as { auth: ReturnType<typeof vi.fn> });
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("manualEntryPhase12e.integration.test: no reachable database — skipping.", err);
    dbReachable = false;
    return;
  }
  const user = await prisma.user.create({ data: { username: `${TAG}-u`, fullName: `${TAG} user`, passwordHash: "x", status: "ACTIVE" } });
  userId = user.id;
  EDIT_USER.id = user.id;

  // EXPENSE root -> branch -> leaf ; plus a second leaf directly under root.
  const root = await prisma.ledgerCategory.create({ data: { name: `${TAG} Root`, transactionType: "EXPENSE", createdById: userId } });
  rootId = root.id;
  const branch = await prisma.ledgerCategory.create({ data: { name: `${TAG} Branch`, transactionType: "EXPENSE", parentId: rootId, createdById: userId } });
  branchId = branch.id;
  const leaf = await prisma.ledgerCategory.create({ data: { name: `${TAG} Leaf`, transactionType: "EXPENSE", parentId: branchId, createdById: userId } });
  leafId = leaf.id;
  const leaf2 = await prisma.ledgerCategory.create({ data: { name: `${TAG} Leaf2`, transactionType: "EXPENSE", parentId: rootId, createdById: userId } });
  leaf2Id = leaf2.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  await prisma.ledgerManualEntry.deleteMany({ where: { createdById: userId } });
  for (let i = 0; i < 6; i++) {
    const res = await prisma.ledgerCategory.deleteMany({ where: { name: { startsWith: TAG }, children: { none: {} } } });
    if (res.count === 0) break;
  }
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
});

describe("Phase 12E — Manual Ledger entry (real DB)", () => {
  it("X.19 / X.20: counterparty is saved trimmed; blank becomes NULL", async () => {
    if (!dbReachable) return;
    const withCp = await createEntry({ counterpartyName: "  IAA Insurance  " });
    expect(withCp.success).toBe(true);
    if (withCp.success) expect((await entryRow(withCp.id)).counterpartyName).toBe("IAA Insurance");

    const blank = await createEntry({ counterpartyName: "   " });
    expect(blank.success).toBe(true);
    if (blank.success) expect((await entryRow(blank.id)).counterpartyName).toBeNull();
  });

  it("X.32-35: each standard payment method persists as its canonical token", async () => {
    if (!dbReachable) return;
    for (const method of ["MPESA", "BANK_TRANSFER", "CHEQUE", "CASH"]) {
      const res = await createEntry({ paymentMethod: method });
      expect(res.success).toBe(true);
      if (res.success) expect((await entryRow(res.id)).paymentMethod).toBe(method);
    }
  });

  it("X.36: a hand-crafted non-standard payment method is rejected server-side", async () => {
    if (!dbReachable) return;
    const res = await createEntry({ paymentMethod: "BANK TRANSFER" }); // display form, not the token
    expect(res).toEqual({ success: false, error: "PAYMENT_METHOD_INVALID" });
    const res2 = await createEntry({ paymentMethod: "PayPal" });
    expect(res2).toEqual({ success: false, error: "PAYMENT_METHOD_INVALID" });
  });

  it("category picker is leaf-only for new entries (X: 'Leaf category required')", async () => {
    if (!dbReachable) return;
    expect(await createEntry({ categoryId: rootId })).toEqual({ success: false, error: "CATEGORY_NOT_LEAF" });
    expect(await createEntry({ categoryId: branchId })).toEqual({ success: false, error: "CATEGORY_NOT_LEAF" });
    expect((await createEntry({ categoryId: leafId })).success).toBe(true);
  });

  it("X.14 / X.15: deactivating a parent blocks new entries on its subtree; the existing entry is untouched", async () => {
    if (!dbReachable) return;
    const before = await createEntry({ categoryId: leafId, counterpartyName: "KPLC" });
    expect(before.success).toBe(true);

    auth.mockResolvedValue({ user: EDIT_USER });
    await actions.updateLedgerCategoryAction(branchId, { isActive: false });

    // new entry on the now-hidden leaf is rejected
    expect(await createEntry({ categoryId: leafId })).toEqual({ success: false, error: "CATEGORY_INACTIVE" });

    // the pre-existing row still loads unchanged
    if (before.success) {
      const row = await entryRow(before.id);
      expect(row.categoryId).toBe(leafId);
      expect(row.counterpartyName).toBe("KPLC");
    }

    // editing that historical row (keeping its category) still works
    if (before.success) {
      const edit = await actions.updateManualEntryAction(before.id, {
        transactionDate: "2026-09-07",
        transactionType: "EXPENSE",
        categoryId: leafId,
        amount: 650,
      });
      expect(edit.success).toBe(true);
    }
    // restore for other tests
    await actions.updateLedgerCategoryAction(branchId, { isActive: true });
  });

  it("X.37 / X.38 / X.39: a legacy payment method renders, edits without crashing, and is not silently overwritten", async () => {
    if (!dbReachable) return;
    const seed = await createEntry({ categoryId: leaf2Id, paymentMethod: "MPESA" });
    expect(seed.success).toBe(true);
    if (!seed.success) return;
    // Simulate a pre-12E row carrying a free-text value.
    await prisma.ledgerManualEntry.update({ where: { id: seed.id }, data: { paymentMethod: "M-Pesa (till)" } });

    // an unrelated edit that re-submits the SAME legacy value keeps it as-is
    const unrelated = await actions.updateManualEntryAction(seed.id, {
      transactionDate: "2026-09-08",
      transactionType: "EXPENSE",
      categoryId: leaf2Id,
      amount: 999,
      paymentMethod: "M-Pesa (till)",
    });
    expect(unrelated.success).toBe(true);
    expect((await entryRow(seed.id)).paymentMethod).toBe("M-Pesa (till)");

    // intentionally choosing a standard option DOES change it
    const changed = await actions.updateManualEntryAction(seed.id, {
      transactionDate: "2026-09-08",
      transactionType: "EXPENSE",
      categoryId: leaf2Id,
      amount: 999,
      paymentMethod: "CASH",
    });
    expect(changed.success).toBe(true);
    expect((await entryRow(seed.id)).paymentMethod).toBe("CASH");

    // changing to another non-standard value is rejected
    const bad = await actions.updateManualEntryAction(seed.id, {
      transactionDate: "2026-09-08",
      transactionType: "EXPENSE",
      categoryId: leaf2Id,
      amount: 999,
      paymentMethod: "Something Else",
    });
    expect(bad).toEqual({ success: false, error: "PAYMENT_METHOD_INVALID" });
  });
});
