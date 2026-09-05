import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma as RealPrisma } from "@/generated/prisma/client";

// Phase 12B — Invoice Bill-To customer override. createInvoiceAction's
// insured customer is now DERIVED from the selected policies (all must
// share one), and input.customerId is the BILL-TO customer (may differ).
// Mocks mirror actions.concurrency.test.ts's approach (in-memory prisma +
// mocked template/storage/sync/cache/auth).

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "user-1", role: "Staff", status: "ACTIVE", permissions: ["invoice.edit"] } })),
}));

vi.mock("@/lib/invoice/recordNumber", () => {
  let seq = 0;
  return { generateInvoiceNumber: vi.fn(async () => { seq += 1; return `INV202609-${String(seq).padStart(4, "0")}`; }) };
});

const generateExcelMock = vi.fn(async () => Buffer.from("fake-xlsx"));
vi.mock("@/lib/invoiceTemplateEngine", () => ({
  generateInvoiceExcelBuffer: (...a: unknown[]) => generateExcelMock(...a),
  InvoiceTemplateValidationError: class extends Error {},
  InvoiceTemplateNotFoundError: class extends Error {},
}));
vi.mock("@/lib/invoiceDocuments/storage", () => ({
  invoiceDocumentStorage: { saveFile: vi.fn(async () => ({ storagePath: "fake/path.xlsx" })) },
}));
vi.mock("@/lib/integrations/dropbox/invoiceDocumentSync", () => ({
  syncInvoiceDocumentWithTimeout: vi.fn(async () => undefined),
}));
vi.mock("@/generated/prisma/client", async () => {
  const actual = await vi.importActual<typeof import("@/generated/prisma/client")>("@/generated/prisma/client");
  return { ...actual, Prisma: { ...actual.Prisma, join: (ids: unknown) => ids } };
});

type FakeCustomer = { id: string; companyName: string; pinNumber: string };
type FakePolicy = {
  id: string;
  category: "MOTOR";
  customerId: string;
  customer: { companyName: string; pinNumber: string };
  deletedAt: null;
  businessStatus: "ACTIVE";
  customerPremium: InstanceType<typeof RealPrisma.Decimal>;
  motorDetail: { insuranceType: string; policyNumber: string };
  nonMotorDetail: null;
  bondDetail: null;
  workPermitDetail: null;
  invoiceItems: { invoice: { id: string; invoiceNumber: string; status: string } }[];
};

let customers: Map<string, FakeCustomer>;
let policies: Map<string, FakePolicy>;
let createdInvoices: Record<string, unknown>[];
let createdItems: Record<string, unknown>[];

const txQueue = { p: Promise.resolve() as Promise<unknown> };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => customers.get(where.id) ?? null) },
    policyRecord: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => policies.get(id)).filter(Boolean)
      ),
    },
    invoice: { update: vi.fn(async () => ({})), delete: vi.fn(async () => ({})) },
    $transaction: vi.fn((cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        $queryRaw: vi.fn(async () => []),
        policyRecord: {
          findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
            where.id.in.map((id) => policies.get(id)).filter(Boolean)
          ),
        },
        invoice: {
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            const id = `inv-${createdInvoices.length + 1}`;
            createdInvoices.push({ id, ...data });
            return { id, invoiceNumber: data.invoiceNumber };
          }),
        },
        invoiceItem: {
          createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => { createdItems.push(...data); }),
        },
        policyActivity: { create: vi.fn(async () => ({})) },
      };
      const run = txQueue.p.then(() => cb(tx), () => cb(tx));
      txQueue.p = run.then(() => undefined, () => undefined);
      return run;
    }),
  },
}));

function makePolicy(id: string, customerId: string): FakePolicy {
  const c = customers.get(customerId)!;
  return {
    id, category: "MOTOR", customerId,
    customer: { companyName: c.companyName, pinNumber: c.pinNumber },
    deletedAt: null, businessStatus: "ACTIVE",
    customerPremium: new RealPrisma.Decimal(1000),
    motorDetail: { insuranceType: "Comprehensive", policyNumber: `POL-${id}` },
    nonMotorDetail: null, bondDetail: null, workPermitDetail: null,
    invoiceItems: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  txQueue.p = Promise.resolve();
  customers = new Map([
    ["cust-a", { id: "cust-a", companyName: "Company A", pinNumber: "PIN-A-001" }],
    ["cust-b", { id: "cust-b", companyName: "Company B", pinNumber: "PIN-B-002" }],
    ["cust-c", { id: "cust-c", companyName: "Company C", pinNumber: "PIN-C-003" }],
  ]);
  policies = new Map();
  createdInvoices = [];
  createdItems = [];
});

async function run(input: { customerId: string; policyRecordIds: string[]; invoiceDate?: string }) {
  const { createInvoiceAction } = await import("../actions");
  return createInvoiceAction({ invoiceDate: "2026-09-01", ...input });
}

