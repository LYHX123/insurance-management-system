import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma as RealPrisma } from "@/generated/prisma/client";

// Production Readiness Audit V1, finding H4: createInvoiceAction previously
// checked eligibility (ALREADY_INVOICED) against a pre-transaction snapshot
// and never re-verified it under a lock before writing — two concurrent
// requests for the same policy could both pass the check and both create an
// ISSUED invoice. This proves the fix: the transaction now takes a
// `SELECT ... FOR UPDATE` row lock on the target policies and re-checks
// eligibility (the real, unmocked checkPolicyInvoiceEligibility) against
// freshly-read data before allocating a number or writing anything.
//
// $transaction below is modeled as a simple FIFO mutex around the callback
// (not a full per-row lock simulation) — sufficient here because the
// production code takes its lock as the very first statement inside the
// transaction, so "only one transaction body runs at a time, in order" is a
// faithful stand-in for "the second transaction blocks on FOR UPDATE until
// the first commits" for the purposes of this test. Real per-policy lock
// granularity (two DIFFERENT policies proceeding independently) is not what
// this mock models — that's a database-engine guarantee, not application
// logic, and outside what a unit test needs to re-prove.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "user-1", role: "Staff", status: "ACTIVE", permissions: ["invoice.edit"] } })),
}));

vi.mock("@/lib/invoice/recordNumber", () => {
  let seq = 0;
  return {
    generateInvoiceNumber: vi.fn(async () => {
      seq += 1;
      return `INV202608-${String(seq).padStart(4, "0")}`;
    }),
  };
});

vi.mock("@/lib/invoiceTemplateEngine", () => ({
  generateInvoiceExcelBuffer: vi.fn(async () => Buffer.from("fake-xlsx")),
  InvoiceTemplateValidationError: class InvoiceTemplateValidationError extends Error {},
  InvoiceTemplateNotFoundError: class InvoiceTemplateNotFoundError extends Error {},
}));

vi.mock("@/lib/invoiceDocuments/storage", () => ({
  invoiceDocumentStorage: { saveFile: vi.fn(async () => ({ storagePath: "fake/path.xlsx" })) },
}));

vi.mock("@/lib/integrations/dropbox/invoiceDocumentSync", () => ({
  syncInvoiceDocumentWithTimeout: vi.fn(async () => undefined),
}));

// Prisma.join is used to build the `IN (...)` list for the FOR UPDATE lock
// query — identity here so the mock $queryRaw below never has to model
// Prisma's real Sql fragment type. Everything else (Prisma.Decimal etc.,
// needed by src/lib/money.ts) comes from the real module.
vi.mock("@/generated/prisma/client", async () => {
  const actual = await vi.importActual<typeof import("@/generated/prisma/client")>("@/generated/prisma/client");
  return { ...actual, Prisma: { ...actual.Prisma, join: (ids: unknown) => ids } };
});

type FakePolicyRecord = {
  id: string;
  category: "MOTOR";
  customerId: string;
  deletedAt: null;
  businessStatus: string;
  customerPremium: InstanceType<typeof RealPrisma.Decimal>;
  motorDetail: { insuranceType: string; policyNumber: string };
  nonMotorDetail: null;
  bondDetail: null;
  workPermitDetail: null;
};
type FakeInvoice = { id: string; invoiceNumber: string; status: "ISSUED" | "CANCELLED" };
type FakeInvoiceItem = { id: string; invoiceId: string; policyRecordId: string };

let policyRecords: Map<string, FakePolicyRecord>;
let invoices: Map<string, FakeInvoice>;
let invoiceItems: FakeInvoiceItem[];
let customers: Map<string, { id: string; companyName: string; pinNumber: string }>;
let idCounter = 0;

// The same shape POLICY_FOR_INVOICE_INCLUDE produces from a real Prisma
// query — built fresh from the current (possibly just-committed-by-another-
// transaction) fake tables every time it's called, exactly like a real
// `tx.policyRecord.findMany` re-read would reflect the latest committed
// rows once a prior transaction holding the lock has released it.
function policyForInvoiceView(id: string) {
  const base = policyRecords.get(id);
  if (!base) return null;
  return {
    ...base,
    invoiceItems: invoiceItems
      .filter((i) => i.policyRecordId === id)
      .map((i) => ({
        invoice: {
          id: i.invoiceId,
          invoiceNumber: invoices.get(i.invoiceId)!.invoiceNumber,
          status: invoices.get(i.invoiceId)!.status,
        },
      })),
  };
}

function buildTx() {
  return {
    $queryRaw: vi.fn(async () => []), // the FOR UPDATE lock statement — no rows needed by the caller
    policyRecord: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        return where.id.in.map((id) => policyForInvoiceView(id)).filter((r): r is NonNullable<typeof r> => r !== null);
      }),
    },
    invoice: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        idCounter += 1;
        const id = `inv-${idCounter}`;
        invoices.set(id, { id, invoiceNumber: data.invoiceNumber as string, status: "ISSUED" });
        return { id, invoiceNumber: data.invoiceNumber as string };
      }),
    },
    invoiceItem: {
      createMany: vi.fn(async ({ data }: { data: { invoiceId: string; policyRecordId: string }[] }) => {
        for (const row of data) {
          idCounter += 1;
          invoiceItems.push({ id: `item-${idCounter}`, invoiceId: row.invoiceId, policyRecordId: row.policyRecordId });
        }
      }),
    },
    policyActivity: { create: vi.fn(async () => ({})) },
  };
}

