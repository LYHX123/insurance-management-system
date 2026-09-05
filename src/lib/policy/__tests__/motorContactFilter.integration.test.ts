import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { config as loadDotenv } from "dotenv";

// vitest does not auto-load .env — do it before anything imports the real
// @/lib/prisma client (same pattern as readState.dualUser.integration.test.ts).
loadDotenv();

// Phase 12A — real-Postgres combination test for the Motor list's Contact
// Person + Expiry-range filters. Exercises the ACTUAL query the list page
// runs (prisma.policyRecord.findMany with category MOTOR + the where
// fragment from buildMotorListFilterWhere), not a mock, so the ILIKE
// semantics ("John" -> "John Kamau", case-insensitive) and cross-filter
// composition are validated for real. Skips itself (does not fail) when no
// database is reachable.

let dbReachable = true;
let prisma: typeof import("@/lib/prisma").prisma;
let buildMotorListFilterWhere: typeof import("@/lib/policy/motorListFilters").buildMotorListFilterWhere;

const TAG = `p12a-contact-${randomUUID().slice(0, 8)}`;
let customerId = "";
let userId = "";
const createdRecordIds: string[] = [];

// recordNumber -> { contact, expiry, insurer }
const FIXTURES = [
  { rec: `${TAG}-A`, contact: "John Kamau", expiry: "2026-09-10", insurer: "AAR Insurance" },
  { rec: `${TAG}-B`, contact: "john", expiry: "2026-09-30", insurer: "Jubilee" },
  { rec: `${TAG}-C`, contact: "Mr JOHN Otieno", expiry: "2026-12-15", insurer: "AAR Insurance" },
  { rec: `${TAG}-D`, contact: "Alice Wanjiru", expiry: "2026-09-20", insurer: "Jubilee" },
  { rec: `${TAG}-E`, contact: null, expiry: "2026-09-25", insurer: "Jubilee" },
];

async function runQuery(params: Parameters<typeof buildMotorListFilterWhere>[0]) {
  const rows = await prisma.policyRecord.findMany({
    where: { category: "MOTOR", deletedAt: null, recordNumber: { startsWith: TAG }, ...buildMotorListFilterWhere(params) },
    select: { recordNumber: true },
  });
  return rows.map((r) => r.recordNumber.replace(`${TAG}-`, "")).sort();
}

beforeAll(async () => {
  try {
    ({ prisma } = await import("@/lib/prisma"));
    ({ buildMotorListFilterWhere } = await import("@/lib/policy/motorListFilters"));
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("motorContactFilter.integration.test: no reachable database — skipping.", err);
    dbReachable = false;
    return;
  }

  const user = await prisma.user.create({
    data: { username: `${TAG}-u`, fullName: `${TAG} user`, passwordHash: "x", status: "ACTIVE" },
  });
  userId = user.id;
  const customer = await prisma.customer.create({
    data: {
      customerNumber: `${TAG}-C1`,
      companyName: `${TAG} Co`,
      pinNumber: `${TAG}-PIN`,
    },
  });
  customerId = customer.id;

  for (const f of FIXTURES) {
    const record = await prisma.policyRecord.create({
      data: {
        recordNumber: f.rec,
        category: "MOTOR",
        processingDate: new Date("2026-01-01"),
        customerId,
        insurerName: f.insurer,
        effectiveDate: new Date("2026-01-01"),
        expiryDate: new Date(f.expiry),
        customerPremium: 1000,
        insurerCost: 800,
        customerContactPerson: f.contact,
        createdById: userId,
        motorDetail: { create: { insuranceType: "COMPREHENSIVE", registrationNumber: f.rec } },
      },
    });
    createdRecordIds.push(record.id);
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  await prisma.policyRecord.deleteMany({ where: { id: { in: createdRecordIds } } });
  if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
});

describe("Motor list — Contact Person + Expiry filters (real DB)", () => {
  it("(1) records with a null contact person load normally (no filter)", async () => {
    expect(await runQuery({})).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("(7) partial match: 'John' matches 'John Kamau', 'john', 'Mr JOHN Otieno'", async () => {
    expect(await runQuery({ contact: "John" })).toEqual(["A", "B", "C"]);
  });

  it("(8) filter is case-insensitive: 'JOHN' and 'john' give the same result", async () => {
    const upper = await runQuery({ contact: "JOHN" });
    const lower = await runQuery({ contact: "john" });
    expect(upper).toEqual(["A", "B", "C"]);
    expect(lower).toEqual(upper);
  });

  it("(8) mid-string fragment matches ('kamau' -> 'John Kamau')", async () => {
    expect(await runQuery({ contact: "kamau" })).toEqual(["A"]);
  });

  it("a non-matching fragment returns nothing", async () => {
    expect(await runQuery({ contact: "Zebra" })).toEqual([]);
  });

  it("(3/6) expiry range still works on its own (inclusive end-of-day on the To date)", async () => {
    // B expires 2026-09-30 — must be included by a To of 2026-09-30.
    expect(await runQuery({ expiryFrom: "2026-09-01", expiryTo: "2026-09-30" })).toEqual(["A", "B", "D", "E"]);
  });

  it("(9) Contact Person composes (AND) with the expiry range", async () => {
    // contact ~ 'john' AND expiry in Sep 2026 -> A (Sep 10) + B (Sep 30), not C (Dec).
    expect(await runQuery({ contact: "john", expiryFrom: "2026-09-01", expiryTo: "2026-09-30" })).toEqual(["A", "B"]);
  });

  it("(9) Contact Person composes with an insurer condition supplied alongside it", async () => {
    const rows = await prisma.policyRecord.findMany({
      where: {
        category: "MOTOR",
        deletedAt: null,
        recordNumber: { startsWith: TAG },
        insurerName: "AAR Insurance",
        ...buildMotorListFilterWhere({ contact: "john" }),
      },
      select: { recordNumber: true },
    });
    expect(rows.map((r) => r.recordNumber.replace(`${TAG}-`, "")).sort()).toEqual(["A", "C"]);
  });
});
