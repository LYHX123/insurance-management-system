import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { config as loadDotenv } from "dotenv";

loadDotenv();

// Phase 13C — real-Postgres end-to-end for the Security Bond optional-expiry
// rule, via the ACTUAL createBondRecordAction / updateBondOverviewAction and
// the ACTUAL getOtherPolicyReminders (real prisma; auth + next-cache stubbed).
// Seeds + cleans up its own rows. Skips when no DB is reachable.
//
//   A  Security Bond, no expiry           -> saves, expiryDate === null
//   B  Security Bond, future expiry       -> saves, date persisted
//   C  non-Security Bond, no expiry       -> rejected (EXPIRY_DATE_REQUIRED)
//   D  non-Security Bond, future expiry   -> saves unchanged
//   E  edit Security Bond, still no expiry-> saves, stays null
//   F  edit Security Bond (null) -> Tender Bond, no expiry -> rejected
//   G  edit Tender Bond -> Security Bond, keeps its existing expiry date
//   H  reminders: null-expiry Security Bond excluded; dated ones follow rules
//   I  display/data: null expiry never yields Invalid Date / 1970 / etc.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

let dbReachable = true;
let prisma: typeof import("@/lib/prisma").prisma;
let createBondRecordAction: typeof import("@/app/(app)/policy/bond/actions").createBondRecordAction;
let updateBondOverviewAction: typeof import("@/app/(app)/policy/bond/actions").updateBondOverviewAction;
let getOtherPolicyReminders: typeof import("@/lib/reminders/policy").getOtherPolicyReminders;
let auth: ReturnType<typeof vi.fn>;

const TAG = `p13c-${randomUUID().slice(0, 8)}`;
const TZ = "Africa/Nairobi";
// Fixed "now" so day-arithmetic in the reminder assertions is deterministic.
const NOW = new Date("2026-09-20T09:00:00.000Z");

let userId = "";
let customerId = "";
const EDIT = { id: "", role: "Staff", status: "ACTIVE", permissions: ["policy.bond.edit"] };

const baseCreateInput = (overrides: Record<string, unknown> = {}) => ({
  processingDate: "2026-09-01",
  customerId,
  projectId: null,
  bondType: "SECURITY_BOND",
  customBondType: null,
  bondAmount: "500000",
  insurerName: "Jubilee",
  policyNumber: "SB-001",
  effectiveDate: "2026-09-05",
  expiryDate: null as string | null,
  customerPremium: "12000",
  insurerCost: "9000",
  remarks: null,
  ...overrides,
});

beforeAll(async () => {
  try {
    ({ prisma } = await import("@/lib/prisma"));
    ({ createBondRecordAction, updateBondOverviewAction } = await import("@/app/(app)/policy/bond/actions"));
    ({ getOtherPolicyReminders } = await import("@/lib/reminders/policy"));
    ({ auth } = (await import("@/lib/auth")) as unknown as { auth: ReturnType<typeof vi.fn> });
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("securityBondExpiry.integration.test: no reachable database — skipping.", err);
    dbReachable = false;
    return;
  }
  const user = await prisma.user.create({ data: { username: `${TAG}-u`, fullName: `${TAG} u`, passwordHash: "x", status: "ACTIVE" } });
  userId = user.id;
  EDIT.id = user.id;
  const customer = await prisma.customer.create({ data: { customerNumber: `${TAG}-C`, companyName: `${TAG} Co`, pinNumber: `${TAG}-PIN` } });
  customerId = customer.id;
  auth.mockResolvedValue({ user: EDIT });
});

afterAll(async () => {
  if (!dbReachable) return;
  await prisma.policyRecord.deleteMany({ where: { customerId } }).catch(() => {});
  await prisma.customer.deleteMany({ where: { customerNumber: { startsWith: TAG } } }).catch(() => {});
  if (userId) await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
});