// FIFO mutex around the transaction body — see file header comment.
let txQueue: Promise<unknown> = Promise.resolve();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => customers.get(where.id) ?? null) },
    // The pre-transaction fast-fail check (createInvoiceAction's own first
    // read, before the authoritative in-transaction recheck) uses this same
    // top-level prisma.policyRecord.findMany, not tx's.
    policyRecord: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
        return where.id.in.map((id) => policyForInvoiceView(id)).filter((r): r is NonNullable<typeof r> => r !== null);
      }),
    },
    invoice: {
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn((cb: (tx: ReturnType<typeof buildTx>) => Promise<unknown>) => {
      const run = txQueue.then(
        () => cb(buildTx()),
        () => cb(buildTx()) // a prior queued transaction's rejection never poisons this independent one
      );
      txQueue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }),
  },
}));

function makePolicy(id: string, customerId: string): FakePolicyRecord {
  return {
    id,
    category: "MOTOR",
    customerId,
    deletedAt: null,
    businessStatus: "ACTIVE",
    customerPremium: new RealPrisma.Decimal(1000),
    motorDetail: { insuranceType: "Comprehensive", policyNumber: "POL-0001" },
    nonMotorDetail: null,
    bondDetail: null,
    workPermitDetail: null,
  };
}

describe("createInvoiceAction — H4 concurrency safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txQueue = Promise.resolve();
    idCounter = 0;
    customers = new Map([["cust-1", { id: "cust-1", companyName: "Acme Ltd", pinNumber: "P000111222A" }]]);
    policyRecords = new Map([["pol-1", makePolicy("pol-1", "cust-1")]]);
    invoices = new Map();
    invoiceItems = [];
  });

  it("1. a normal single Create Invoice succeeds", async () => {
    const { createInvoiceAction } = await import("../actions");
    const result = await createInvoiceAction({ customerId: "cust-1", policyRecordIds: ["pol-1"], invoiceDate: "2026-08-01" });
    expect(result.success).toBe(true);
  });

  it("2/3. Promise.all two concurrent create requests for the SAME policy -> only one Invoice is created", async () => {
    const { createInvoiceAction } = await import("../actions");

    const [r1, r2] = await Promise.all([
      createInvoiceAction({ customerId: "cust-1", policyRecordIds: ["pol-1"], invoiceDate: "2026-08-01" }),
      createInvoiceAction({ customerId: "cust-1", policyRecordIds: ["pol-1"], invoiceDate: "2026-08-01" }),
    ]);

    const results = [r1, r2];
    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // 4. Database final Invoice count matches the business rule: exactly
    // one ISSUED invoice for this policy, never two.
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    if (!failed[0].success) {
      expect(failed[0].error).toBe("POLICY_NOT_ELIGIBLE_ALREADY_INVOICED");
    }
    expect(invoiceItems.filter((i) => i.policyRecordId === "pol-1")).toHaveLength(1);

    // 5. Invoice number uniqueness: only one Invoice row (and therefore only
    // one allocated number) ever actually got committed.
    expect(invoices.size).toBe(1);
  });

  it("6. the existing Invoice creation flow still works normally for two DIFFERENT policies", async () => {
    policyRecords.set("pol-2", makePolicy("pol-2", "cust-1"));
    const { createInvoiceAction } = await import("../actions");

    const [r1, r2] = await Promise.all([
      createInvoiceAction({ customerId: "cust-1", policyRecordIds: ["pol-1"], invoiceDate: "2026-08-01" }),
      createInvoiceAction({ customerId: "cust-1", policyRecordIds: ["pol-2"], invoiceDate: "2026-08-01" }),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(invoices.size).toBe(2);
  });

  it("7. permission check: VIEW-only cannot create an Invoice", async () => {
    const { auth } = await import("@/lib/auth");
    (auth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "user-1", role: "Staff", status: "ACTIVE", permissions: ["invoice.view"] },
    });
    const { createInvoiceAction } = await import("../actions");

    const result = await createInvoiceAction({ customerId: "cust-1", policyRecordIds: ["pol-1"], invoiceDate: "2026-08-01" });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("8. EDIT can create an Invoice", async () => {
    const { createInvoiceAction } = await import("../actions");
    const result = await createInvoiceAction({ customerId: "cust-1", policyRecordIds: ["pol-1"], invoiceDate: "2026-08-01" });
    expect(result.success).toBe(true);
  });

  it("9. Admin can create an Invoice", async () => {
    const { auth } = await import("@/lib/auth");
    (auth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "admin-1", role: "Admin", status: "ACTIVE", permissions: [] },
    });
    const { createInvoiceAction } = await import("../actions");

    const result = await createInvoiceAction({ customerId: "cust-1", policyRecordIds: ["pol-1"], invoiceDate: "2026-08-01" });

    expect(result.success).toBe(true);
  });
});
