import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { config as loadDotenv } from "dotenv";

loadDotenv();

// Phase 12C — real-Postgres end-to-end for the Motor vehicle-valuation
// workflow via the ACTUAL createMotorRecordAction / updateMotorOverviewAction
// (real prisma; only auth + next-cache stubbed). Seeds + cleans up its own
// rows. Skips when no DB is reachable.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

let dbReachable = true;
let prisma: typeof import("@/lib/prisma").prisma;
let createMotorRecordAction: typeof import("@/app/(app)/policy/motor/actions").createMotorRecordAction;
let updateMotorOverviewAction: typeof import("@/app/(app)/policy/motor/actions").updateMotorOverviewAction;
let auth: ReturnType<typeof vi.fn>;

const TAG = `p12c-${randomUUID().slice(0, 8)}`;
let userId = "";
let customerId = "";
const createdRecordIds: string[] = [];

const EDIT_USER = { id: "", role: "Staff", status: "ACTIVE", permissions: ["policy.motor.edit"] };
const VIEW_USER = { id: "", role: "Staff", status: "ACTIVE", permissions: ["policy.motor.view"] };

function baseInput(overrides: Record<string, unknown>) {
  return {
    processingDate: "2026-09-05",
    customerId,
    insuranceType: "COMPREHENSIVE",
    registrationNumber: `${TAG}-KAA`,
    taxClass: "PRIVATE",
    effectiveDate: "2026-09-05",
    expiryDate: "2026-10-04",
    customerPremium: 5000,
    insurerCost: 4000,
    ...overrides,
  } as Parameters<typeof createMotorRecordAction>[0];
}

async function create(overrides: Record<string, unknown>) {
  auth.mockResolvedValue({ user: EDIT_USER });
  const res = await createMotorRecordAction(baseInput(overrides));
  if (res.success) createdRecordIds.push(res.id);
  return res;
}

async function detailOf(id: string) {
  const rec = await prisma.policyRecord.findUniqueOrThrow({ where: { id }, include: { motorDetail: true } });
  return rec;
}

