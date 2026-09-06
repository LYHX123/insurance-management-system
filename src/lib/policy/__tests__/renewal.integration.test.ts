import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { config as loadDotenv } from "dotenv";

loadDotenv();

// Phase 12D — real-Postgres end-to-end for the Policy Renewal Chain via the
// ACTUAL renewPolicyAction / setPolicyRenewalDecisionAction (real prisma;
// auth + next-cache stubbed). Seeds + cleans up its own rows. Skips when no
// DB is reachable.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

let dbReachable = true;
let prisma: typeof import("@/lib/prisma").prisma;
let renewPolicyAction: typeof import("@/app/(app)/policy/renewal/actions").renewPolicyAction;
let setPolicyRenewalDecisionAction: typeof import("@/app/(app)/policy/renewal/actions").setPolicyRenewalDecisionAction;
let resolvePolicyBusinessFileRefReadOnly: typeof import("@/lib/integrations/dropbox/policyBusinessFile").resolvePolicyBusinessFileRefReadOnly;
let getMotorPolicyReminders: typeof import("@/lib/reminders/policy").getMotorPolicyReminders;
let auth: ReturnType<typeof vi.fn>;

const TAG = `p12d-${randomUUID().slice(0, 8)}`;
let userId = "";
let customerId = "";
const EDIT = { id: "", role: "Staff", status: "ACTIVE", permissions: ["policy.motor.edit", "policy.non_motor.edit"] };
const VIEW = { id: "", role: "Staff", status: "ACTIVE", permissions: ["policy.motor.view"] };
const created: string[] = [];

async function seedMotor(reg: string, cover = "COMPREHENSIVE", valuation: string | null = "COMPLETED") {
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
      commissionReceived: true,
      commissionAmount: 500,
      commissionReceivedDate: new Date("2026-09-06"),
      customerContactPerson: "LI YONG",
      remarks: "original remarks",
      createdById: userId,
      motorDetail: {
        create: {
          insuranceType: cover,
          registrationNumber: `${TAG}${reg}`,
          taxClass: "PRIVATE",
          vehicleValue: 1200000,
          valuationStatus: valuation as never,
          assessedVehicleValue: valuation === "COMPLETED" ? 1150000 : null,
        },
      },
    },
  });
  created.push(rec.id);
  // A receipt + a payment + a document on the ORIGINAL — must NOT copy.
  await prisma.policyCustomerReceipt.create({
    data: { policyRecordId: rec.id, receiptDate: new Date("2026-09-10"), amount: 2000, source: "MANUAL", createdById: userId },
  });
  await prisma.policyProviderPayment.create({
    data: { policyRecordId: rec.id, paymentDate: new Date("2026-09-11"), amount: 1500, source: "MANUAL", createdById: userId },
  });
  await prisma.policyDocument.create({
    data: {
      policyRecordId: rec.id,
      documentType: "POLICY_SCHEDULE",
      originalFileName: "sched.pdf",
      storedFileName: "x.pdf",
      mimeType: "application/pdf",
      fileSize: 10,
      storageProvider: "LOCAL",
      storagePath: `${TAG}/x.pdf`,
      uploadedById: userId,
    },
  });
  return rec;
}

const motorRenewInput = (reg: string, overrides = {}) => ({
  processingDate: "2027-09-01",
  effectiveDate: "2027-09-05",
  expiryDate: "2028-09-04",
  currency: "KES",
  customerPremium: 7000,
  insurerCost: 5500,
  insurerName: "Jubilee",
  remarks: "renewal remarks",
  motor: { registrationNumber: `${TAG}${reg}`, insuranceType: "COMPREHENSIVE", taxClass: "PRIVATE", vehicleValue: 1300000, policyNumber: "POL-R1" },
  ...overrides,
});

beforeAll(async () => {
  try {
    ({ prisma } = await import("@/lib/prisma"));
    ({ renewPolicyAction, setPolicyRenewalDecisionAction } = await import("@/app/(app)/policy/renewal/actions"));
    ({ resolvePolicyBusinessFileRefReadOnly } = await import("@/lib/integrations/dropbox/policyBusinessFile"));
    ({ getMotorPolicyReminders } = await import("@/lib/reminders/policy"));
    ({ auth } = (await import("@/lib/auth")) as unknown as { auth: ReturnType<typeof vi.fn> });
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("renewal.integration.test: no reachable database — skipping.", err);
    dbReachable = false;
    return;
  }
  const user = await prisma.user.create({ data: { username: `${TAG}-u`, fullName: `${TAG} u`, passwordHash: "x", status: "ACTIVE" } });
  userId = user.id;
  EDIT.id = user.id;
  VIEW.id = user.id;
  const customer = await prisma.customer.create({ data: { customerNumber: `${TAG}-C`, companyName: `${TAG} Co`, pinNumber: `${TAG}-PIN` } });
  customerId = customer.id;
  auth.mockResolvedValue({ user: EDIT });
});

