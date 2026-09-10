import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { config as loadDotenv } from "dotenv";

loadDotenv();

// Phase 13D — real-Postgres end-to-end for Permanent Policy Delete via the
// ACTUAL deletePolicyRecord / delete*PolicyAction flow (real prisma; auth +
// next-cache stubbed). Seeds + cleans up its own rows. Skips when no DB is
// reachable.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
// Keep document cleanup from touching the real filesystem.
vi.mock("@/lib/policyDocuments/storage", () => ({
  policyDocumentStorage: { deleteFile: vi.fn(async () => {}) },
}));

let dbReachable = true;
let prisma: typeof import("@/lib/prisma").prisma;
let deletePolicyRecord: typeof import("@/lib/policy/deletePolicyRecord").deletePolicyRecord;
let deleteMotorPolicyAction: typeof import("@/app/(app)/policy/motor/actions").deleteMotorPolicyAction;
let updateMotorOverviewAction: typeof import("@/app/(app)/policy/motor/actions").updateMotorOverviewAction;
let generatePolicyRecordNumber: typeof import("@/lib/policy/recordNumber").generatePolicyRecordNumber;
let auth: ReturnType<typeof vi.fn>;

const TAG = `p13d-${randomUUID().slice(0, 8)}`;
let userId = "";
let customerId = "";
let otherCustomerId = "";

const MOTOR_DELETE = { id: "", role: "Staff", status: "ACTIVE", permissions: ["policy.motor.view", "policy.motor.delete"] };
const MOTOR_EDIT = { id: "", role: "Staff", status: "ACTIVE", permissions: ["policy.motor.edit"] };
const BOND_DELETE = { id: "", role: "Staff", status: "ACTIVE", permissions: ["policy.bond.delete"] };
const NON_MOTOR_DELETE = { id: "", role: "Staff", status: "ACTIVE", permissions: ["policy.non_motor.delete"] };
const WORK_PERMIT_DELETE = { id: "", role: "Staff", status: "ACTIVE", permissions: ["policy.work_permit.delete"] };

const created: string[] = [];

async function seedMotor(reg: string) {
  const rec = await prisma.policyRecord.create({
    data: {
      recordNumber: `${TAG}-${reg}`,
      category: "MOTOR",
      processingDate: new Date("2026-09-01"),
      customerId,
      insurerName: "AAR",
      effectiveDate: new Date("2026-09-05"),
      expiryDate: new Date("2026-10-04"),
      businessStatus: "ACTIVE",
      customerPremium: 5000,
      insurerCost: 4000,
      createdById: userId,
      motorDetail: {
        create: { insuranceType: "COMPREHENSIVE", registrationNumber: `${TAG}${reg}`, taxClass: "PRIVATE" },
      },
    },
  });
  created.push(rec.id);
  return rec;
}

beforeAll(async () => {
  try {
    ({ prisma } = await import("@/lib/prisma"));
    ({ deletePolicyRecord } = await import("@/lib/policy/deletePolicyRecord"));
    ({ deleteMotorPolicyAction, updateMotorOverviewAction } = await import("@/app/(app)/policy/motor/actions"));
    ({ generatePolicyRecordNumber } = await import("@/lib/policy/recordNumber"));
    ({ auth } = (await import("@/lib/auth")) as unknown as { auth: ReturnType<typeof vi.fn> });
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("permanentDelete.integration.test: no reachable database — skipping.", err);
    dbReachable = false;
    return;
  }
  const user = await prisma.user.create({ data: { username: `${TAG}-u`, fullName: `${TAG} u`, passwordHash: "x", status: "ACTIVE" } });
  userId = user.id;
  for (const s of [MOTOR_DELETE, MOTOR_EDIT, BOND_DELETE, NON_MOTOR_DELETE, WORK_PERMIT_DELETE]) s.id = user.id;
  const customer = await prisma.customer.create({ data: { customerNumber: `${TAG}-C`, companyName: `${TAG} Co`, pinNumber: `${TAG}-PIN` } });
  customerId = customer.id;
  const other = await prisma.customer.create({ data: { customerNumber: `${TAG}-C2`, companyName: `${TAG} Co2`, pinNumber: `${TAG}-PIN2` } });
  otherCustomerId = other.id;
  auth.mockResolvedValue({ user: MOTOR_DELETE });
});

