import { describe, it, expect, vi, beforeEach } from "vitest";

// Quotation Revision <-> Dropbox Version sync fix — a real production bug
// (QT202608-001): creating R02 never generated/synced a matching Dropbox
// Excel version, so the Quotation Filename panel kept showing R01's V1
// forever. Root cause: createRevisionAction only ever wrote the new
// Quotation row — nothing in the create-revision path called
// generateAndSyncQuotationExcel. These tests cover the fix: the new
// revision's own id is used, sync failure never undoes an already-committed
// revision, and sync is never attempted when revision creation itself never
// commits.

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => auth(...args) }));

vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return { ...actual, canEdit: () => true };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const deepCopyQuotationSections = vi.fn();
vi.mock("@/lib/quotationRevisions/deepCopy", () => ({
  deepCopyQuotationSections: (...args: unknown[]) => deepCopyQuotationSections(...args),
}));

const generateAndSyncQuotationExcel = vi.fn();
vi.mock("@/lib/integrations/dropbox/quotationDropboxSync", () => ({
  generateAndSyncQuotationExcel: (...args: unknown[]) => generateAndSyncQuotationExcel(...args),
}));

type SourceRow = {
  id: string;
  quotationCaseId: string;
  currency: string;
  validUntil: Date | null;
  internalNotes: string | null;
  customerId: string;
  projectId: string | null;
  subtotalPremium: number;
  totalPHCF: number;
  totalITL: number;
  totalStampDuty: number;
  grandTotal: number;
};

let sourceRow: SourceRow | null;
let existingDraft: { id: string } | null;
let maxRevisionNumber: number | null;
let caseRow: { id: string; quotationNumber: string } | null;
let createdRevisionId: string;
const quotationCreateMock = vi.fn();

function buildTx() {
  return {
    $queryRaw: vi.fn(async () => (caseRow ? [{ id: caseRow.id }] : [])),
    quotation: {
      findFirst: vi.fn(async () => existingDraft),
      aggregate: vi.fn(async () => ({ _max: { revisionNumber: maxRevisionNumber } })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        quotationCreateMock(data);
        return { id: createdRevisionId, ...data };
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    quotationCase: {
      findUniqueOrThrow: vi.fn(async () => caseRow!),
      update: vi.fn(async () => caseRow!),
    },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    quotation: {
      findUnique: vi.fn(async () => sourceRow),
    },
    $transaction: vi.fn(async (cb: (tx: ReturnType<typeof buildTx>) => unknown) => cb(buildTx())),
  },
}));

describe("createRevisionAction — Dropbox sync trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "u1", role: "Staff", status: "ACTIVE", permissions: ["quotation"] } });
    sourceRow = {
      id: "quo-r01",
      quotationCaseId: "case-1",
      currency: "KES",
      validUntil: null,
      internalNotes: null,
      customerId: "cust-1",
      projectId: null,
      subtotalPremium: 392400,
      totalPHCF: 0,
      totalITL: 0,
      totalStampDuty: 0,
      grandTotal: 392400,
    };
    existingDraft = null;
    maxRevisionNumber = 1;
    caseRow = { id: "case-1", quotationNumber: "QT202608-001" };
    createdRevisionId = "quo-r02";
    deepCopyQuotationSections.mockResolvedValue({ sectionCreates: [] });
    generateAndSyncQuotationExcel.mockResolvedValue({ success: true, buffer: Buffer.from("x"), versionNumber: 2, dropboxStatus: "SYNCED" });
  });

  it("triggers generateAndSyncQuotationExcel with the newly created revision's own id, after the revision is committed", async () => {
    const { createRevisionAction } = await import("../revisionActions");

    const result = await createRevisionAction("case-1", "quo-r01", "Premium adjustment");

    expect(result).toEqual({ success: true, id: "quo-r02" });
    expect(generateAndSyncQuotationExcel).toHaveBeenCalledTimes(1);
    expect(generateAndSyncQuotationExcel).toHaveBeenCalledWith("quo-r02");
  });

  it("still reports the revision as created when Dropbox sync throws unexpectedly (Part 9 — Dropbox failure never undoes a committed revision)", async () => {
    generateAndSyncQuotationExcel.mockRejectedValue(new Error("network down"));
    const { createRevisionAction } = await import("../revisionActions");

    const result = await createRevisionAction("case-1", "quo-r01", "Premium adjustment");

    expect(result).toEqual({ success: true, id: "quo-r02" });
  });

  it("still reports the revision as created when generateAndSyncQuotationExcel resolves with a soft failure", async () => {
    generateAndSyncQuotationExcel.mockResolvedValue({ success: false, error: "EXPORT_FAILED" });
    const { createRevisionAction } = await import("../revisionActions");

    const result = await createRevisionAction("case-1", "quo-r01", "Premium adjustment");

    expect(result).toEqual({ success: true, id: "quo-r02" });
  });

  it("never attempts a Dropbox sync when the reason is missing and the revision is never created", async () => {
    const { createRevisionAction } = await import("../revisionActions");

    const result = await createRevisionAction("case-1", "quo-r01", "");

    expect(result).toEqual({ success: false, error: "REVISION_REASON_REQUIRED" });
    expect(quotationCreateMock).not.toHaveBeenCalled();
    expect(generateAndSyncQuotationExcel).not.toHaveBeenCalled();
  });

  it("never attempts a Dropbox sync when a DRAFT already exists for the case (revision creation itself is rejected)", async () => {
    existingDraft = { id: "quo-existing-draft" };
    const { createRevisionAction } = await import("../revisionActions");

    const result = await createRevisionAction("case-1", "quo-r01", "Premium adjustment");

    expect(result).toEqual({ success: false, error: "DRAFT_ALREADY_EXISTS" });
    expect(generateAndSyncQuotationExcel).not.toHaveBeenCalled();
  });

  it("never attempts a Dropbox sync for a forbidden session", async () => {
    auth.mockResolvedValue(null);
    const { createRevisionAction } = await import("../revisionActions");

    const result = await createRevisionAction("case-1", "quo-r01", "Premium adjustment");

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(generateAndSyncQuotationExcel).not.toHaveBeenCalled();
  });
});