afterAll(async () => {
  if (!dbReachable) return;
  // Highest renewalIndex first (FK Restrict on renewedFromId / rootPolicyId);
  // child rows cascade on PolicyRecord delete.
  // Query by customerId, NOT recordNumber prefix — renewals get an
  // auto-generated PM… number, not the TAG.
  const rows = await prisma.policyRecord
    .findMany({ where: { customerId }, select: { id: true, renewalIndex: true }, orderBy: { renewalIndex: "desc" } })
    .catch(() => []);
  for (const r of rows) await prisma.policyRecord.delete({ where: { id: r.id } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { customerNumber: { startsWith: TAG } } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
});

describe("Policy Renewal Chain — real DB", () => {
  it("D9-D14, D17, D18, D23, D24: renew a Motor policy", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT });
    const src = await seedMotor("A1");

    const res = await renewPolicyAction(src.id, motorRenewInput("A1"));
    expect(res.success).toBe(true);
    if (!res.success) return;
    created.push(res.id);

    const renewal = await prisma.policyRecord.findUniqueOrThrow({
      where: { id: res.id },
      include: { motorDetail: true, customerReceipts: true, providerPayments: true, documents: true },
    });
    // D10 — new record number, different from the source.
    expect(renewal.recordNumber).toMatch(/^PM/);
    expect(renewal.recordNumber).not.toBe(src.recordNumber);
    // D11/D12/D13 — chain wiring.
    expect(renewal.renewedFromId).toBe(src.id);
    expect(renewal.rootPolicyId).toBe(src.id);
    expect(renewal.renewalIndex).toBe(1);
    expect(renewal.renewalDecision).toBe("PENDING");
    // D14 — previous points to its successor.
    const prev = await prisma.policyRecord.findUniqueOrThrow({ where: { id: src.id }, include: { renewedBy: true } });
    expect(prev.renewedBy?.id).toBe(res.id);
    expect(prev.renewalDecision).toBe("RENEWED");
    expect(prev.businessStatus).toBe("RENEWED"); // §12 — explicit RENEWED sticks
    // D17 — financials NOT copied.
    expect(renewal.customerReceipts).toHaveLength(0);
    expect(renewal.providerPayments).toHaveLength(0);
    expect(renewal.commissionReceived).toBe(false);
    expect(renewal.commissionAmount).toBeNull();
    // D18 — documents NOT copied.
    expect(renewal.documents).toHaveLength(0);
    // D23 — contact person carried forward.
    expect(renewal.customerContactPerson).toBe("LI YONG");
    // D24 — Phase 12C: completed valuation NOT copied.
    expect(renewal.motorDetail?.valuationStatus).toBeNull();
    expect(renewal.motorDetail?.assessedVehicleValue).toBeNull();
    // Vehicle value IS carried (and here edited).
    expect(Number(renewal.motorDetail?.vehicleValue)).toBe(1300000);
    // Activity on both sides.
    const srcActs = await prisma.policyActivity.findMany({ where: { policyRecordId: src.id, actionType: "POLICY_RENEWED" } });
    const newActs = await prisma.policyActivity.findMany({ where: { policyRecordId: res.id, actionType: "POLICY_RENEWED" } });
    expect(srcActs[0]?.summary).toContain(renewal.recordNumber);
    expect(newActs[0]?.summary).toContain(src.recordNumber);
  });

  it("D16: a second renew of the same source fails with POLICY_ALREADY_RENEWED", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT });
    const src = await seedMotor("A2");
    const first = await renewPolicyAction(src.id, motorRenewInput("A2"));
    expect(first.success).toBe(true);
    if (first.success) created.push(first.id);
    const second = await renewPolicyAction(src.id, motorRenewInput("A2"));
    expect(second).toEqual({ success: false, error: "POLICY_ALREADY_RENEWED" });
    // Concurrent double-fire also yields exactly one.
    const src3 = await seedMotor("A3");
    const [r1, r2] = await Promise.all([renewPolicyAction(src3.id, motorRenewInput("A3")), renewPolicyAction(src3.id, motorRenewInput("A3"))]);
    const ok = [r1, r2].filter((r) => r.success);
    expect(ok).toHaveLength(1);
    if (ok[0]?.success) created.push(ok[0].id);
  });

  it("D15, D28, D30, D31: renew a renewal (Renewal 2); Dropbox resolves to the ROOT folder for every period", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT });
    const src = await seedMotor("A4");
    const r1res = await renewPolicyAction(src.id, motorRenewInput("A4"));
    expect(r1res.success).toBe(true);
    if (!r1res.success) return;
    created.push(r1res.id);
    const r2res = await renewPolicyAction(r1res.id, motorRenewInput("A4", { effectiveDate: "2028-09-05", expiryDate: "2029-09-04" }));
    expect(r2res.success).toBe(true);
    if (!r2res.success) return;
    created.push(r2res.id);
    const r2 = await prisma.policyRecord.findUniqueOrThrow({ where: { id: r2res.id } });
    expect(r2.renewalIndex).toBe(2);
    expect(r2.renewedFromId).toBe(r1res.id);
    expect(r2.rootPolicyId).toBe(src.id); // chain root stays the original

    // D28/D30/D31 — every period resolves to the ROOT's business folder;
    // no renewal ever gets its own PolicyDropboxBusinessFile.
    const rootRef = await resolvePolicyBusinessFileRefReadOnly(src.id);
    const r1Ref = await resolvePolicyBusinessFileRefReadOnly(r1res.id);
    const r2Ref = await resolvePolicyBusinessFileRefReadOnly(r2res.id);
    expect(rootRef?.businessFolderName).toBeTruthy();
    expect(r1Ref?.businessFolderName).toBe(rootRef?.businessFolderName);
    expect(r2Ref?.businessFolderName).toBe(rootRef?.businessFolderName);
    const ownFiles = await prisma.policyDropboxBusinessFile.findMany({ where: { policyRecordId: { in: [r1res.id, r2res.id] } } });
    expect(ownFiles).toHaveLength(0);
  });

  it("D5, D6, D7, D8, D33: Do Not Renew / Reopen", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT });
    const src = await seedMotor("B1");
    // Scoped to this test's own customer so it stays correct when other
    // real-DB integration tests create/delete rows in parallel.
    const before = await prisma.policyRecord.count({ where: { customerId } });

    const dnr = await setPolicyRenewalDecisionAction(src.id, "NOT_RENEWED", "customer declined");
    expect(dnr.success).toBe(true);
    // D5 — no new PolicyRecord.
    expect(await prisma.policyRecord.count({ where: { customerId } })).toBe(before);
    const after = await prisma.policyRecord.findUniqueOrThrow({ where: { id: src.id } });
    expect(after.renewalDecision).toBe("NOT_RENEWED");
    expect(after.businessStatus).toBe("ACTIVE"); // §12 — status untouched
    // D6 — activity recorded with the reason.
    const act = await prisma.policyActivity.findFirst({ where: { policyRecordId: src.id, actionType: "POLICY_NOT_RENEWED" } });
    expect(act?.details).toBe("customer declined");
    // D7 — suppressed from renewal reminders (near expiry, but NOT_RENEWED).
    const reminders = await getMotorPolicyReminders(60, "Africa/Nairobi", new Date("2026-09-20T00:00:00Z"));
    expect(reminders.find((r) => r.recordId === src.id)).toBeUndefined();

    // Renew is blocked while NOT_RENEWED.
    const blocked = await renewPolicyAction(src.id, motorRenewInput("B1"));
    expect(blocked).toEqual({ success: false, error: "POLICY_NOT_RENEWABLE" });

    // D8 — reopen -> PENDING, then renew works.
    const reopen = await setPolicyRenewalDecisionAction(src.id, "PENDING");
    expect(reopen.success).toBe(true);
    expect((await prisma.policyRecord.findUniqueOrThrow({ where: { id: src.id } })).renewalDecision).toBe("PENDING");
    const nowOk = await renewPolicyAction(src.id, motorRenewInput("B1"));
    expect(nowOk.success).toBe(true);
    if (nowOk.success) created.push(nowOk.id);

    // D33 — cannot mark NOT_RENEWED once a successor exists.
    const late = await setPolicyRenewalDecisionAction(src.id, "NOT_RENEWED", "too late");
    expect(late).toEqual({ success: false, error: "HAS_SUCCESSOR" });
  });

  it("D27: a VIEW-only user cannot renew or set a renewal decision", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT });
    const src = await seedMotor("C1");
    auth.mockResolvedValue({ user: VIEW });
    expect(await renewPolicyAction(src.id, motorRenewInput("C1"))).toEqual({ success: false, error: "FORBIDDEN" });
    expect(await setPolicyRenewalDecisionAction(src.id, "NOT_RENEWED")).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("D22: a renewal accepts its own receipt independently of the original", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT });
    const src = await seedMotor("D1");
    const r = await renewPolicyAction(src.id, motorRenewInput("D1"));
    expect(r.success).toBe(true);
    if (!r.success) return;
    created.push(r.id);
    await prisma.policyCustomerReceipt.create({
      data: { policyRecordId: r.id, receiptDate: new Date("2027-09-10"), amount: 3000, source: "MANUAL", createdById: userId },
    });
    const renewalReceipts = await prisma.policyCustomerReceipt.count({ where: { policyRecordId: r.id } });
    const originalReceipts = await prisma.policyCustomerReceipt.count({ where: { policyRecordId: src.id } });
    expect(renewalReceipts).toBe(1);
    expect(originalReceipts).toBe(1); // untouched
  });
});
