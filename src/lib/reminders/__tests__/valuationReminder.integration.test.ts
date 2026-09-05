import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { config as loadDotenv } from "dotenv";

loadDotenv();

// Phase 12C — real-Postgres coverage for the "vehicle valuation pending"
// reminder flag, produced by the ACTUAL getMotorPolicyReminders. Seeds motor
// policies in different (coverType x valuationStatus) combinations, all near
// expiry, and checks which ones carry `valuationPending`. Skips when no DB.

let dbReachable = true;
let prisma: typeof import("@/lib/prisma").prisma;
let getMotorPolicyReminders: typeof import("@/lib/reminders/policy").getMotorPolicyReminders;

const TAG = `p12cr-${randomUUID().slice(0, 8)}`;
let userId = "";
let customerId = "";
const ids: Record<string, string> = {};

// A single fixed "now" so day-arithmetic is deterministic.
const NOW = new Date("2026-09-20T09:00:00.000Z");
const TZ = "Africa/Nairobi";

async function seed(key: string, coverType: string, valuationStatus: string | null, expiry: string) {
  const rec = await prisma.policyRecord.create({
    data: {
      recordNumber: `${TAG}-${key}`,
      category: "MOTOR",
      processingDate: new Date("2026-08-01"),
      customerId,
      effectiveDate: new Date("2026-08-25"),
      expiryDate: new Date(expiry),
      businessStatus: "ACTIVE",
      customerPremium: 1000,
      insurerCost: 800,
      createdById: userId,
      motorDetail: {
        create: {
          insuranceType: coverType,
          registrationNumber: `${TAG}${key}`,
          valuationStatus: valuationStatus as never,
        },
      },
    },
  });
  ids[key] = rec.id;
}

beforeAll(async () => {
  try {
    ({ prisma } = await import("@/lib/prisma"));
    ({ getMotorPolicyReminders } = await import("@/lib/reminders/policy"));
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("valuationReminder.integration.test: no reachable database — skipping.", err);
    dbReachable = false;
    return;
  }
  const user = await prisma.user.create({ data: { username: `${TAG}-u`, fullName: `${TAG} u`, passwordHash: "x", status: "ACTIVE" } });
  userId = user.id;
  const customer = await prisma.customer.create({ data: { customerNumber: `${TAG}-C`, companyName: `${TAG} Co`, pinNumber: `${TAG}-PIN` } });
  customerId = customer.id;

  await seed("NA", "COMPREHENSIVE", "NOT_ARRANGED", "2026-09-25"); // C16 — near expiry, pending
  await seed("IP", "COMPREHENSIVE", "IN_PROGRESS", "2026-09-25"); // C17 — near expiry, pending
  await seed("DONE", "COMPREHENSIVE", "COMPLETED", "2026-09-25"); // C18 — not pending
  await seed("TP", "THIRD PARTY", "NOT_ARRANGED", "2026-09-25"); // C19 — never pending
  await seed("HIST", "COMPREHENSIVE", null, "2026-09-25"); // historical null — not pending
  await seed("OVERDUE", "COMPREHENSIVE", "NOT_ARRANGED", "2026-09-10"); // expired + pending
});

afterAll(async () => {
  if (!dbReachable) return;
  await prisma.policyRecord.deleteMany({ where: { recordNumber: { startsWith: TAG } } });
  await prisma.customer.deleteMany({ where: { customerNumber: { startsWith: TAG } } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
});

describe("getMotorPolicyReminders — valuationPending flag (real DB)", () => {
  it("flags the right rows and only those", async () => {
    if (!dbReachable) return;
    const items = await getMotorPolicyReminders(30, TZ, NOW);
    const mine = new Map(items.filter((i) => i.recordNumber?.startsWith(TAG)).map((i) => [i.recordNumber!.replace(`${TAG}-`, ""), i]));

    // C16 / C17 — Comprehensive + NOT_ARRANGED / IN_PROGRESS near expiry.
    expect(mine.get("NA")?.valuationPending).toBe(true);
    expect(mine.get("IP")?.valuationPending).toBe(true);
    // C18 — COMPLETED: reminder still exists (near expiry) but NOT flagged.
    expect(mine.has("DONE")).toBe(true);
    expect(mine.get("DONE")?.valuationPending).toBeUndefined();
    // C19 — Third Party: never flagged.
    expect(mine.get("TP")?.valuationPending).toBeUndefined();
    // Historical null — treated as untracked, not flagged.
    expect(mine.get("HIST")?.valuationPending).toBeUndefined();
    // Overdue Comprehensive still pending -> flagged + severity expired.
    expect(mine.get("OVERDUE")?.valuationPending).toBe(true);
    expect(mine.get("OVERDUE")?.severity).toBe("expired");
  });

  it("C20: once COMPLETED, no valuation-pending flag — the normal expiry reminder still fires from the (new) expiry date", async () => {
    if (!dbReachable) return;
    // Move NA to COMPLETED and push expiry out a full year.
    await prisma.motorPolicyDetail.update({ where: { policyRecordId: ids.NA }, data: { valuationStatus: "COMPLETED" } });
    await prisma.policyRecord.update({ where: { id: ids.NA }, data: { expiryDate: new Date("2027-09-04") } });

    const near = await getMotorPolicyReminders(30, TZ, NOW);
    expect(near.find((i) => i.recordNumber === `${TAG}-NA`)).toBeUndefined(); // far out -> no reminder at all

    const wide = await getMotorPolicyReminders(400, TZ, NOW);
    const na = wide.find((i) => i.recordNumber === `${TAG}-NA`);
    expect(na).toBeDefined();
    expect(na?.valuationPending).toBeUndefined(); // COMPLETED -> plain expiry reminder only
  });
});
