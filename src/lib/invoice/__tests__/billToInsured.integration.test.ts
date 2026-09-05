import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { config as loadDotenv } from "dotenv";

loadDotenv();

// Phase 12B — real-Postgres + real-Excel-template end-to-end for the Invoice
// Bill-To / insured split. Exercises the ACTUAL createInvoiceAction (real
// prisma, real invoiceTemplateEngine, real local storage), only stubbing
// auth / next-cache / the Dropbox sync side-effect. Seeds and cleans up all
// its own rows + generated files. Skips itself when no DB is reachable.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/integrations/dropbox/invoiceDocumentSync", () => ({
  syncInvoiceDocumentWithTimeout: vi.fn(async () => undefined),
}));

let dbReachable = true;
let prisma: typeof import("@/lib/prisma").prisma;
let createInvoiceAction: typeof import("@/app/(app)/invoice/actions").createInvoiceAction;
let auth: ReturnType<typeof vi.fn>;

const TAG = `p12b-${randomUUID().slice(0, 8)}`;
const STORAGE_ROOT = path.resolve(process.env.INVOICE_DOCUMENT_STORAGE_ROOT || path.join(process.cwd(), "invoice-documents"));

let userId = "";
const custId: Record<"A" | "B" | "C", string> = { A: "", B: "", C: "" };
const policyId: Record<string, string> = {};
const createdInvoiceNumbers: string[] = [];
const createdInvoiceIds: string[] = [];

async function seedPolicy(key: string, customerId: string) {
  const rec = await prisma.policyRecord.create({
    data: {
      recordNumber: `${TAG}-${key}`,
      category: "MOTOR",
      processingDate: new Date("2026-02-01"),
      customerId,
      effectiveDate: new Date("2026-02-01"),
      expiryDate: new Date("2027-01-31"),
      businessStatus: "ACTIVE",
      customerPremium: 1000,
      insurerCost: 800,
      createdById: userId,
      motorDetail: { create: { insuranceType: "COMPREHENSIVE", registrationNumber: `${TAG}${key}`, policyNumber: `POLNO-${TAG}-${key}` } },
    },
  });
  policyId[key] = rec.id;
}

beforeAll(async () => {
  try {
    ({ prisma } = await import("@/lib/prisma"));
    ({ createInvoiceAction } = await import("@/app/(app)/invoice/actions"));
    ({ auth } = (await import("@/lib/auth")) as unknown as { auth: ReturnType<typeof vi.fn> });
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("billToInsured.integration.test: no reachable database — skipping.", err);
    dbReachable = false;
    return;
  }

  auth.mockResolvedValue({ user: { id: "seed", role: "Admin", status: "ACTIVE", permissions: [] } });

  const user = await prisma.user.create({ data: { username: `${TAG}-u`, fullName: `${TAG} user`, passwordHash: "x", status: "ACTIVE" } });
  userId = user.id;
  for (const k of ["A", "B", "C"] as const) {
    const c = await prisma.customer.create({
      data: { customerNumber: `${TAG}-${k}`, companyName: `Company ${k} Ltd ${TAG}`, pinNumber: `PIN-${k}-${TAG}` },
    });
    custId[k] = c.id;
  }
  await seedPolicy("A1", custId.A);
  await seedPolicy("A2", custId.A);
  await seedPolicy("C1", custId.C);

  auth.mockResolvedValue({ user: { id: userId, role: "Staff", status: "ACTIVE", permissions: ["invoice.edit"] } });
});

