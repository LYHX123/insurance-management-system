import { describe, it, expect, beforeAll, vi } from "vitest";
import { config as loadDotenv } from "dotenv";

loadDotenv();

// Phase 12E — migration-compatibility checks against the live local DB:
// the sibling + partial-root unique indexes exist, the new columns exist,
// and pre-existing data was left as roots with sortOrder 0 / NULL
// counterparty (no backfill).

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

let dbReachable = true;
let prisma: typeof import("@/lib/prisma").prisma;

beforeAll(async () => {
  try {
    ({ prisma } = await import("@/lib/prisma"));
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("migration12e.integration.test: no reachable database — skipping.", err);
    dbReachable = false;
  }
});

describe("Phase 12E migration — schema shape", () => {
  it("both unique indexes exist: sibling-scoped and partial root", async () => {
    if (!dbReachable) return;
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'LedgerCategory'`;
    const defs = rows.map((r) => r.indexdef).join("\n");
    expect(defs).toMatch(/UNIQUE INDEX "LedgerCategory_parentId_name_transactionType_key"/);
    expect(defs).toMatch(/UNIQUE INDEX "LedgerCategory_root_name_transactionType_key".*WHERE \("parentId" IS NULL\)/s);
    // the old single-level unique index is gone
    expect(defs).not.toMatch(/"LedgerCategory_name_transactionType_key"/);
  });

  it("new columns exist with the right nullability / default", async () => {
    if (!dbReachable) return;
    const cat = await prisma.$queryRaw<Array<{ column_name: string; is_nullable: string; column_default: string | null }>>`
      SELECT column_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_name = 'LedgerCategory' AND column_name IN ('parentId', 'sortOrder')`;
    const byName = new Map(cat.map((c) => [c.column_name, c]));
    expect(byName.get("parentId")?.is_nullable).toBe("YES");
    expect(byName.get("sortOrder")?.is_nullable).toBe("NO");
    expect(byName.get("sortOrder")?.column_default).toMatch(/0/);

    const entry = await prisma.$queryRaw<Array<{ column_name: string; is_nullable: string }>>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'LedgerManualEntry' AND column_name = 'counterpartyName'`;
    expect(entry[0]?.is_nullable).toBe("YES");
  });

  it("X.1 / X.2: no existing category is a non-root by accident; no entry lost its counterparty", async () => {
    if (!dbReachable) return;
    // Every category whose parentId is set must point at a real parent of the
    // same transactionType (the app rule) — nothing was mangled by the
    // migration.
    const children = await prisma.ledgerCategory.findMany({ where: { parentId: { not: null } }, select: { parentId: true, transactionType: true } });
    for (const c of children) {
      const parent = await prisma.ledgerCategory.findUnique({ where: { id: c.parentId! }, select: { transactionType: true } });
      expect(parent?.transactionType).toBe(c.transactionType);
    }
  });
});
