import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 13B — the Marine minimum Base Premium (KES 5,000) + Stamp Duty
// (0.05% of the Basic Sum Insured = Sum Insured x 1.10) must be applied by
// the ONE backend calculation path (buildMarineSection -> calculateMarine),
// and create + edit must persist identical numbers for identical input.
// This captures the exact payload handed to Prisma (no real DB) and asserts
// what gets stored on the section and on marineDetail (which the detail page
// + Excel export both read back).

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

const quotationCreateMock = vi.fn();
const quotationUpdateMock = vi.fn();

function buildTx() {
  return {
    quotationCase: {
      findUniqueOrThrow: vi.fn(async () => caseRow!),
      update: vi.fn(async () => caseRow!),
    },
    quotation: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        quotationCreateMock(data);
        return { id: "quo-r01", quotationNumber: data.quotationNumber };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        quotationUpdateMock(data);
        return { id: existingQuotationRow!.id };
      }),
    },
    quotationInsuranceSection: { deleteMany: vi.fn(async () => ({ count: 0 })) },
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

function marineSection(shipmentRows: { referenceNo?: string; sumInsured: number | string; rate: number | string }[]) {
  return {
    sectionKind: "MARINE_COVER" as const,
    insuranceTypeId: "it-marine",
    description: null,
    marine: { cargoDescription: "MACHINERY", origin: "SHANGHAI", destination: "MOMBASA", shipmentRows },
  };
}

type Captured = Record<string, unknown>;
function extractMarine(data: Captured) {
  const sections = (data.sections as { create: Captured[] }).create;
  const section = sections.find((s) => s.sectionKind === "MARINE_COVER")!;
  const detail = (section.marineDetail as { create: Captured }).create;
  const dec = (v: unknown) => Number((v as { toString(): string }).toString());
  const shipmentCreates = ((detail.shipmentRows as { create: Captured[] }).create ?? []).map((r) => ({
    linePremium: dec(r.linePremium),
    sumInsured: dec(r.sumInsured),
  }));
  return {
    section,
    detail,
    shipmentCreates,
    sectionBasePremium: dec(section.basePremium),
    sectionPhcf: dec(section.phcfAmount),
    sectionItl: dec(section.itlAmount),
    sectionStampDuty: dec(section.stampDuty),
    sectionTotal: dec(section.sectionTotal),
    detailGrossPremium: dec(detail.grossPremium),
    detailStampDuty: dec(detail.marineStampDutyAmount),
    detailTotal: dec(detail.totalPremium),
    detailTotalSumInsured: dec(detail.totalSumInsured),
  };
}

const BELOW_FLOOR = [{ referenceNo: "INV-1", sumInsured: 1_000_000, rate: 0.3 }]; // rated premium 3,300 < 5,000
const ABOVE_FLOOR = [{ referenceNo: "INV-1", sumInsured: 1_000_000, rate: 0.8 }]; // rated premium 8,800