afterAll(async () => {
  if (!dbReachable) return;
  if (createdInvoiceIds.length) await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
  await prisma.policyRecord.deleteMany({ where: { recordNumber: { startsWith: TAG } } });
  await prisma.customer.deleteMany({ where: { customerNumber: { startsWith: TAG } } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  for (const num of createdInvoiceNumbers) {
    await fs.rm(path.join(STORAGE_ROOT, num), { recursive: true, force: true }).catch(() => {});
  }
});

async function create(billToId: string, policyKeys: string[]) {
  const res = await createInvoiceAction({
    customerId: billToId,
    policyRecordIds: policyKeys.map((k) => policyId[k]),
    invoiceDate: "2026-09-01",
  });
  if (res.success) {
    createdInvoiceIds.push(res.id);
    createdInvoiceNumbers.push(res.invoiceNumber);
  }
  return res;
}

describe("Invoice Bill-To / insured — real DB + real template", () => {
  it("B2: Bill-To == insured -> customerId = insured, all insured snapshot fields NULL", async () => {
    if (!dbReachable) return;
    const res = await create(custId.A, ["A1"]);
    expect(res.success).toBe(true);
    if (!res.success) return;
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: res.id } });
    expect(inv.customerId).toBe(custId.A);
    expect(inv.insuredCustomerId).toBeNull();
    expect(inv.insuredNameSnapshot).toBeNull();
    expect(inv.insuredPinSnapshot).toBeNull();
  });

  it("B3: Bill-To != insured -> customerId = Bill-To, insured snapshot captured; Excel addressed to Bill-To", async () => {
    if (!dbReachable) return;
    const res = await create(custId.B, ["A2"]);
    expect(res.success).toBe(true);
    if (!res.success) return;
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: res.id }, include: { items: true } });
    expect(inv.customerId).toBe(custId.B);
    expect(inv.insuredCustomerId).toBe(custId.A);
    expect(inv.insuredNameSnapshot).toBe(`Company A Ltd ${TAG}`);
    expect(inv.insuredPinSnapshot).toBe(`PIN-A-${TAG}`);
    // B7: item still linked to the insured's policy.
    expect(inv.items.map((i) => i.policyRecordId)).toEqual([policyId.A2]);

    // B8: the generated .xlsx is addressed to Company B, not Company A.
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(STORAGE_ROOT, inv.generatedStoragePath!));
    const text: string[] = [];
    wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === "string") text.push(cell.value); })));
    const joined = text.join(" | ");
    expect(joined).toContain(`Company B Ltd ${TAG}`);
    expect(joined).toContain(`PIN-B-${TAG}`);
    expect(joined).not.toContain(`Company A Ltd ${TAG}`);
  });

  it("B5: two policies with different insured customers -> rejected, no invoice", async () => {
    if (!dbReachable) return;
    const before = await prisma.invoice.count();
    const res = await create(custId.B, ["A1", "C1"]);
    expect(res).toEqual({ success: false, error: "SAME_INSURED_REQUIRED" });
    expect(await prisma.invoice.count()).toBe(before);
  });

  it("B6: non-existent Bill-To customer -> rejected", async () => {
    if (!dbReachable) return;
    const res = await create("cust-nope-nope", ["C1"]);
    expect(res).toEqual({ success: false, error: "BILL_TO_NOT_FOUND" });
  });

  it("B10: the insured policy still lists the invoice via InvoiceItem even when Bill-To differs", async () => {
    if (!dbReachable) return;
    const items = await prisma.invoiceItem.findMany({
      where: { policyRecordId: policyId.A2 },
      include: { invoice: { select: { customerId: true, status: true } } },
    });
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((i) => i.invoice.customerId === custId.B && i.invoice.status === "ISSUED")).toBe(true);
  });

  it("an already-invoiced policy is rejected with the eligibility error, never a Bill-To/insured error", async () => {
    if (!dbReachable) return;
    // A1 got an ISSUED invoice in B2. Re-invoicing it (with any Bill-To)
    // must fail on eligibility, not SAME_INSURED_REQUIRED / BILL_TO_NOT_FOUND.
    // (B4's multi-policy-same-insured success path is covered by the mocked
    // unit test actions.billTo.test.ts, which can freely arrange fresh
    // policies.)
    const res = await create(custId.B, ["A1"]);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/^POLICY_NOT_ELIGIBLE_/);
  });
});
