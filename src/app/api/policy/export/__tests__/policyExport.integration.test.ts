import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { config as loadDotenv } from "dotenv";

loadDotenv();

// Phase 13A — real-Postgres tests for the Policy list Excel export routes.
// Hits the ACTUAL GET handler (real prisma; only auth + locale stubbed),
// parses the returned .xlsx and asserts the row set / columns. Skips when no
// DB is reachable.

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/i18n/get-locale", () => ({ getLocale: vi.fn(async () => "en") }));

let dbReachable = true;
let prisma: typeof import("@/lib/prisma").prisma;
let GET: typeof import("../[category]/route").GET;
let auth: ReturnType<typeof vi.fn>;
let getLocale: ReturnType<typeof vi.fn>;

const TAG = `p13a-${randomUUID().slice(0, 8)}`;
let userId = "";
let customerAId = "";
let customerBId = "";
let customerCId = "";

const EDIT_USER = () => ({ id: userId, role: "Staff", status: "ACTIVE", permissions: ["policy.motor.edit", "policy.non_motor.edit", "policy.bond.edit", "policy.work_permit.edit"] });
const VIEW_USER = () => ({ id: userId, role: "Staff", status: "ACTIVE", permissions: ["policy.motor.view"] });
const NO_MOTOR_USER = () => ({ id: userId, role: "Staff", status: "ACTIVE", permissions: ["policy.bond.view"] });

async function callExport(category: string, query: Record<string, string> = {}) {
  const sp = new URLSearchParams(query).toString();
  const req = new NextRequest(`http://localhost:3001/api/policy/export/${category}${sp ? `?${sp}` : ""}`);
  return GET(req, { params: Promise.resolve({ category }) });
}

async function parseSheet(res: Response) {
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet = wb.worksheets[0];
  const headers = (sheet.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ""));
  const rows: string[][] = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    rows.push((row.values as unknown[]).slice(1).map((v) => String(v ?? "")));
  });
  return { headers, rows };
}

async function makePolicy(opts: {
  category: "MOTOR" | "NON_MOTOR" | "BOND" | "WORK_PERMIT";
  customerId: string;
  expiry: string;
  insurerName?: string | null;
  contact?: string | null;
  premium?: number;
  received?: number;
  detail: Record<string, unknown>;
  relation: "motorDetail" | "nonMotorDetail" | "bondDetail" | "workPermitDetail";
}) {
  const premium = opts.premium ?? 1000;
  const rec = await prisma.policyRecord.create({
    data: {
      recordNumber: `${TAG}-${randomUUID().slice(0, 6)}`,
      category: opts.category,
      processingDate: new Date("2026-09-01T00:00:00.000Z"),
      customerId: opts.customerId,
      effectiveDate: new Date("2026-08-01T00:00:00.000Z"),
      expiryDate: new Date(`${opts.expiry}T00:00:00.000Z`),
      customerPremium: premium,
      insurerCost: 800,
      insurerName: opts.insurerName ?? null,
      customerContactPerson: opts.contact ?? null,
      createdById: userId,
      [opts.relation]: { create: opts.detail },
    },
  });
  if (opts.received) {
    await prisma.policyCustomerReceipt.create({
      data: { policyRecordId: rec.id, amount: opts.received, receiptDate: new Date("2026-08-15T00:00:00.000Z"), createdById: userId },
    });
  }
  return rec;
}