beforeAll(async () => {
  try {
    ({ prisma } = await import("@/lib/prisma"));
    ({ createMotorRecordAction, updateMotorOverviewAction } = await import("@/app/(app)/policy/motor/actions"));
    ({ auth } = (await import("@/lib/auth")) as unknown as { auth: ReturnType<typeof vi.fn> });
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("motorValuation.integration.test: no reachable database — skipping.", err);
    dbReachable = false;
    return;
  }
  const user = await prisma.user.create({ data: { username: `${TAG}-u`, fullName: `${TAG} user`, passwordHash: "x", status: "ACTIVE" } });
  userId = user.id;
  EDIT_USER.id = user.id;
  VIEW_USER.id = user.id;
  const customer = await prisma.customer.create({ data: { customerNumber: `${TAG}-C`, companyName: `${TAG} Co`, pinNumber: `${TAG}-PIN` } });
  customerId = customer.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  await prisma.policyRecord.deleteMany({ where: { recordNumber: { startsWith: "PM" }, motorDetail: { registrationNumber: { startsWith: TAG } } } });
  await prisma.policyRecord.deleteMany({ where: { id: { in: createdRecordIds } } });
  await prisma.customer.deleteMany({ where: { customerNumber: { startsWith: TAG } } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
});

describe("Motor vehicle valuation — create/edit (real DB)", () => {
  it("C1: THIRD PARTY -> valuationStatus stays null even if a status is sent", async () => {
    if (!dbReachable) return;
    const res = await create({ insuranceType: "THIRD PARTY", registrationNumber: `${TAG}-TP1`, valuationStatus: "IN_PROGRESS", assessedVehicleValue: 999 });
    expect(res.success).toBe(true);
    if (!res.success) return;
    const d = await detailOf(res.id);
    expect(d.motorDetail?.valuationStatus).toBeNull();
    expect(d.motorDetail?.assessedVehicleValue).toBeNull();
  });

  it("C2: COMPREHENSIVE with no status -> defaults to NOT_ARRANGED", async () => {
    if (!dbReachable) return;
    const res = await create({ registrationNumber: `${TAG}-C2` });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect((await detailOf(res.id)).motorDetail?.valuationStatus).toBe("NOT_ARRANGED");
  });

  it("C3: COMPREHENSIVE created with IN_PROGRESS + assessed value", async () => {
    if (!dbReachable) return;
    const res = await create({ registrationNumber: `${TAG}-C3`, valuationStatus: "IN_PROGRESS", assessedVehicleValue: 1200000 });
    expect(res.success).toBe(true);
    if (!res.success) return;
    const d = await detailOf(res.id);
    expect(d.motorDetail?.valuationStatus).toBe("IN_PROGRESS");
    expect(Number(d.motorDetail?.assessedVehicleValue)).toBe(1200000);
  });

  it("C4/C5/C6/C7: edit NOT_ARRANGED -> IN_PROGRESS -> COMPLETED; business status untouched; ACTIVE + NOT_ARRANGED coexist", async () => {
    if (!dbReachable) return;
    // Effective in the past, expiry ~1 month out -> business status ACTIVE.
    const res = await create({ registrationNumber: `${TAG}-C4`, effectiveDate: "2026-09-01", expiryDate: "2099-12-31" });
    expect(res.success).toBe(true);
    if (!res.success) return;
    const before = await detailOf(res.id);
    expect(before.businessStatus).toBe("ACTIVE"); // C7 — ACTIVE with valuation NOT_ARRANGED
    expect(before.motorDetail?.valuationStatus).toBe("NOT_ARRANGED");

    auth.mockResolvedValue({ user: EDIT_USER });
    const editBase = {
      processingDate: "2026-09-05", customerId, projectId: null,
      insuranceType: "COMPREHENSIVE", registrationNumber: `${TAG}-C4`, taxClass: "PRIVATE",
      vehicleValue: null, vehicleMake: null, vehicleModel: null, insurerName: null, policyNumber: null,
      effectiveDate: "2026-09-01", expiryDate: "2099-12-31", customerPremium: 5000, insurerCost: 4000,
      remarks: null, customerContactPerson: null, cancelled: false,
    };

    const r1 = await updateMotorOverviewAction(res.id, { ...editBase, valuationStatus: "IN_PROGRESS" });
    expect(r1.success).toBe(true);
    expect((await detailOf(res.id)).motorDetail?.valuationStatus).toBe("IN_PROGRESS");

    const r2 = await updateMotorOverviewAction(res.id, { ...editBase, valuationStatus: "COMPLETED" });
    expect(r2.success).toBe(true);
    const afterComplete = await detailOf(res.id);
    expect(afterComplete.motorDetail?.valuationStatus).toBe("COMPLETED");
    // C6 — business status is still ACTIVE, never touched by valuation.
    expect(afterComplete.businessStatus).toBe(before.businessStatus);

    // Backwards edit is allowed (spec §5) — COMPLETED -> IN_PROGRESS.
    const r3 = await updateMotorOverviewAction(res.id, { ...editBase, valuationStatus: "IN_PROGRESS" });
    expect(r3.success).toBe(true);
    expect((await detailOf(res.id)).motorDetail?.valuationStatus).toBe("IN_PROGRESS");

    // Editing cover type away from Comprehensive clears the valuation.
    const r4 = await updateMotorOverviewAction(res.id, { ...editBase, insuranceType: "THIRD PARTY", valuationStatus: "IN_PROGRESS" });
    expect(r4.success).toBe(true);
    expect((await detailOf(res.id)).motorDetail?.valuationStatus).toBeNull();
  });

  it("C25: a VIEW-only policy.motor user cannot create or edit valuation state", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: VIEW_USER });
    const cRes = await createMotorRecordAction(baseInput({ registrationNumber: `${TAG}-VO` }));
    expect(cRes).toEqual({ success: false, error: "FORBIDDEN" });

    // And editing an existing record.
    auth.mockResolvedValue({ user: EDIT_USER });
    const seed = await create({ registrationNumber: `${TAG}-VO2` });
    expect(seed.success).toBe(true);
    if (!seed.success) return;
    auth.mockResolvedValue({ user: VIEW_USER });
    const eRes = await updateMotorOverviewAction(seed.id, {
      processingDate: "2026-09-05", customerId, projectId: null,
      insuranceType: "COMPREHENSIVE", registrationNumber: `${TAG}-VO2`, taxClass: "PRIVATE",
      vehicleValue: null, vehicleMake: null, vehicleModel: null, insurerName: null, policyNumber: null,
      effectiveDate: "2026-09-05", expiryDate: "2026-10-04", customerPremium: 5000, insurerCost: 4000,
      remarks: null, customerContactPerson: null, valuationStatus: "COMPLETED", cancelled: false,
    });
    expect(eRes).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("C23: a historical MotorPolicyDetail row (valuationStatus null) is a valid, loadable record", async () => {
    if (!dbReachable) return;
    // Simulate a pre-12C row by nulling the column directly.
    const res = await create({ registrationNumber: `${TAG}-HIST` });
    expect(res.success).toBe(true);
    if (!res.success) return;
    await prisma.motorPolicyDetail.update({ where: { policyRecordId: res.id }, data: { valuationStatus: null, assessedVehicleValue: null } });
    const d = await detailOf(res.id);
    expect(d.motorDetail?.valuationStatus).toBeNull();
    expect(d.recordNumber).toMatch(/^PM/);
  });
});
