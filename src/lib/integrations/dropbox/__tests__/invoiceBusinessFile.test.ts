import { describe, it, expect, vi, beforeEach } from "vitest";

// Category A — Invoice business-folder resolution (Phase 6, Part 2/14.A).
// policyBusinessFile.ts is mocked out here (it has no dedicated test file of
// its own either — the same isolation choice this project already makes for
// syncCustomerFolder in customerDocumentSync.test.ts) so these tests isolate
// invoiceBusinessFile.ts's own resolution logic: does it correctly decide
// "reuse the single linked Policy's business file" vs "use my own
// INVOICE_FALLBACK", without re-testing Policy's own QUOTATION_CASE/
// POLICY_FALLBACK internals.

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  customer: { shortName: string | null; companyName: string; customerNumber: string };
  items: { policyRecordId: string }[];
  dropboxBusinessFile: BizFileRow | null;
};
type BizFileRow = {
  id: string;
  invoiceId: string;
  businessDate: Date;
  insuranceTypeCode: string;
  customerShortName: string;
  businessTitle: string;
  businessFolderName: string;
  dropboxFolderId: string | null;
  dropboxDisplayPath: string | null;
  dropboxPathLower: string | null;
  syncStatus: string;
  lastErrorMessage: string | null;
};

let invoices: Map<string, InvoiceRow>;
let bizFiles: Map<string, BizFileRow>; // keyed by invoiceId

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const inv = invoices.get(where.id);
        if (!inv) return null;
        return { ...inv, dropboxBusinessFile: bizFiles.get(inv.id) ?? null };
      }),
    },
    invoiceDropboxBusinessFile: {
      create: vi.fn(async ({ data }: { data: Omit<BizFileRow, "id"> }) => {
        if (bizFiles.has(data.invoiceId)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        const row: BizFileRow = { id: `biz-${data.invoiceId}`, ...data };
        bizFiles.set(data.invoiceId, row);
        return row;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { invoiceId: string } }) => {
        const row = bizFiles.get(where.invoiceId);
        if (!row) throw new Error("Not found");
        return row;
      }),
    },
  },
}));

const ensurePolicyDropboxBusinessFile = vi.fn();
const resolvePolicyBusinessFileRefReadOnly = vi.fn();
vi.mock("@/lib/integrations/dropbox/policyBusinessFile", () => ({
  ensurePolicyDropboxBusinessFile: (...args: unknown[]) => ensurePolicyDropboxBusinessFile(...args),
  resolvePolicyBusinessFileRefReadOnly: (...args: unknown[]) => resolvePolicyBusinessFileRefReadOnly(...args),
}));

const CUSTOMER = { shortName: "ACME", companyName: "Acme Ltd", customerNumber: "CUST-0001" };

function invoiceRow(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "inv-1",
    invoiceNumber: "INV202607-0001",
    invoiceDate: new Date("2026-07-30"),
    customer: CUSTOMER,
    items: [{ policyRecordId: "pol-1" }],
    dropboxBusinessFile: null,
    ...overrides,
  };
}