beforeAll(async () => {
  try {
    ({ prisma } = await import("@/lib/prisma"));
    ({ GET } = await import("../[category]/route"));
    ({ auth } = (await import("@/lib/auth")) as unknown as { auth: ReturnType<typeof vi.fn> });
    ({ getLocale } = (await import("@/i18n/get-locale")) as unknown as { getLocale: ReturnType<typeof vi.fn> });
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("policyExport.integration.test: no reachable database — skipping.", err);
    dbReachable = false;
    return;
  }
  auth.mockResolvedValue({ user: EDIT_USER() });
  getLocale.mockResolvedValue("en");

  const user = await prisma.user.create({ data: { username: `${TAG}-u`, fullName: `${TAG} user`, passwordHash: "x", status: "ACTIVE" } });
  userId = user.id;
  const a = await prisma.customer.create({ data: { customerNumber: `${TAG}-A`, companyName: `${TAG} Alpha`, pinNumber: `${TAG}-PA` } });
  const b = await prisma.customer.create({ data: { customerNumber: `${TAG}-B`, companyName: `${TAG} Beta`, pinNumber: `${TAG}-PB` } });
  const c = await prisma.customer.create({ data: { customerNumber: `${TAG}-C`, companyName: `${TAG} Gamma`, pinNumber: `${TAG}-PC` } });
  customerAId = a.id;
  customerBId = b.id;
  customerCId = c.id;

  // 30 Motor records for customer A (to prove > 1 page of 25 is exported),
  // fully paid so only the explicit "owing" record trips the outstanding
  // filter, + a couple of distinguishing ones.
  for (let i = 0; i < 30; i++) {
    await makePolicy({
      category: "MOTOR", customerId: customerAId, expiry: "2026-10-10",
      insurerName: "Jubilee", contact: "Jane Doe", premium: 1000, received: 1000, relation: "motorDetail",
      detail: { insuranceType: "COMPREHENSIVE", registrationNumber: `${TAG} KAA${i}`, valuationStatus: "IN_PROGRESS" },
    });
  }
  await makePolicy({
    category: "MOTOR", customerId: customerBId, expiry: "2027-01-01",
    insurerName: "APA", contact: "Bob", relation: "motorDetail",
    detail: { insuranceType: "THIRD PARTY", registrationNumber: `${TAG} KBB1` },
  });
  await makePolicy({
    category: "MOTOR", customerId: customerAId, expiry: "2026-12-20",
    insurerName: "Jubilee", contact: "Jane Doe", premium: 2000, received: 500, relation: "motorDetail",
    detail: { insuranceType: "COMPREHENSIVE", registrationNumber: `${TAG} KAA-OWING`, valuationStatus: "COMPLETED" },
  });

  // customer C — the "sparse / historical" record: null insurer, null
  // contact person, NO valuation status, THIRD PARTY. This is the exact
  // shape that must not throw in the export.
  await makePolicy({
    category: "MOTOR", customerId: customerCId, expiry: "2026-10-01",
    insurerName: null, contact: null, premium: 0, relation: "motorDetail",
    detail: { insuranceType: "THIRD PARTY", registrationNumber: `${TAG} KCC-SPARSE` },
  });
  // customer C — a renewal chain: an original (renewed) + its renewal (index 1, PENDING).
  const original = await makePolicy({
    category: "MOTOR", customerId: customerCId, expiry: "2026-06-30",
    insurerName: "Jubilee", contact: "Ann", relation: "motorDetail",
    detail: { insuranceType: "COMPREHENSIVE", registrationNumber: `${TAG} KCC-ORIG`, valuationStatus: "COMPLETED" },
  });
  await prisma.policyRecord.update({
    where: { id: original.id },
    data: { businessStatus: "RENEWED", renewalDecision: "RENEWED", rootPolicyId: original.id },
  });
  const renewal = await makePolicy({
    category: "MOTOR", customerId: customerCId, expiry: "2027-06-30",
    insurerName: "Jubilee", contact: "Ann", relation: "motorDetail",
    detail: { insuranceType: "COMPREHENSIVE", registrationNumber: `${TAG} KCC-RENEW`, valuationStatus: "NOT_ARRANGED" },
  });
  await prisma.policyRecord.update({
    where: { id: renewal.id },
    data: { renewalIndex: 1, renewalDecision: "PENDING", rootPolicyId: original.id, renewedFromId: original.id },
  });

  await makePolicy({
    category: "NON_MOTOR", customerId: customerAId, expiry: "2026-11-11", insurerName: "APA",
    relation: "nonMotorDetail", detail: { insuranceType: "WIBA" },
  });
  await makePolicy({
    category: "BOND", customerId: customerAId, expiry: "2026-11-12", insurerName: "APA",
    relation: "bondDetail", detail: { bondType: "TENDER_BOND", bondAmount: 5000, policyNumber: `${TAG}-BND` },
  });
  await makePolicy({
    category: "WORK_PERMIT", customerId: customerAId, expiry: "2026-11-13",
    relation: "workPermitDetail", detail: { permitType: "CLASS_D", agent: "Agent X" },
  });
});

