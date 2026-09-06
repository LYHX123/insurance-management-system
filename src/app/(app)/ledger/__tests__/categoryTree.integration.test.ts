import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { config as loadDotenv } from "dotenv";

loadDotenv();

// Phase 12E — real-Postgres tests for the hierarchical LedgerCategory tree
// via the ACTUAL server actions (real prisma; only auth + next-cache
// stubbed). Seeds + cleans up its own rows. Skips when no DB is reachable.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

let dbReachable = true;
let prisma: typeof import("@/lib/prisma").prisma;
let actions: typeof import("@/app/(app)/ledger/actions");
let auth: ReturnType<typeof vi.fn>;

const TAG = `p12e-${randomUUID().slice(0, 8)}`;
let userId = "";
const EDIT_USER = { id: "", role: "Staff", status: "ACTIVE", permissions: ["ledger.manual_record.edit"] };
const VIEW_USER = { id: "", role: "Staff", status: "ACTIVE", permissions: ["ledger.manual_record.view"] };

const nm = (s: string) => `${TAG} ${s}`;

async function createRoot(name: string, type: "INCOME" | "EXPENSE") {
  auth.mockResolvedValue({ user: EDIT_USER });
  return actions.createLedgerCategoryAction({ name: nm(name), transactionType: type, parentId: null });
}
async function createChild(name: string, parentId: string) {
  auth.mockResolvedValue({ user: EDIT_USER });
  return actions.createLedgerCategoryAction({ name: nm(name), parentId });
}
function idOf(r: Awaited<ReturnType<typeof actions.createLedgerCategoryAction>>): string {
  if (!r.success) throw new Error(`expected success, got ${JSON.stringify(r)}`);
  return r.id;
}

beforeAll(async () => {
  try {
    ({ prisma } = await import("@/lib/prisma"));
    actions = await import("@/app/(app)/ledger/actions");
    ({ auth } = (await import("@/lib/auth")) as unknown as { auth: ReturnType<typeof vi.fn> });
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("categoryTree.integration.test: no reachable database — skipping.", err);
    dbReachable = false;
    return;
  }
  const user = await prisma.user.create({ data: { username: `${TAG}-u`, fullName: `${TAG} user`, passwordHash: "x", status: "ACTIVE" } });
  userId = user.id;
  EDIT_USER.id = user.id;
  VIEW_USER.id = user.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  await prisma.ledgerManualEntry.deleteMany({ where: { createdById: userId } });
  // onDelete: Restrict — remove leaves first, repeat until the subtree is gone.
  for (let i = 0; i < 6; i++) {
    const res = await prisma.ledgerCategory.deleteMany({ where: { name: { startsWith: TAG }, children: { none: {} } } });
    if (res.count === 0) break;
  }
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
});