describe("Marine quotation save — minimum Base Premium + Stamp Duty (create path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "u1", role: "Staff", status: "ACTIVE", permissions: ["quotation"] } });
    caseRow = { id: "case-1", quotationNumber: "QT202608-001", currentRevisionId: null };
    customerRow = { id: "cust-1" };
    insuranceTypeRows = [{ id: "it-marine", name: "Marine" }];
  });

  it("rated premium below 5,000 -> Base Premium floored to 5,000; PHCF 12.50, ITL 10, Stamp 550, Total 5,572.50", async () => {
    const { startFirstQuotationAction } = await import("../actions");
    const res = await startFirstQuotationAction("case-1", { customerId: "cust-1", sections: [marineSection(BELOW_FLOOR)] });
    expect(res.success).toBe(true);

    const m = extractMarine(quotationCreateMock.mock.calls[0][0]);
    expect(m.sectionBasePremium).toBe(5000);
    expect(m.detailGrossPremium).toBe(5000); // what the detail page / Excel read as "Marine Base Premium"
    expect(m.sectionPhcf).toBe(12.5);
    expect(m.sectionItl).toBe(10);
    expect(m.sectionStampDuty).toBe(550); // Basic SI 1,100,000 x 0.05%
    expect(m.detailStampDuty).toBe(550);
    expect(m.sectionTotal).toBe(5572.5);
    expect(m.detailTotal).toBe(5572.5);
    // never the fixed KES 40
    expect(m.sectionStampDuty).not.toBe(40);
    // raw Sum Insured is still persisted as the compat field
    expect(m.detailTotalSumInsured).toBe(1_000_000);
  });

  it("rated premium above 5,000 -> no floor; Stamp Duty still 0.05% of the Basic Sum Insured", async () => {
    const { startFirstQuotationAction } = await import("../actions");
    await startFirstQuotationAction("case-1", { customerId: "cust-1", sections: [marineSection(ABOVE_FLOOR)] });

    const m = extractMarine(quotationCreateMock.mock.calls[0][0]);
    expect(m.sectionBasePremium).toBe(8800);
    expect(m.detailGrossPremium).toBe(8800);
    expect(m.sectionPhcf).toBe(22);
    expect(m.sectionItl).toBe(17.6);
    expect(m.sectionStampDuty).toBe(550); // Basic SI 1,100,000 x 0.05%, not 8,800 x 0.05%
    expect(m.sectionTotal).toBe(9389.6);
  });

  it("Sum Insured 5,000,000 -> Basic SI 5,500,000 -> Stamp Duty 2,750", async () => {
    const { startFirstQuotationAction } = await import("../actions");
    await startFirstQuotationAction("case-1", {
      customerId: "cust-1",
      sections: [marineSection([{ referenceNo: "INV-1", sumInsured: 5_000_000, rate: 0.8 }])],
    });
    expect(extractMarine(quotationCreateMock.mock.calls[0][0]).sectionStampDuty).toBe(2750);
  });

  it("Test 3 / 4 / 5: multi-shipment — each shipment floored independently; Gross = sum(per-shipment chargeable); Stamp = sum(Basic SI) x 0.05%", async () => {
    const { startFirstQuotationAction } = await import("../actions");
    await startFirstQuotationAction("case-1", {
      customerId: "cust-1",
      sections: [
        marineSection([
          { referenceNo: "A", sumInsured: 1_000_000, rate: 0.15 }, // raw 1,650 -> chargeable 5,000
          { referenceNo: "B", sumInsured: 2_000_000, rate: 0.3 }, // raw 6,600 -> chargeable 6,600
          { referenceNo: "C", sumInsured: 500_000, rate: 0.15 }, // raw 825 -> chargeable 5,000
        ]),
      ],
    });
    const m = extractMarine(quotationCreateMock.mock.calls[0][0]);
    // the RAW line premiums are persisted, never replaced by 5,000
    expect(m.shipmentCreates.map((r) => r.linePremium)).toEqual([1650, 6600, 825]);
    // Gross = 5,000 + 6,600 + 5,000
    expect(m.sectionBasePremium).toBe(16600);
    expect(m.detailGrossPremium).toBe(16600);
    // Stamp = (1,100,000 + 2,200,000 + 550,000) x 0.05%
    expect(m.detailTotalSumInsured).toBe(3_500_000);
    expect(m.sectionStampDuty).toBe(1925);
    expect(m.sectionPhcf).toBe(41.5); // 16,600 x 0.25%
    expect(m.sectionItl).toBe(33.2); // 16,600 x 0.20%
    expect(m.sectionTotal).toBe(18599.7);
    // the wrong "combined then floored" reading would give Gross = max(9,075, 5,000) = 9,075
    expect(m.sectionBasePremium).not.toBe(9075);
  });
});

describe("Marine quotation save — create / edit / recalculate parity (Test 12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "u1", role: "Staff", status: "ACTIVE", permissions: ["quotation"] } });
    caseRow = { id: "case-1", quotationNumber: "QT202608-001", currentRevisionId: null };
    customerRow = { id: "cust-1" };
    insuranceTypeRows = [{ id: "it-marine", name: "Marine" }];
    existingQuotationRow = { id: "quo-1", revisionStatus: "DRAFT" };
  });

  it("Test 24: createQuotation and updateQuotation persist identical Marine numbers for identical multi-shipment input", async () => {
    const { startFirstQuotationAction, updateQuotationAction } = await import("../actions");

    const shipments = [
      { referenceNo: "A", sumInsured: 1_000_000, rate: 0.15 },
      { referenceNo: "B", sumInsured: 2_000_000, rate: 0.3 },
      { referenceNo: "C", sumInsured: 500_000, rate: 0.15 },
    ];
    await startFirstQuotationAction("case-1", { customerId: "cust-1", sections: [marineSection(shipments)] });
    await updateQuotationAction("quo-1", { customerId: "cust-1", sections: [marineSection(shipments)] });

    const created = extractMarine(quotationCreateMock.mock.calls[0][0]);
    const edited = extractMarine(quotationUpdateMock.mock.calls[0][0]);

    expect(edited.sectionBasePremium).toBe(created.sectionBasePremium);
    expect(edited.sectionPhcf).toBe(created.sectionPhcf);
    expect(edited.sectionItl).toBe(created.sectionItl);
    expect(edited.sectionStampDuty).toBe(created.sectionStampDuty);
    expect(edited.sectionTotal).toBe(created.sectionTotal);
    expect(edited.detailGrossPremium).toBe(created.detailGrossPremium);
    expect(edited.detailStampDuty).toBe(created.detailStampDuty);
    expect(edited.detailTotal).toBe(created.detailTotal);
    expect(edited.shipmentCreates).toEqual(created.shipmentCreates);
    expect(created.sectionBasePremium).toBe(16600);
    expect(created.sectionStampDuty).toBe(1925);
  });
});
