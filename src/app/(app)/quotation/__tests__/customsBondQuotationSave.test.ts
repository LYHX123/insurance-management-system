import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/generated/prisma/client";

// Regression suite for a bug reported during local Phase 6 testing: saving a
// quotation with a CUSTOMS_BOND section containing 2+ item rows appeared to
// fail with "An unexpected response was received from the server."
//
// Root cause investigation (see this session's diagnostic report): calling
// startFirstQuotationAction directly against the real local dev database
// with 1, 2, and 3 Customs Bond items all succeeded cleanly — the nested
// Prisma write in buildCustomsBondSectionCreate (actions.ts) has no bug and
// is completely list-length-agnostic (CustomsBondItemRow.create receives a
// plain array via Prisma's standard one-to-many nested create, unaffected by
// Phase 6's additive sourceCustomsBondItemId/generatedPolicyRecords
// relations, which this file's build path never references at all). The
// actual cause was an operational issue: the local `next dev` process had
// been running continuously since before Phase 6's `prisma generate` calls,
// and this project's PrismaClient is a deliberate cross-HMR-reload global
// singleton (see src/lib/prisma.ts) — so the long-running dev server was
// still holding a PrismaClient instance from BEFORE the new
// sourceCustomsBondItemId/generatedPolicyRecords fields existed. The very
// next page the browser rendered after a successful save
// (getQuotationDetailData, which Phase 6 extended to include
// customsBondDetail.itemRows.generatedPolicyRecords) then hit that stale
// client and threw a Prisma "unknown field" validation error server-side,
// which Next.js's client runtime surfaces as exactly this generic error.
// Restarting the dev server (done as part of this fix) resolves it — no
// application code defect was found. This suite exists so any REAL future
// regression in the Custom Bond save path (unrelated to dev-server
// staleness) is still caught automatically.

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => auth(...args) }));

vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return { ...actual, canEdit: () => true };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/integrations/dropbox/quotationDropboxSync", () => ({
  generateAndSyncQuotationExcel: vi.fn(async () => ({ success: true, buffer: Buffer.from("x"), versionNumber: 1, dropboxStatus: "SYNCED" })),
}));

let caseRow: { id: string; quotationNumber: string; currentRevisionId: string | null } | null;
let customerRow: { id: string } | null;
let insuranceTypeRows: { id: string; name: string }[];
let existingQuotationRow: { id: string; revisionStatus: string | null } | null;
let createdQuotationId: string;

const quotationCreateMock = vi.fn();
const quotationUpdateMock = vi.fn();
const sectionDeleteManyMock = vi.fn();

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
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        quotationUpdateMock(data);
        return { id: existingQuotationRow!.id };
      }),
    },
    quotationInsuranceSection: {
      deleteMany: vi.fn(async (args: unknown) => {
        sectionDeleteManyMock(args);
        return { count: 0 };
      }),
    },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    quotationCase: { findUnique: vi.fn(async () => caseRow) },
    quotation: { findUnique: vi.fn(async () => existingQuotationRow) },
    customer: { findUnique: vi.fn(async () => customerRow) },
    customerProject: { findUnique: vi.fn(async () => null) },
    insuranceType: { findMany: vi.fn(async () => insuranceTypeRows) },
    $transaction: vi.fn(async (cb: (tx: ReturnType<typeof buildTx>) => unknown) => cb(buildTx())),
  },
}));

function customsBondSection(itemRows: { bondType: string; bondValue: number | string; rate: number | string }[]) {
  return {
    sectionKind: "CUSTOMS_BOND" as const,
    insuranceTypeId: "it-customs-bond",
    description: null,
    customsBond: { itemRows },
  };
}

// Extracts the itemRows.create array actually passed to Prisma for the
// CUSTOMS_BOND section out of a captured `data` object (either
// quotation.create's or quotation.update's payload).
function extractCustomsBondItemCreates(data: Record<string, unknown>) {
  const sections = (data.sections as { create: Record<string, unknown>[] }).create;
  const customsSection = sections.find((s) => s.sectionKind === "CUSTOMS_BOND")!;
  const detail = customsSection.customsBondDetail as { create: { itemRows: { create: Record<string, unknown>[] } } };
  return detail.create.itemRows.create;
}