afterAll(async () => {
  if (!dbReachable) return;
  const rows = await prisma.policyRecord
    .findMany({ where: { customerId: { in: [customerId, otherCustomerId] } }, select: { id: true, renewalIndex: true }, orderBy: { renewalIndex: "desc" } })
    .catch(() => []);
  for (const r of rows) {
    await prisma.motorClaim.deleteMany({ where: { policyRecordId: r.id } }).catch(() => {});
    await prisma.nonMotorClaim.deleteMany({ where: { policyRecordId: r.id } }).catch(() => {});
  }
  await prisma.invoice.deleteMany({ where: { customer: { customerNumber: { startsWith: TAG } } } }).catch(() => {});
  for (const r of rows) await prisma.policyRecord.delete({ where: { id: r.id } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { customerNumber: { startsWith: TAG } } }).catch(() => {});
  if (userId) await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
});

describe("Permanent Policy Delete — real DB", () => {
  it("V2/V15: a policy.motor.delete user permanently deletes an eligible Motor policy with the correct record number", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: MOTOR_DELETE });
    const rec = await seedMotor("A1");

    const res = await deleteMotorPolicyAction(rec.id, rec.recordNumber);
    expect(res).toEqual({ success: true, recordNumber: rec.recordNumber });

    // V18/V20 — the row and its owned detail are gone.
    expect(await prisma.policyRecord.findUnique({ where: { id: rec.id } })).toBeNull();
    expect(await prisma.motorPolicyDetail.findUnique({ where: { policyRecordId: rec.id } })).toBeNull();
  });

  it("V1/V3: a policy.motor.edit-only user is FORBIDDEN and the record is untouched", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: MOTOR_EDIT });
    const rec = await seedMotor("A2");

    const res = await deleteMotorPolicyAction(rec.id, rec.recordNumber);
    expect(res).toEqual({ success: false, error: "FORBIDDEN" });
    expect(await prisma.policyRecord.findUnique({ where: { id: rec.id } })).not.toBeNull();
  });

  it("V14: a wrong confirmation record number is rejected and the record is untouched", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: MOTOR_DELETE });
    const rec = await seedMotor("A3");

    const res = await deleteMotorPolicyAction(rec.id, "PM999999-9999");
    expect(res).toEqual({ success: false, error: "CONFIRMATION_MISMATCH" });
    expect(await prisma.policyRecord.findUnique({ where: { id: rec.id } })).not.toBeNull();
  });

  it("V7: a policy with an Invoice is blocked; the invoice is untouched", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: MOTOR_DELETE });
    const rec = await seedMotor("A4");
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `${TAG}-INV1`,
        invoiceDate: new Date("2026-09-15"),
        customerId,
        totalPremium: 5000,
        createdById: userId,
        items: {
          create: {
            policyRecordId: rec.id,
            itemNumber: 1,
            policyClassSnapshot: "MOTOR",
            policyNumberSnapshot: "POL-1",
            premiumSnapshot: 5000,
          },
        },
      },
    });

    const res = await deleteMotorPolicyAction(rec.id, rec.recordNumber);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error).toBe("HAS_DEPENDENCIES");
    expect(res.blockers?.some((b) => b.type === "INVOICE")).toBe(true);
    expect(await prisma.policyRecord.findUnique({ where: { id: rec.id } })).not.toBeNull();
    expect(await prisma.invoice.findUnique({ where: { id: invoice.id } })).not.toBeNull();
  });

  it("V8: a policy with a customer receipt is blocked; the receipt is untouched", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: MOTOR_DELETE });
    const rec = await seedMotor("A5");
    const receipt = await prisma.policyCustomerReceipt.create({
      data: { policyRecordId: rec.id, receiptDate: new Date("2026-09-12"), amount: 1000, source: "MANUAL", createdById: userId },
    });

    const res = await deleteMotorPolicyAction(rec.id, rec.recordNumber);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.blockers?.some((b) => b.type === "CUSTOMER_RECEIPT")).toBe(true);
    expect(await prisma.policyCustomerReceipt.findUnique({ where: { id: receipt.id } })).not.toBeNull();
  });

  it("V9: a policy with a commission ledger posting is blocked", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: MOTOR_DELETE });
    const rec = await seedMotor("A6");
    await prisma.policyRecord.update({
      where: { id: rec.id },
      data: { commissionReceived: true, commissionAmount: 500, commissionReceivedDate: new Date("2026-09-20") },
    });

    const res = await deleteMotorPolicyAction(rec.id, rec.recordNumber);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.blockers?.some((b) => b.type === "LEDGER_RECORD")).toBe(true);
  });

  it("V10: a policy with a Motor Claim is blocked; the claim is untouched", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: MOTOR_DELETE });
    const rec = await seedMotor("A7");
    const claim = await prisma.motorClaim.create({
      data: {
        claimNumber: `${TAG}-CLM1`,
        reportedAt: new Date("2026-09-18"),
        customerId,
        contactName: "X",
        contactPhone: "0712345678",
        insurer: "AAR",
        numberPlate: `${TAG}A7`,
        claimNature: "OWN_DAMAGE",
        policyRecordId: rec.id,
        createdById: userId,
      },
    });

    const res = await deleteMotorPolicyAction(rec.id, rec.recordNumber);
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.blockers?.some((b) => b.type === "MOTOR_CLAIM")).toBe(true);
    const stillThere = await prisma.motorClaim.findUnique({ where: { id: claim.id } });
    expect(stillThere?.policyRecordId).toBe(rec.id);
  });

  it("V12/V13: a renewal chain blocks deletion of both the parent and the renewal child", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: MOTOR_DELETE });
    const parent = await seedMotor("A8");
    const child = await prisma.policyRecord.create({
      data: {
        recordNumber: `${TAG}-A8R1`,
        category: "MOTOR",
        processingDate: new Date("2027-09-01"),
        customerId,
        effectiveDate: new Date("2027-09-05"),
        expiryDate: new Date("2028-09-04"),
        businessStatus: "ACTIVE",
        customerPremium: 6000,
        insurerCost: 4500,
        createdById: userId,
        renewedFromId: parent.id,
        rootPolicyId: parent.id,
        renewalIndex: 1,
        renewalDecision: "PENDING",
        motorDetail: { create: { insuranceType: "COMPREHENSIVE", registrationNumber: `${TAG}A8`, taxClass: "PRIVATE" } },
      },
    });
    created.push(child.id);
    await prisma.policyRecord.update({ where: { id: parent.id }, data: { businessStatus: "RENEWED" } });

    const parentRes = await deleteMotorPolicyAction(parent.id, parent.recordNumber);
    expect(parentRes.success).toBe(false);
    if (!parentRes.success) expect(parentRes.blockers?.some((b) => b.type === "RENEWAL")).toBe(true);

    const childRes = await deleteMotorPolicyAction(child.id, child.recordNumber);
    expect(childRes.success).toBe(false);
    if (!childRes.success) expect(childRes.blockers?.some((b) => b.type === "RENEWAL")).toBe(true);
  });

  it("V4: a Bond Security Bond with NO expiry date deletes cleanly (null-expiry safe)", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: BOND_DELETE });
    const rec = await prisma.policyRecord.create({
      data: {
        recordNumber: `${TAG}-B1`,
        category: "BOND",
        processingDate: new Date("2026-09-01"),
        customerId,
        effectiveDate: new Date("2026-09-05"),
        expiryDate: null,
        businessStatus: "ACTIVE",
        customerPremium: 3000,
        insurerCost: 2000,
        createdById: userId,
        bondDetail: { create: { bondType: "SECURITY_BOND", bondAmount: 100000 } },
      },
    });
    created.push(rec.id);

    const res = await deletePolicyRecord(rec.id, "BOND", rec.recordNumber);
    expect(res).toEqual({ success: true, recordNumber: rec.recordNumber });
    expect(await prisma.policyRecord.findUnique({ where: { id: rec.id } })).toBeNull();
  });

  it("V5/V6: eligible Non-Motor and Work Permit policies delete with their own category permission", async () => {
    if (!dbReachable) return;
    const nm = await prisma.policyRecord.create({
      data: {
        recordNumber: `${TAG}-N1`,
        category: "NON_MOTOR",
        processingDate: new Date("2026-09-01"),
        customerId,
        effectiveDate: new Date("2026-09-05"),
        expiryDate: new Date("2027-09-04"),
        businessStatus: "ACTIVE",
        customerPremium: 2000,
        insurerCost: 1500,
        createdById: userId,
        nonMotorDetail: { create: { insuranceType: "FIRE_ALLIED_PERILS" } },
      },
    });
    created.push(nm.id);
    const wp = await prisma.policyRecord.create({
      data: {
        recordNumber: `${TAG}-W1`,
        category: "WORK_PERMIT",
        processingDate: new Date("2026-09-01"),
        customerId,
        effectiveDate: new Date("2026-09-05"),
        expiryDate: new Date("2027-09-04"),
        businessStatus: "ACTIVE",
        customerPremium: 1000,
        insurerCost: 800,
        createdById: userId,
        workPermitDetail: { create: { permitType: "CLASS_D", agent: "Agent A" } },
      },
    });
    created.push(wp.id);

    auth.mockResolvedValue({ user: NON_MOTOR_DELETE });
    expect((await deletePolicyRecord(nm.id, "NON_MOTOR", nm.recordNumber)).success).toBe(true);
    auth.mockResolvedValue({ user: WORK_PERMIT_DELETE });
    expect((await deletePolicyRecord(wp.id, "WORK_PERMIT", wp.recordNumber)).success).toBe(true);

    // V9 isolation — a bond.delete user cannot delete a Non-Motor record.
    const nm2 = await prisma.policyRecord.create({
      data: {
        recordNumber: `${TAG}-N2`,
        category: "NON_MOTOR",
        processingDate: new Date("2026-09-01"),
        customerId,
        effectiveDate: new Date("2026-09-05"),
        expiryDate: new Date("2027-09-04"),
        businessStatus: "ACTIVE",
        customerPremium: 2000,
        insurerCost: 1500,
        createdById: userId,
        nonMotorDetail: { create: { insuranceType: "FIRE_ALLIED_PERILS" } },
      },
    });
    created.push(nm2.id);
    auth.mockResolvedValue({ user: BOND_DELETE });
    expect((await deletePolicyRecord(nm2.id, "NON_MOTOR", nm2.recordNumber)).success).toBe(false);
  });

  it("V16/V17/V21: the customer and the customer's other policies survive a delete", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: MOTOR_DELETE });
    const keep = await seedMotor("A9keep");
    const drop = await seedMotor("A9drop");

    expect((await deleteMotorPolicyAction(drop.id, drop.recordNumber)).success).toBe(true);

    expect(await prisma.customer.findUnique({ where: { id: customerId } })).not.toBeNull();
    expect(await prisma.policyRecord.findUnique({ where: { id: keep.id } })).not.toBeNull();
  });

  it("V24: the deleted policy's record number is never reused by the sequence generator", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: MOTOR_DELETE });
    // Generate a real sequenced number, use it, delete it, generate again.
    const first = await prisma.$transaction((tx) => generatePolicyRecordNumber(tx, "MOTOR"));
    const rec = await prisma.policyRecord.create({
      data: {
        recordNumber: first,
        category: "MOTOR",
        processingDate: new Date("2026-09-01"),
        customerId,
        effectiveDate: new Date("2026-09-05"),
        expiryDate: new Date("2026-10-04"),
        businessStatus: "ACTIVE",
        customerPremium: 100,
        insurerCost: 90,
        createdById: userId,
        motorDetail: { create: { insuranceType: "COMPREHENSIVE", registrationNumber: `${TAG}SEQ`, taxClass: "PRIVATE" } },
      },
    });
    created.push(rec.id);
    expect((await deleteMotorPolicyAction(rec.id, first)).success).toBe(true);

    const second = await prisma.$transaction((tx) => generatePolicyRecordNumber(tx, "MOTOR"));
    expect(second).not.toBe(first);
  });

  it("V25: Cancel Policy (businessStatus change) is unaffected — it does NOT hard-delete", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: MOTOR_EDIT });
    const rec = await seedMotor("A10");

    const res = await updateMotorOverviewAction(rec.id, {
      processingDate: "2026-09-01",
      customerId,
      projectId: null,
      insuranceType: "COMPREHENSIVE",
      registrationNumber: `${TAG}A10`,
      taxClass: "PRIVATE",
      effectiveDate: "2026-09-05",
      expiryDate: "2026-10-04",
      customerPremium: 5000,
      insurerCost: 4000,
      cancelled: true,
    });
    expect(res.success).toBe(true);
    const after = await prisma.policyRecord.findUnique({ where: { id: rec.id } });
    expect(after).not.toBeNull();
    expect(after?.businessStatus).toBe("CANCELLED");
  });

  it("V-P: a CANCELLED policy with no dependencies can still be permanently deleted (no 'cancel first' requirement, and cancel is not required)", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: MOTOR_DELETE });
    const rec = await seedMotor("A11");
    await prisma.policyRecord.update({ where: { id: rec.id }, data: { businessStatus: "CANCELLED" } });

    const res = await deleteMotorPolicyAction(rec.id, rec.recordNumber);
    expect(res.success).toBe(true);
  });
});