describe("ensureInvoiceDropboxBusinessFile — resolution (Phase 6, Category A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoices = new Map([["inv-1", invoiceRow()]]);
    bizFiles = new Map();
  });

  it("A1: single Policy linked to a Quotation -> reuses the Quotation business folder (QUOTATION_CASE)", async () => {
    ensurePolicyDropboxBusinessFile.mockResolvedValue({
      ok: true,
      ref: { source: "QUOTATION_CASE", businessFileId: "qbf-1", businessFolderName: "20260730-MOTOR-KDQ175V", dropboxDisplayPath: null, dropboxFolderId: null, syncStatus: "PENDING", lastErrorMessage: null },
    });
    const { ensureInvoiceDropboxBusinessFile } = await import("../invoiceBusinessFile");

    const result = await ensureInvoiceDropboxBusinessFile("inv-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ref.source).toBe("QUOTATION_CASE");
      expect(result.ref.businessFolderName).toBe("20260730-MOTOR-KDQ175V");
    }
    expect(ensurePolicyDropboxBusinessFile).toHaveBeenCalledWith("pol-1");
    expect(bizFiles.size).toBe(0); // no InvoiceDropboxBusinessFile row created — reused the Policy's
  });

  it("A2: single Policy with no Quotation link -> reuses the Policy's own fallback folder (POLICY_FALLBACK)", async () => {
    ensurePolicyDropboxBusinessFile.mockResolvedValue({
      ok: true,
      ref: { source: "POLICY_FALLBACK", businessFileId: "pbf-1", businessFolderName: "20260730-MOTOR-PM202607-0002", dropboxDisplayPath: null, dropboxFolderId: null, syncStatus: "PENDING", lastErrorMessage: null },
    });
    const { ensureInvoiceDropboxBusinessFile } = await import("../invoiceBusinessFile");

    const result = await ensureInvoiceDropboxBusinessFile("inv-1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ref.source).toBe("POLICY_FALLBACK");
    expect(bizFiles.size).toBe(0);
  });

  it("A3 (direct-to-Quotation is not a distinct schema path): resolving through the single Policy already covers it — no separate code path invented", async () => {
    // Confirms invoiceBusinessFile.ts never queries QuotationCase/Quotation
    // directly — the only integration point is ensurePolicyDropboxBusinessFile.
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const source = readFileSync(join(__dirname, "..", "invoiceBusinessFile.ts"), "utf8");
    expect(source).not.toMatch(/prisma\.quotationCase\.|prisma\.quotation\./);
  });

  it("A4: unlinked Invoice (zero items) gets one deterministic INVOICE_FALLBACK folder, keyed by invoice number", async () => {
    invoices.set("inv-1", invoiceRow({ items: [] }));
    const { ensureInvoiceDropboxBusinessFile } = await import("../invoiceBusinessFile");

    const result = await ensureInvoiceDropboxBusinessFile("inv-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ref.source).toBe("INVOICE_FALLBACK");
      expect(result.ref.businessFolderName).toBe("20260730-INVOICE-INV202607-0001");
    }
    expect(ensurePolicyDropboxBusinessFile).not.toHaveBeenCalled();
  });

  it("A4b: Invoice bundling multiple Policies (ambiguous single-folder reuse) also gets INVOICE_FALLBACK, not an arbitrary pick", async () => {
    invoices.set("inv-1", invoiceRow({ items: [{ policyRecordId: "pol-1" }, { policyRecordId: "pol-2" }] }));
    const { ensureInvoiceDropboxBusinessFile } = await import("../invoiceBusinessFile");

    const result = await ensureInvoiceDropboxBusinessFile("inv-1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ref.source).toBe("INVOICE_FALLBACK");
    expect(ensurePolicyDropboxBusinessFile).not.toHaveBeenCalled();
  });

  it("A5: retry (fallback row already exists) reuses it — never creates a second business folder", async () => {
    invoices.set("inv-1", invoiceRow({ items: [] }));
    bizFiles.set("inv-1", {
      id: "biz-inv-1",
      invoiceId: "inv-1",
      businessDate: new Date("2026-07-30"),
      insuranceTypeCode: "INVOICE",
      customerShortName: "ACME",
      businessTitle: "INV202607-0001",
      businessFolderName: "20260730-INVOICE-INV202607-0001",
      dropboxFolderId: "id:folder1",
      dropboxDisplayPath: "/root/Customers/CUST-0001/20260730-INVOICE-INV202607-0001",
      dropboxPathLower: null,
      syncStatus: "SYNCED",
      lastErrorMessage: null,
    });
    const { ensureInvoiceDropboxBusinessFile } = await import("../invoiceBusinessFile");

    const result = await ensureInvoiceDropboxBusinessFile("inv-1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ref.businessFileId).toBe("biz-inv-1");
    expect(bizFiles.size).toBe(1); // unchanged — no duplicate
  });

  it("A6: a lost create race (concurrent sync) reuses the winner's row instead of throwing", async () => {
    invoices.set("inv-1", invoiceRow({ items: [] }));
    const { prisma } = await import("@/lib/prisma");
    // Simulate: between our findUnique (no row) and our create, another
    // request already inserted the row.
    (prisma.invoiceDropboxBusinessFile.create as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      bizFiles.set("inv-1", {
        id: "biz-winner",
        invoiceId: "inv-1",
        businessDate: new Date("2026-07-30"),
        insuranceTypeCode: "INVOICE",
        customerShortName: "ACME",
        businessTitle: "INV202607-0001",
        businessFolderName: "20260730-INVOICE-INV202607-0001",
        dropboxFolderId: null,
        dropboxDisplayPath: null,
        dropboxPathLower: null,
        syncStatus: "PENDING",
        lastErrorMessage: null,
      });
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    });
    const { ensureInvoiceDropboxBusinessFile } = await import("../invoiceBusinessFile");

    const result = await ensureInvoiceDropboxBusinessFile("inv-1");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ref.businessFileId).toBe("biz-winner");
    expect(bizFiles.size).toBe(1);
  });

  it("A7/A8: fallback naming never references Claim, and only reads the Invoice's own real data (never an invented title)", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const source = readFileSync(join(__dirname, "..", "invoiceBusinessFile.ts"), "utf8");
    expect(source).not.toMatch(/Claim/);
    // The fallback title must come from invoice.invoiceNumber, not a
    // fabricated field.
    expect(source).toMatch(/businessTitle:\s*invoice\.invoiceNumber/);
  });

  it("resolveInvoiceBusinessFileRefReadOnly never writes — returns a deterministic planned name for a brand-new Invoice", async () => {
    invoices.set("inv-1", invoiceRow({ items: [] }));
    const { resolveInvoiceBusinessFileRefReadOnly } = await import("../invoiceBusinessFile");

    const ref = await resolveInvoiceBusinessFileRefReadOnly("inv-1");

    expect(ref?.source).toBe("INVOICE_FALLBACK");
    expect(ref?.businessFolderName).toBe("20260730-INVOICE-INV202607-0001");
    expect(ref?.businessFileId).toBe("");
    expect(bizFiles.size).toBe(0); // read-only — nothing created
  });
});