afterAll(async () => {
  if (!dbReachable) return;
  await prisma.policyCustomerReceipt.deleteMany({ where: { createdById: userId } });
  // Break the renewal self-FKs (onDelete: Restrict) before the bulk delete.
  await prisma.policyRecord.updateMany({
    where: { createdById: userId },
    data: { renewedFromId: null, rootPolicyId: null, renewalIndex: 0, renewalDecision: null },
  });
  await prisma.policyRecord.deleteMany({ where: { createdById: userId } });
  await prisma.customer.deleteMany({ where: { customerNumber: { startsWith: TAG } } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
});

describe("Policy export routes (real DB)", () => {
  it("unknown category -> 404", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT_USER() });
    const res = await callExport("spaceship");
    expect(res.status).toBe(404);
  });

  it("permission enforced server-side (403) even though the button is visible to viewers", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: NO_MOTOR_USER() });
    expect((await callExport("motor")).status).toBe(403);
    auth.mockResolvedValue(null);
    expect((await callExport("motor")).status).toBe(403);
    auth.mockResolvedValue({ user: VIEW_USER() });
    expect((await callExport("motor")).status).toBe(200); // view is enough to export
  });

  // The dev DB already holds real policies, so every count assertion is
  // scoped to this suite's own seeded records by their TAG-prefixed record
  // number (column 0).
  const mine = (rows: string[][]) => rows.filter((r) => r[0]?.startsWith(TAG));

  it("11: exports ALL matching rows, not just one page (31 Motor for customer A, via customer filter)", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT_USER() });
    const { rows } = await parseSheet(await callExport("motor", { customer: `${TAG} Alpha` }));
    expect(mine(rows).length).toBe(31); // 30 base + 1 owing, well beyond one page of 25
  });

  it("5/6/8/9: respects customer + contact + insurer + type + valuation filters", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT_USER() });

    const byCustomerB = await parseSheet(await callExport("motor", { customer: `${TAG} Beta` }));
    expect(mine(byCustomerB.rows).length).toBe(1);

    const byContact = await parseSheet(await callExport("motor", { contact: "bob" }));
    expect(mine(byContact.rows).length).toBe(1); // server-side ILIKE on customerContactPerson

    const byTypeForB = await parseSheet(await callExport("motor", { customer: `${TAG} Beta`, type: "THIRD PARTY" }));
    expect(mine(byTypeForB.rows).length).toBe(1);
    const byTypeForA = await parseSheet(await callExport("motor", { customer: `${TAG} Alpha`, type: "THIRD PARTY" }));
    expect(mine(byTypeForA.rows).length).toBe(0);

    const byInsurer = await parseSheet(await callExport("motor", { customer: `${TAG} Beta`, insurer: "APA" }));
    expect(mine(byInsurer.rows).length).toBe(1);

    const byValuation = await parseSheet(await callExport("motor", { customer: `${TAG} Alpha`, valuationStatus: "COMPLETED" }));
    expect(mine(byValuation.rows).length).toBe(1); // only KAA-OWING is COMPLETED
  });

  it("7: respects the Expiry From / To range (server-side)", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT_USER() });
    const inWindow = await parseSheet(
      await callExport("motor", { customer: `${TAG} Alpha`, expiryFrom: "2026-12-01", expiryTo: "2026-12-31" })
    );
    expect(mine(inWindow.rows).length).toBe(1); // only the owing record expires 2026-12-20
    const outOfWindow = await parseSheet(
      await callExport("motor", { customer: `${TAG} Alpha`, expiryFrom: "2027-06-01", expiryTo: "2027-12-31" })
    );
    expect(mine(outOfWindow.rows).length).toBe(0);
  });

  it("10: combined filters compose with AND", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT_USER() });
    const combined = await parseSheet(
      await callExport("motor", {
        customer: `${TAG} Alpha`, insurer: "Jubilee", type: "COMPREHENSIVE", expiryFrom: "2026-12-01", expiryTo: "2026-12-31",
      })
    );
    expect(mine(combined.rows).length).toBe(1);
    const contradiction = await parseSheet(await callExport("motor", { customer: `${TAG} Beta`, type: "COMPREHENSIVE" }));
    expect(mine(contradiction.rows).length).toBe(0);
  });

  it("respects the outstanding-client-balance filter (rows narrowed, amounts still hidden)", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT_USER() });
    const owing = await parseSheet(await callExport("motor", { customer: `${TAG} Alpha`, outstandingClientOnly: "1" }));
    // base records are fully paid; only KAA-OWING (2000 premium, 500 received) still owes
    expect(mine(owing.rows).length).toBe(1);
  });

  it("12-15 / 19: NO premium / cost / balance / commission column anywhere", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT_USER() });
    for (const category of ["motor", "non-motor", "bond", "work-permit"]) {
      const { headers, rows } = await parseSheet(await callExport(category, { customer: `${TAG} Alpha` }));
      const joined = headers.join(" | ").toLowerCase();
      for (const banned of ["premium", "cost", "balance", "commission", "amount", "保费", "余额", "佣金"]) {
        expect(joined, `${category} headers must not contain "${banned}"`).not.toContain(banned);
      }
      for (const row of mine(rows)) {
        expect(row.join(" ")).not.toMatch(/\b(1000|2000|800|500)\.00\b/);
      }
      expect(headers).not.toContain("Actions");
      expect(mine(rows).length).toBeGreaterThan(0);
    }
  });

  it("15: Motor export DOES carry Contact Person / Expiry / identifiers + Renewal + Valuation", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT_USER() });
    const { headers, rows } = await parseSheet(await callExport("motor", { customer: `${TAG} Beta` }));
    expect(headers).toEqual([
      "Record Number", "Processing Date", "Customer", "Contact Person", "Type of Cover",
      "Registration Number", "Insurer", "Valuation", "Expiry Date", "Status", "Renewal Status",
    ]);
    const row = mine(rows)[0];
    expect(row).toContain("Bob");
    expect(row).toContain("2027-01-01");
    expect(row.some((c) => c.includes(`${TAG} KBB1`))).toBe(true);
    expect(row).toContain("Original");
  });

  it("16/17/18: non-motor / bond / work-permit exports respect the customer filter", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT_USER() });
    for (const category of ["non-motor", "bond", "work-permit"]) {
      const forA = await parseSheet(await callExport(category, { customer: `${TAG} Alpha` }));
      expect(mine(forA.rows).length).toBe(1);
      const forB = await parseSheet(await callExport(category, { customer: `${TAG} Beta` }));
      expect(mine(forB.rows).length).toBe(0);
    }
  });

  it("null-safe: a sparse record (null insurer / contact / valuation) + a renewal chain export without throwing", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT_USER() });
    const { headers, rows } = await parseSheet(await callExport("motor", { customer: `${TAG} Gamma` }));
    expect(headers).toEqual([
      "Record Number", "Processing Date", "Customer", "Contact Person", "Type of Cover",
      "Registration Number", "Insurer", "Valuation", "Expiry Date", "Status", "Renewal Status",
    ]);
    const ours = mine(rows);
    expect(ours.length).toBe(3); // sparse + original + renewal

    const sparse = ours.find((r) => r.some((c) => c.includes("KCC-SPARSE")))!;
    expect(sparse[3]).toBe(""); // Contact Person — blank, not "undefined"/"null"
    expect(sparse[6]).toBe(""); // Insurer — blank
    expect(sparse[7]).toBe(""); // Valuation — blank (no status)
    expect(sparse[10]).toBe("Original"); // Renewal Status — original

    const renew = ours.find((r) => r.some((c) => c.includes("KCC-RENEW")))!;
    expect(renew[10]).toBe("Renewal 1");
    const orig = ours.find((r) => r.some((c) => c.includes("KCC-ORIG")))!;
    expect(orig[10]).toBe("Renewed");

    // absolutely no cell is the literal "undefined" / "null" / "NaN"
    for (const row of ours) {
      for (const cell of row) expect(["undefined", "null", "NaN"]).not.toContain(cell);
    }
  });

  it("27: 中文 headers render when the locale cookie is zh", async () => {
    if (!dbReachable) return;
    auth.mockResolvedValue({ user: EDIT_USER() });
    getLocale.mockResolvedValueOnce("zh");
    const { headers } = await parseSheet(await callExport("motor", { customer: `${TAG} Beta` }));
    expect(headers[0]).not.toBe("Record Number"); // translated
    expect(headers.join("")).toMatch(/[一-鿿]/);
  });
});