describe("Custom Bond quotation save — startFirstQuotationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "u1", role: "Staff", status: "ACTIVE", permissions: ["quotation"] } });
    caseRow = { id: "case-1", quotationNumber: "QT202608-001", currentRevisionId: null };
    customerRow = { id: "cust-1" };
    insuranceTypeRows = [{ id: "it-customs-bond", name: "Customs Bond" }];
    createdQuotationId = "quo-r01";
  });

  it("Case 1: 1 Customs Bond item saves successfully", async () => {
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", {
      customerId: "cust-1",
      sections: [customsBondSection([{ bondType: "CB1", bondValue: 20000000, rate: 0.5 }])],
    });

    expect(result).toEqual({ success: true, id: "quo-r01", quotationNumber: "QT202608-001" });
    expect(quotationCreateMock).toHaveBeenCalledTimes(1);
    const items = extractCustomsBondItemCreates(quotationCreateMock.mock.calls[0][0]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ bondType: "CB1", sortOrder: 0 });
  });

  it("Case 2: 2 Customs Bond items save successfully, each with correct bondType/bondValue/premium and distinct sortOrder", async () => {
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", {
      customerId: "cust-1",
      sections: [
        customsBondSection([
          { bondType: "CB1", bondValue: 20000000, rate: 0.5 },
          { bondType: "CB2", bondValue: 30000000, rate: 0.5 },
        ]),
      ],
    });

    expect(result.success).toBe(true);
    const items = extractCustomsBondItemCreates(quotationCreateMock.mock.calls[0][0]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ bondType: "CB1", sortOrder: 0 });
    expect(items[1]).toMatchObject({ bondType: "CB2", sortOrder: 1 });

    const cb1Value = items[0].bondValue as Prisma.Decimal;
    const cb2Value = items[1].bondValue as Prisma.Decimal;
    expect(cb1Value.toString()).toBe("20000000");
    expect(cb2Value.toString()).toBe("30000000");
    // premium = bondValue * rate / 100, rounded — never NaN/undefined.
    const cb1Premium = items[0].premium as Prisma.Decimal;
    const cb2Premium = items[1].premium as Prisma.Decimal;
    expect(cb1Premium.toString()).toBe("100000");
    expect(cb2Premium.toString()).toBe("150000");
    expect(Number.isNaN(Number(cb1Premium.toString()))).toBe(false);
    expect(Number.isNaN(Number(cb2Premium.toString()))).toBe(false);
  });

  it("Case 3: 3 Customs Bond items save successfully", async () => {
    const { startFirstQuotationAction } = await import("../actions");

    const result = await startFirstQuotationAction("case-1", {
      customerId: "cust-1",
      sections: [
        customsBondSection([
          { bondType: "CB1", bondValue: 20000000, rate: 0.5 },
          { bondType: "CB2", bondValue: 30000000, rate: 0.5 },
          { bondType: "CB5", bondValue: 10000000, rate: 0.4 },
        ]),
      ],
    });

    expect(result.success).toBe(true);
    const items = extractCustomsBondItemCreates(quotationCreateMock.mock.calls[0][0]);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.bondType)).toEqual(["CB1", "CB2", "CB5"]);
    expect(items.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
  });

  it("no item ever carries an id in its create payload — every item is a genuinely new row, never a duplicate write against an existing id", async () => {
    const { startFirstQuotationAction } = await import("../actions");

    await startFirstQuotationAction("case-1", {
      customerId: "cust-1",
      sections: [
        customsBondSection([
          { bondType: "CB1", bondValue: 20000000, rate: 0.5 },
          { bondType: "CB2", bondValue: 30000000, rate: 0.5 },
        ]),
      ],
    });

    const items = extractCustomsBondItemCreates(quotationCreateMock.mock.calls[0][0]);
    for (const item of items) {
      expect(item.id).toBeUndefined();
      // Never leaks Policy-side fields into the quotation payload.
      expect(item.sourceCustomsBondItemId).toBeUndefined();
      expect(item.generatedPolicyRecords).toBeUndefined();
    }
  });
});

describe("Custom Bond quotation save — updateQuotationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "u1", role: "Staff", status: "ACTIVE", permissions: ["quotation"] } });
    customerRow = { id: "cust-1" };
    insuranceTypeRows = [{ id: "it-customs-bond", name: "Customs Bond" }];
    existingQuotationRow = { id: "quo-1", revisionStatus: "DRAFT" };
  });

  it("Case 4: an existing quotation with 1 Customs Bond item saves successfully after adding a 2nd item", async () => {
    const { updateQuotationAction } = await import("../actions");

    const result = await updateQuotationAction("quo-1", {
      customerId: "cust-1",
      sections: [
        customsBondSection([
          { bondType: "CB1", bondValue: 20000000, rate: 0.5 },
          { bondType: "CB2", bondValue: 30000000, rate: 0.5 },
        ]),
      ],
    });

    expect(result).toEqual({ success: true });
    expect(sectionDeleteManyMock).toHaveBeenCalledTimes(1); // full replace-on-edit, unchanged Phase 1-5 semantics
    const items = extractCustomsBondItemCreates(quotationUpdateMock.mock.calls[0][0]);
    expect(items).toHaveLength(2);
  });

  it("Case 5: modifying an existing item's bondValue/rate saves successfully with the new values", async () => {
    const { updateQuotationAction } = await import("../actions");

    const result = await updateQuotationAction("quo-1", {
      customerId: "cust-1",
      sections: [
        customsBondSection([
          { bondType: "CB1", bondValue: 25000000, rate: 0.6 }, // changed from 20000000 / 0.5
          { bondType: "CB2", bondValue: 30000000, rate: 0.5 },
        ]),
      ],
    });

    expect(result.success).toBe(true);
    const items = extractCustomsBondItemCreates(quotationUpdateMock.mock.calls[0][0]);
    expect((items[0].bondValue as Prisma.Decimal).toString()).toBe("25000000");
    expect((items[0].rate as Prisma.Decimal).toString()).toBe("0.6");
  });

  it("Case 6: removing one item (submitting only the remaining row) saves successfully with just that row", async () => {
    const { updateQuotationAction } = await import("../actions");

    const result = await updateQuotationAction("quo-1", {
      customerId: "cust-1",
      sections: [customsBondSection([{ bondType: "CB2", bondValue: 30000000, rate: 0.5 }])],
    });

    expect(result.success).toBe(true);
    const items = extractCustomsBondItemCreates(quotationUpdateMock.mock.calls[0][0]);
    expect(items).toHaveLength(1);
    expect(items[0].bondType).toBe("CB2");
  });

  it("a REVISION_LOCKED (issued) quotation is rejected before touching Custom Bond items", async () => {
    existingQuotationRow = { id: "quo-1", revisionStatus: "ISSUED" };
    const { updateQuotationAction } = await import("../actions");

    const result = await updateQuotationAction("quo-1", {
      customerId: "cust-1",
      sections: [customsBondSection([{ bondType: "CB1", bondValue: 20000000, rate: 0.5 }])],
    });

    expect(result).toEqual({ success: false, error: "REVISION_LOCKED" });
    expect(quotationUpdateMock).not.toHaveBeenCalled();
  });
});
