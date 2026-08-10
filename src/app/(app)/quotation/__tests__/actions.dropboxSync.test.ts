import { describe, it, expect, vi, beforeEach } from "vitest";

// Quotation Revision <-> Dropbox Version sync fix, round 2 — a real
// production bug found in local testing: a brand new Quotation (R01, via
// "Start First Quotation") sat at "Pending" forever with unavailable
// Business/Quotation Folder paths, because startFirstQuotationAction — like
// createRevisionAction before the previous fix — only ever wrote the new
// Quotation row and never called generateAndSyncQuotationExcel. This is the
// same class of bug as the R02 one, in the sibling action that creates R01.

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => auth(...args) }));

vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return { ...actual, canEdit: () => true };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const generateAndSyncQuotationExcel = vi.fn();
vi.mock("@/lib/integrations/dropbox/quotationDropboxSync", () => ({
  generateAndSyncQuotationExcel: (...args: unknown[]) => generateAndSyncQuotationExcel(...args),
}));

let caseRow: { id: string; quotationNumber: string; currentRevisionId: string | null } | null;
let customerRow: { id: string } | null;
let insuranceTypeRows: { id: string; name: string }[];
let createdQuotationId: string;
const quotationCreateMock = vi.fn();

function buildTx() {
  return {
    quotationCase: {
      findUniqueOrThrow: vi.fn(async () => caseRow!),
      update: vi.fn(async () => caseRow!),
    },
    quotation: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        quotationCreateMock(data);
        return { id: createdQuotationId, quotationNumber: data.quotationNumber };
      }),
    },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    quotationCase: { findUnique: vi.fn(async () => caseRow) },
    customer: { findUnique: vi.fn(async () => customerRow) },
    customerProject: { findUnique: vi.fn(async () => null) },
    insuranceType: { findMany: vi.fn(async () => insuranceTypeRows) },
    $transaction: vi.fn(async (cb: (tx: ReturnType<typeof buildTx>) => unknown) => cb(buildTx())),
  },
}));

const basicSection = {
  insuranceTypeId: "it-1",
  phcfRate: 0.25,
  itlRate: 0.2,
  stampDuty: 40,
  applyPHCF: true,
  applyITL: true,
  applyStampDuty: true,
  items: [{ insuredContent: "Test Item", calculationMethod: "FIXED_PREMIUM" as const, premium: 392400 }],
};

describe("startFirstQuotationAction — Dropbox sync trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "u1", role: "Staff", status: "ACTIVE", permissions: ["quotation"] } });
    caseRow = { id: "case-1", quotationNumber: "QT202608-001", currentRevisionId: null };
    customerRow = { id: "cust-1" };
    insuranceTypeRows = [{ id: "it-1", name: "Fire" }];
    createdQuotationId = "quo-r01";
    generateAndSyncQuotationExcel.mockResolvedValue({ success: true, buffer: Buffer.from("x"), versionNumber: 1, dropboxStatus: "SYNCED" });
  });

  it("triggers generateAndSyncQuotationExcel with the new R01's own id, after the revision is committed", async () => {
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", { customerId: "cust-1", sections: [basicSection] });

    expect(result).toEqual({ success: true, id: "quo-r01", quotationNumber: "QT202608-001" });
    expect(generateAndSyncQuotationExcel).toHaveBeenCalledTimes(1);
    expect(generateAndSyncQuotationExcel).toHaveBeenCalledWith("quo-r01");
  });

  it("still reports the quotation as created when Dropbox sync throws unexpectedly", async () => {
    generateAndSyncQuotationExcel.mockRejectedValue(new Error("network down"));
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", { customerId: "cust-1", sections: [basicSection] });

    expect(result).toEqual({ success: true, id: "quo-r01", quotationNumber: "QT202608-001" });
  });

  it("still reports the quotation as created when generateAndSyncQuotationExcel resolves with a soft failure", async () => {
    generateAndSyncQuotationExcel.mockResolvedValue({ success: false, error: "EXPORT_FAILED" });
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", { customerId: "cust-1", sections: [basicSection] });

    expect(result.success).toBe(true);
  });

  it("never attempts a Dropbox sync when the case already has a current revision (no quotation ever created)", async () => {
    caseRow = { id: "case-1", quotationNumber: "QT202608-001", currentRevisionId: "quo-existing" };
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", { customerId: "cust-1", sections: [basicSection] });

    expect(result).toEqual({ success: false, error: "REVISION_ALREADY_EXISTS" });
    expect(quotationCreateMock).not.toHaveBeenCalled();
    expect(generateAndSyncQuotationExcel).not.toHaveBeenCalled();
  });

  it("never attempts a Dropbox sync when section validation fails (no quotation ever created)", async () => {
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", { customerId: "cust-1", sections: [] });

    expect(result.success).toBe(false);
    expect(quotationCreateMock).not.toHaveBeenCalled();
    expect(generateAndSyncQuotationExcel).not.toHaveBeenCalled();
  });

  it("never attempts a Dropbox sync for a forbidden session", async () => {
    auth.mockResolvedValue(null);
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", { customerId: "cust-1", sections: [basicSection] });

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(generateAndSyncQuotationExcel).not.toHaveBeenCalled();
  });
});