describe("createInvoiceAction — Phase 12B Bill-To / insured", () => {
  it("B2: insured A, Bill-To A -> succeeds, customerId=A, insured snapshot fields all NULL", async () => {
    policies.set("p1", makePolicy("p1", "cust-a"));
    const r = await run({ customerId: "cust-a", policyRecordIds: ["p1"] });
    expect(r.success).toBe(true);
    const inv = createdInvoices[0];
    expect(inv.customerId).toBe("cust-a");
    expect(inv.insuredCustomerId).toBeNull();
    expect(inv.insuredNameSnapshot).toBeNull();
    expect(inv.insuredPinSnapshot).toBeNull();
  });

  it("B3: insured A, Bill-To B -> succeeds, customerId=B, insuredCustomerId=A, name/PIN snapshot = A's", async () => {
    policies.set("p1", makePolicy("p1", "cust-a"));
    const r = await run({ customerId: "cust-b", policyRecordIds: ["p1"] });
    expect(r.success).toBe(true);
    const inv = createdInvoices[0];
    expect(inv.customerId).toBe("cust-b");
    expect(inv.insuredCustomerId).toBe("cust-a");
    expect(inv.insuredNameSnapshot).toBe("Company A");
    expect(inv.insuredPinSnapshot).toBe("PIN-A-001");
  });

  it("B3: the printed Excel is addressed to the BILL-TO customer (Company B), never the insured", async () => {
    policies.set("p1", makePolicy("p1", "cust-a"));
    await run({ customerId: "cust-b", policyRecordIds: ["p1"] });
    expect(generateExcelMock).toHaveBeenCalledTimes(1);
    const arg = generateExcelMock.mock.calls[0][0] as { customerName: string; customerPin: string };
    expect(arg.customerName).toBe("Company B");
    expect(arg.customerPin).toBe("PIN-B-002");
  });

  it("B4: multiple policies, same insured A, Bill-To B -> succeeds", async () => {
    policies.set("p1", makePolicy("p1", "cust-a"));
    policies.set("p2", makePolicy("p2", "cust-a"));
    const r = await run({ customerId: "cust-b", policyRecordIds: ["p1", "p2"] });
    expect(r.success).toBe(true);
    expect(createdInvoices[0].insuredCustomerId).toBe("cust-a");
    expect(createdItems).toHaveLength(2);
  });

  it("B5: multiple policies with DIFFERENT insured customers -> rejected SAME_INSURED_REQUIRED, no invoice created", async () => {
    policies.set("p1", makePolicy("p1", "cust-a"));
    policies.set("p2", makePolicy("p2", "cust-c"));
    const r = await run({ customerId: "cust-b", policyRecordIds: ["p1", "p2"] });
    expect(r).toEqual({ success: false, error: "SAME_INSURED_REQUIRED" });
    expect(createdInvoices).toHaveLength(0);
  });

  it("B5: the Bill-To customer is never used to decide grouping (same Bill-To, different insured still rejected)", async () => {
    policies.set("p1", makePolicy("p1", "cust-a"));
    policies.set("p2", makePolicy("p2", "cust-b"));
    const r = await run({ customerId: "cust-a", policyRecordIds: ["p1", "p2"] });
    expect(r).toEqual({ success: false, error: "SAME_INSURED_REQUIRED" });
  });

  it("B6: Bill-To customer id does not exist -> rejected BILL_TO_NOT_FOUND", async () => {
    policies.set("p1", makePolicy("p1", "cust-a"));
    const r = await run({ customerId: "cust-does-not-exist", policyRecordIds: ["p1"] });
    expect(r).toEqual({ success: false, error: "BILL_TO_NOT_FOUND" });
  });

  it("B7: InvoiceItem rows still link to the source policyRecordId, unaffected by Bill-To", async () => {
    policies.set("p1", makePolicy("p1", "cust-a"));
    await run({ customerId: "cust-b", policyRecordIds: ["p1"] });
    expect(createdItems[0].policyRecordId).toBe("p1");
  });

  it("B13: a VIEW-only session cannot create an invoice (Bill-To choice included)", async () => {
    const { auth } = await import("@/lib/auth");
    (auth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "u2", role: "Staff", status: "ACTIVE", permissions: ["invoice.view"] },
    });
    policies.set("p1", makePolicy("p1", "cust-a"));
    const r = await run({ customerId: "cust-b", policyRecordIds: ["p1"] });
    expect(r).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("the old POLICY_CUSTOMER_MISMATCH error is never returned anymore", async () => {
    policies.set("p1", makePolicy("p1", "cust-a"));
    const r = await run({ customerId: "cust-b", policyRecordIds: ["p1"] });
    expect(r.success).toBe(true);
  });
});