describe("Security Bond — optional expiry date (real DB)", () => {
  it("A: Security Bond with a blank expiry date saves and persists expiryDate = null", async () => {
    if (!dbReachable) return;
    const res = await createBondRecordAction(baseCreateInput({ expiryDate: null }));
    expect(res.success).toBe(true);
    if (!res.success) return;
    const row = await prisma.policyRecord.findUnique({
      where: { id: res.id },
      include: { bondDetail: true },
    });
    expect(row?.expiryDate).toBeNull();
    expect(row?.bondDetail?.bondType).toBe("SECURITY_BOND");
    // Never persisted as an invalid/placeholder date.
    expect(row?.businessStatus).toBe("ACTIVE");
  });

  it("A': an empty-string expiry date is normalised to null (not an invalid Date)", async () => {
    if (!dbReachable) return;
    const res = await createBondRecordAction(baseCreateInput({ expiryDate: "" }));
    expect(res.success).toBe(true);
    if (!res.success) return;
    const row = await prisma.policyRecord.findUnique({ where: { id: res.id } });
    expect(row?.expiryDate).toBeNull();
  });

  it("B: Security Bond with a valid future expiry date saves that date", async () => {
    if (!dbReachable) return;
    const res = await createBondRecordAction(baseCreateInput({ expiryDate: "2027-09-04" }));
    expect(res.success).toBe(true);
    if (!res.success) return;
    const row = await prisma.policyRecord.findUnique({ where: { id: res.id } });
    expect(row?.expiryDate?.toISOString().slice(0, 10)).toBe("2027-09-04");
  });

  it("C: a non-Security Bond type with a blank expiry date is rejected", async () => {
    if (!dbReachable) return;
    const res = await createBondRecordAction(baseCreateInput({ bondType: "TENDER_BOND", expiryDate: null }));
    expect(res).toEqual({ success: false, error: "EXPIRY_DATE_REQUIRED" });
  });

  it("D: a non-Security Bond type with a valid expiry date still saves normally", async () => {
    if (!dbReachable) return;
    const res = await createBondRecordAction(
      baseCreateInput({ bondType: "TENDER_BOND", expiryDate: "2027-03-31" })
    );
    expect(res.success).toBe(true);
    if (!res.success) return;
    const row = await prisma.policyRecord.findUnique({ where: { id: res.id } });
    expect(row?.expiryDate?.toISOString().slice(0, 10)).toBe("2027-03-31");
  });

  it("E: editing a no-expiry Security Bond without adding an expiry date keeps it null", async () => {
    if (!dbReachable) return;
    const created = await createBondRecordAction(baseCreateInput({ expiryDate: null }));
    expect(created.success).toBe(true);
    if (!created.success) return;

    const res = await updateBondOverviewAction(created.id, {
      processingDate: "2026-09-01",
      customerId,
      projectId: null,
      bondType: "SECURITY_BOND",
      customBondType: null,
      bondAmount: "600000",
      insurerName: "Jubilee",
      policyNumber: "SB-001",
      effectiveDate: "2026-09-05",
      expiryDate: null,
      customerPremium: "12000",
      insurerCost: "9000",
      remarks: null,
      cancelled: false,
    });
    expect(res.success).toBe(true);
    const row = await prisma.policyRecord.findUnique({ where: { id: created.id } });
    expect(row?.expiryDate).toBeNull();
  });

  it("F: changing a no-expiry Security Bond to another Bond type is blocked until an expiry date is supplied", async () => {
    if (!dbReachable) return;
    const created = await createBondRecordAction(baseCreateInput({ expiryDate: null }));
    expect(created.success).toBe(true);
    if (!created.success) return;

    const editInput = {
      processingDate: "2026-09-01",
      customerId,
      projectId: null,
      bondType: "TENDER_BOND",
      customBondType: null,
      bondAmount: "600000",
      insurerName: "Jubilee",
      policyNumber: "SB-001",
      effectiveDate: "2026-09-05",
      expiryDate: null as string | null,
      customerPremium: "12000",
      insurerCost: "9000",
      remarks: null,
      cancelled: false,
    };

    const blocked = await updateBondOverviewAction(created.id, editInput);
    expect(blocked).toEqual({ success: false, error: "EXPIRY_DATE_REQUIRED" });

    const ok = await updateBondOverviewAction(created.id, { ...editInput, expiryDate: "2027-09-04" });
    expect(ok.success).toBe(true);
    const row = await prisma.policyRecord.findUnique({ where: { id: created.id }, include: { bondDetail: true } });
    expect(row?.bondDetail?.bondType).toBe("TENDER_BOND");
    expect(row?.expiryDate?.toISOString().slice(0, 10)).toBe("2027-09-04");
  });

  it("G: changing a normal Bond to Security Bond does not delete its existing expiry date", async () => {
    if (!dbReachable) return;
    const created = await createBondRecordAction(
      baseCreateInput({ bondType: "TENDER_BOND", expiryDate: "2027-06-30" })
    );
    expect(created.success).toBe(true);
    if (!created.success) return;

    const res = await updateBondOverviewAction(created.id, {
      processingDate: "2026-09-01",
      customerId,
      projectId: null,
      bondType: "SECURITY_BOND",
      customBondType: null,
      bondAmount: "500000",
      insurerName: "Jubilee",
      policyNumber: "SB-001",
      effectiveDate: "2026-09-05",
      // The form re-sends whatever date is still in the field — not cleared.
      expiryDate: "2027-06-30",
      customerPremium: "12000",
      insurerCost: "9000",
      remarks: null,
      cancelled: false,
    });
    expect(res.success).toBe(true);
    const row = await prisma.policyRecord.findUnique({ where: { id: created.id }, include: { bondDetail: true } });
    expect(row?.bondDetail?.bondType).toBe("SECURITY_BOND");
    expect(row?.expiryDate?.toISOString().slice(0, 10)).toBe("2027-06-30");
  });

  it("H: expiry reminders — a null-expiry Security Bond is excluded; dated bonds still remind", async () => {
    if (!dbReachable) return;
    // Isolate this test's data from the rows seeded above.
    const iso = new Date(NOW.getTime() + 10 * 86_400_000).toISOString().slice(0, 10); // 2026-09-30, within threshold
    const far = "2028-01-01";

    const noExpiry = await createBondRecordAction(
      baseCreateInput({ bondType: "SECURITY_BOND", expiryDate: null, effectiveDate: "2026-09-05" })
    );
    const nearExpirySecurity = await createBondRecordAction(
      baseCreateInput({ bondType: "SECURITY_BOND", expiryDate: iso, effectiveDate: "2026-09-05" })
    );
    const nearExpiryTender = await createBondRecordAction(
      baseCreateInput({ bondType: "TENDER_BOND", expiryDate: iso, effectiveDate: "2026-09-05" })
    );
    const farExpiryTender = await createBondRecordAction(
      baseCreateInput({ bondType: "TENDER_BOND", expiryDate: far, effectiveDate: "2026-09-05" })
    );
    for (const r of [noExpiry, nearExpirySecurity, nearExpiryTender, farExpiryTender]) {
      expect(r.success).toBe(true);
    }
    if (!noExpiry.success || !nearExpirySecurity.success || !nearExpiryTender.success || !farExpiryTender.success) return;

    const items = await getOtherPolicyReminders(30, TZ, NOW);
    const ids = new Set(items.map((i) => i.recordId));

    expect(ids.has(noExpiry.id)).toBe(false); // open-ended -> never reminds
    expect(ids.has(nearExpirySecurity.id)).toBe(true); // has a date -> reminds like any bond
    expect(ids.has(nearExpiryTender.id)).toBe(true); // unchanged behaviour
    expect(ids.has(farExpiryTender.id)).toBe(false); // beyond threshold -> no reminder
  });

  it("I: a null-expiry Security Bond never surfaces an Invalid Date / 1970 / NaN artifact", async () => {
    if (!dbReachable) return;
    const created = await createBondRecordAction(baseCreateInput({ expiryDate: null }));
    expect(created.success).toBe(true);
    if (!created.success) return;
    const row = await prisma.policyRecord.findUnique({ where: { id: created.id } });
    // The value is a genuine SQL NULL, not an epoch/invalid Date.
    expect(row?.expiryDate).toBeNull();
    expect(row?.expiryDate).not.toBeInstanceOf(Date);
  });
});