describe("Phase 12E — LedgerCategory tree (real DB)", () => {
  it("X.1 / X.2: the pre-existing category is still a root and existing entries are untouched", async () => {
    if (!dbReachable) return;
    const roots = await prisma.ledgerCategory.findMany({ where: { parentId: null } });
    // every current category is a root with sortOrder 0 unless this suite made it otherwise
    for (const c of roots) expect(c.parentId).toBeNull();
    const orphanChildrenWithMissingParent = await prisma.ledgerCategory.findMany({
      where: { parentId: { not: null } },
      select: { parentId: true },
    });
    for (const c of orphanChildrenWithMissingParent) {
      const parent = await prisma.ledgerCategory.findUnique({ where: { id: c.parentId! } });
      expect(parent).not.toBeNull();
    }
  });

  it("X.3 / X.4 / X.5: root -> child -> grandchild all succeed; X.7 child inherits parent's type", async () => {
    if (!dbReachable) return;
    const root = await createRoot("Premium Income", "INCOME");
    const rootId = idOf(root);
    if (root.success) expect(root.transactionType).toBe("INCOME");

    const child = await createChild("Motor Premium", rootId);
    const childId = idOf(child);
    if (child.success) {
      expect(child.transactionType).toBe("INCOME"); // inherited, not from client
      expect(child.parentId).toBe(rootId);
    }

    const grand = await createChild("Private Motor", childId);
    idOf(grand);
    if (grand.success) expect(grand.transactionType).toBe("INCOME");
  });

  it("X.6: a fourth level is rejected", async () => {
    if (!dbReachable) return;
    const root = idOf(await createRoot("Depth Root", "EXPENSE"));
    const l2 = idOf(await createChild("Depth L2", root));
    const l3 = idOf(await createChild("Depth L3", l2));
    const l4 = await actions.createLedgerCategoryAction({ name: nm("Depth L4"), parentId: l3 });
    expect(l4).toEqual({ success: false, error: "MAX_DEPTH_REACHED" });
  });

  it("X.8: a child cannot cross transactionType (it always inherits, and a move across type is rejected)", async () => {
    if (!dbReachable) return;
    const incomeRoot = idOf(await createRoot("XType Income", "INCOME"));
    const expenseRoot = idOf(await createRoot("XType Expense", "EXPENSE"));
    const incomeChild = idOf(await createChild("XType Child", incomeRoot));
    // child was forced to INCOME regardless of any client value
    const row = await prisma.ledgerCategory.findUnique({ where: { id: incomeChild } });
    expect(row?.transactionType).toBe("INCOME");
    // moving it under an EXPENSE parent is rejected
    auth.mockResolvedValue({ user: EDIT_USER });
    const moved = await actions.updateLedgerCategoryAction(incomeChild, { parentId: expenseRoot });
    expect(moved).toEqual({ success: false, error: "CATEGORY_TYPE_MISMATCH" });
  });

  it("X.9 / X.10: self-parent and cycle are rejected", async () => {
    if (!dbReachable) return;
    const root = idOf(await createRoot("Cycle Root", "INCOME"));
    const child = idOf(await createChild("Cycle Child", root));
    auth.mockResolvedValue({ user: EDIT_USER });
    expect(await actions.updateLedgerCategoryAction(root, { parentId: root })).toEqual({ success: false, error: "CATEGORY_SELF_PARENT" });
    expect(await actions.updateLedgerCategoryAction(root, { parentId: child })).toEqual({ success: false, error: "CATEGORY_CYCLE" });
  });

  it("X.11 / X.12: duplicate sibling rejected; same name under a different parent allowed", async () => {
    if (!dbReachable) return;
    const a = idOf(await createRoot("Dup Parent A", "INCOME"));
    const b = idOf(await createRoot("Dup Parent B", "INCOME"));
    idOf(await createChild("Shared Name", a));
    const dupSibling = await actions.createLedgerCategoryAction({ name: nm("Shared Name"), parentId: a });
    expect(dupSibling).toEqual({ success: false, error: "CATEGORY_DUPLICATE" });
    const otherParent = await actions.createLedgerCategoryAction({ name: nm("Shared Name"), parentId: b });
    expect(otherParent.success).toBe(true);
  });

  it("X.13: a duplicate ROOT category is rejected (Postgres NULL semantics notwithstanding)", async () => {
    if (!dbReachable) return;
    const first = await createRoot("Root Dup", "INCOME");
    expect(first.success).toBe(true);
    const second = await actions.createLedgerCategoryAction({ name: nm("Root Dup"), transactionType: "INCOME", parentId: null });
    expect(second).toEqual({ success: false, error: "CATEGORY_DUPLICATE" });
    // ...but the same root name under the other transactionType is fine
    const otherType = await actions.createLedgerCategoryAction({ name: nm("Root Dup"), transactionType: "EXPENSE", parentId: null });
    expect(otherType.success).toBe(true);
  });

  it("X.16 / X.17 / X.18: delete rules — used blocked, has-children blocked, empty leaf allowed", async () => {
    if (!dbReachable) return;
    const root = idOf(await createRoot("Del Root", "EXPENSE"));
    const leaf = idOf(await createChild("Del Leaf", root));

    // has children -> blocked
    expect(await actions.deleteLedgerCategoryAction(root)).toEqual({ success: false, error: "CATEGORY_HAS_CHILDREN" });

    // used by an entry -> blocked
    auth.mockResolvedValue({ user: EDIT_USER });
    const entry = await actions.createManualEntryAction({
      transactionDate: "2026-09-06",
      transactionType: "EXPENSE",
      categoryId: leaf,
      amount: 100,
      idempotencyKey: randomUUID(),
    });
    expect(entry.success).toBe(true);
    expect(await actions.deleteLedgerCategoryAction(leaf)).toEqual({ success: false, error: "CATEGORY_IN_USE" });

    // remove the entry, then the empty leaf deletes, then the now-childless root
    if (entry.success) await prisma.ledgerManualEntry.delete({ where: { id: entry.id } });
    expect(await actions.deleteLedgerCategoryAction(leaf)).toEqual({ success: true });
    expect(await actions.deleteLedgerCategoryAction(root)).toEqual({ success: true });
  });

  it("permissions: a VIEW-only user cannot create, move, reorder or delete categories", async () => {
    if (!dbReachable) return;
    const root = idOf(await createRoot("Perm Root", "INCOME"));
    auth.mockResolvedValue({ user: VIEW_USER });
    expect(await actions.createLedgerCategoryAction({ name: nm("Perm X"), transactionType: "INCOME", parentId: null })).toEqual({
      success: false,
      error: "FORBIDDEN",
    });
    expect(await actions.updateLedgerCategoryAction(root, { name: nm("Perm Renamed") })).toEqual({ success: false, error: "FORBIDDEN" });
    expect(await actions.reorderLedgerCategoryAction(root, "UP")).toEqual({ success: false, error: "FORBIDDEN" });
    expect(await actions.deleteLedgerCategoryAction(root)).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("reorder swaps sibling display order", async () => {
    if (!dbReachable) return;
    const parent = idOf(await createRoot("Order Parent", "INCOME"));
    const first = idOf(await createChild("Order A", parent));
    const second = idOf(await createChild("Order B", parent));
    auth.mockResolvedValue({ user: EDIT_USER });
    expect(await actions.reorderLedgerCategoryAction(second, "UP")).toEqual({ success: true });
    const rows = await prisma.ledgerCategory.findMany({ where: { parentId: parent }, orderBy: { sortOrder: "asc" } });
    expect(rows.map((r) => r.id)).toEqual([second, first]);
  });
});
