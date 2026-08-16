import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/generated/prisma/client";

// Phase 1+2 "Generate Policy Records" + Phase 3 "per-section cover periods"
// — covers this phase's full test matrix: single-section generation,
// full-batch generation with each Policy keeping its OWN
// effective/expiry/insurerCost, a shared batch-wide processingDate,
// partial-then-remaining generation, per-section date validation (missing/
// equal/reversed dates fail the WHOLE batch, never a partial create),
// unselected sections never blocking submission, ordinary double-click
// idempotency (including a retry that changes the submitted dates — the
// replay must never re-apply them), concurrent-call idempotency,
// revision-source stability across R01 -> R02, historical
// (sourceQuotationSectionId = null) compatibility, hard-delete-then-
// regenerate, and unsupported sectionKind rejection.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ADMIN_SESSION = { user: { id: "admin-1", role: "Admin", status: "ACTIVE", permissions: [] } };
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ADMIN_SESSION) }));

type SectionFixture = {
  id: string;
  quotationId: string;
  sectionKind: string;
  insuranceTypeNameSnapshot: string;
  sectionTotal: Prisma.Decimal;
  motorCompPrivateDetail?: { plateNo: string; vehicleValue: Prisma.Decimal } | null;
  motorCompCommercialDetail?: { plateNo: string; vehicleValue: Prisma.Decimal } | null;
  motorTpoPrivateDetail?: { plateNo: string } | null;
  motorTpoCommercialDetail?: { plateNo: string } | null;
  tenderSecurityDetail?: { bondValue: Prisma.Decimal } | null;
  performanceBondDetail?: { bondValue: Prisma.Decimal } | null;
  advancePaymentGuaranteeDetail?: { bondValue: Prisma.Decimal } | null;
};

type QuotationFixture = {
  id: string;
  quotationNumber: string;
  quotationCaseId: string | null;
  revisionStatus: string;
  revisionCode: string | null;
  quotationDate: Date;
  customerId: string;
  projectId: string | null;
};

type PolicyRecordRow = {
  id: string;
  recordNumber: string;
  category: string;
  customerPremium: Prisma.Decimal;
  processingDate: Date;
  effectiveDate: Date;
  expiryDate: Date;
  insurerCost: Prisma.Decimal;
  sourceQuotationId: string | null;
  sourceQuotationSectionId: string | null;
  sourceQuotationRevisionSnapshot: string | null;
  deletedAt: Date | null;
  data: Record<string, unknown>;
};

let quotations: Map<string, QuotationFixture>;
let sections: Map<string, SectionFixture>;
let policyRecords: Map<string, PolicyRecordRow>;
let idempotencyClaims: Map<string, { key: string; scope: string; resourceId: string }>;
let recordNumberCounters: Map<string, number>;
let idCounter = 0;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function withGenerated(section: SectionFixture) {
  return {
    ...section,
    generatedPolicyRecords: [...policyRecords.values()]
      .filter((p) => p.sourceQuotationSectionId === section.id && !p.deletedAt)
      .map((p) => ({ id: p.id })),
  };
}

function findSections(ids: string[], quotationId: string) {
  return ids
    .filter((id) => sections.has(id) && sections.get(id)!.quotationId === quotationId)
    .map((id) => withGenerated(sections.get(id)!));
}

class FakeUniqueConstraintError extends Error {
  code = "P2002";
}

function buildTx() {
  return {
    idempotencyClaim: {
      create: vi.fn(async ({ data }: { data: { key: string; scope: string; resourceId: string } }) => {
        if (idempotencyClaims.has(data.key)) throw new FakeUniqueConstraintError("unique");
        idempotencyClaims.set(data.key, { ...data });
        return { ...data };
      }),
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => idempotencyClaims.get(where.key) ?? null),
      update: vi.fn(async ({ where, data }: { where: { key: string }; data: { resourceId: string } }) => {
        const row = idempotencyClaims.get(where.key)!;
        row.resourceId = data.resourceId;
        return row;
      }),
    },
    quotationInsuranceSection: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; quotationId: string } }) =>
        findSections(where.id.in, where.quotationId)
      ),
    },
    policyRecord: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = nextId("policy");
        policyRecords.set(id, {
          id,
          recordNumber: data.recordNumber as string,
          category: data.category as string,
          customerPremium: data.customerPremium as Prisma.Decimal,
          processingDate: data.processingDate as Date,
          effectiveDate: data.effectiveDate as Date,
          expiryDate: data.expiryDate as Date,
          insurerCost: data.insurerCost as Prisma.Decimal,
          sourceQuotationId: (data.sourceQuotationId as string) ?? null,
          sourceQuotationSectionId: (data.sourceQuotationSectionId as string) ?? null,
          sourceQuotationRevisionSnapshot: (data.sourceQuotationRevisionSnapshot as string) ?? null,
          deletedAt: null,
          data,
        });
        return { id };
      }),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in
          .filter((id) => policyRecords.has(id))
          .map((id) => {
            const r = policyRecords.get(id)!;
            // Mirrors the real replay-path select shape (see
            // generatePolicyRecordsAction.ts): one of the three
            // category-specific detail relations, each exposing only its
            // own policyNumber.
            const motorDetail = r.data.motorDetail
              ? { policyNumber: (r.data.motorDetail as { create: { policyNumber: string | null } }).create.policyNumber }
              : null;
            const nonMotorDetail = r.data.nonMotorDetail
              ? { policyNumber: (r.data.nonMotorDetail as { create: { policyNumber: string | null } }).create.policyNumber }
              : null;
            const bondDetail = r.data.bondDetail
              ? { policyNumber: (r.data.bondDetail as { create: { policyNumber: string | null } }).create.policyNumber }
              : null;
            return {
              id: r.id,
              recordNumber: r.recordNumber,
              category: r.category,
              sourceQuotationSectionId: r.sourceQuotationSectionId,
              motorDetail,
              nonMotorDetail,
              bondDetail,
            };
          })
      ),
    },
    policyActivity: { create: vi.fn(async () => ({})) },
    quotationCaseActivity: { create: vi.fn(async () => ({})) },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("|");
      if (text.includes("FOR UPDATE")) {
        return [{ id: values[0] }];
      }
      if (text.includes("PolicyRecordNumberCounter")) {
        const key = values[0] as string;
        const next = (recordNumberCounters.get(key) ?? 0) + 1;
        recordNumberCounters.set(key, next);
        return [{ lastSequence: next }];
      }
      throw new Error(`Unexpected $queryRaw in test: ${text}`);
    }),
  };
}

let txQueue: Promise<unknown> = Promise.resolve();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    quotation: {
      findUnique: vi.fn(async ({ where: { id } }: { where: { id: string } }) => quotations.get(id) ?? null),
    },
    quotationInsuranceSection: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; quotationId: string } }) =>
        findSections(where.id.in, where.quotationId)
      ),
    },
    $transaction: vi.fn((cb: (tx: ReturnType<typeof buildTx>) => Promise<unknown>) => {
      const run = txQueue.then(
        () => cb(buildTx()),
        () => cb(buildTx())
      );
      txQueue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }),
  },
}));

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

const QUOTATION_ID = "quot-1";
const CASE_ID = "case-1";

function makeQuotation(overrides: Partial<QuotationFixture> = {}): QuotationFixture {
  return {
    id: QUOTATION_ID,
    quotationNumber: "QT202608-001",
    quotationCaseId: CASE_ID,
    revisionStatus: "ISSUED",
    revisionCode: "R01",
    quotationDate: new Date("2026-08-01"),
    customerId: "cust-1",
    projectId: null,
    ...overrides,
  };
}

function makeCarSection(): SectionFixture {
  return {
    id: "sec-car",
    quotationId: QUOTATION_ID,
    sectionKind: "CAR_PACKAGE",
    insuranceTypeNameSnapshot: "CAR",
    sectionTotal: decimal(500000),
  };
}
function makeWibaSection(): SectionFixture {
  return {
    id: "sec-wiba",
    quotationId: QUOTATION_ID,
    sectionKind: "WIBA",
    insuranceTypeNameSnapshot: "WIBA",
    sectionTotal: decimal(80000),
  };
}
function makeElSection(): SectionFixture {
  return {
    id: "sec-el",
    quotationId: QUOTATION_ID,
    sectionKind: "EMPLOYERS_LIABILITY",
    insuranceTypeNameSnapshot: "Employers' Liability",
    sectionTotal: decimal(60000),
  };
}

type SectionInputOverrides = { insurerCost?: number | string; effectiveDate?: string; expiryDate?: string; policyNumber?: string };

function sectionInput(sectionId: string, overrides: SectionInputOverrides = {}) {
  return {
    sectionId,
    insurerCost: 0,
    effectiveDate: "2026-09-01",
    expiryDate: "2027-08-31",
    ...overrides,
  };
}

function commonInput(
  overrides: Partial<Parameters<typeof import("../generatePolicyRecordsAction").generatePolicyRecordsAction>[0]> = {}
) {
  return {
    quotationId: QUOTATION_ID,
    processingDate: "2026-08-16",
    sections: [] as ReturnType<typeof sectionInput>[],
    idempotencyKey: "key-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  txQueue = Promise.resolve();
  idCounter = 0;
  quotations = new Map([[QUOTATION_ID, makeQuotation()]]);
  sections = new Map();
  policyRecords = new Map();
  idempotencyClaims = new Map();
  recordNumberCounters = new Map();
});

describe("generatePolicyRecordsAction", () => {
  it("Case 1: a quotation with only CAR generates exactly 1 Policy with its own dates", async () => {
    sections.set("sec-car", makeCarSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const result = await generatePolicyRecordsAction(
      commonInput({
        sections: [sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" })],
      })
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.created).toHaveLength(1);
      expect(result.created[0].category).toBe("NON_MOTOR");
      expect(result.created[0].sectionId).toBe("sec-car");
    }
    expect(policyRecords.size).toBe(1);
    const record = [...policyRecords.values()][0];
    expect(record.effectiveDate.toISOString().slice(0, 10)).toBe("2026-08-20");
    expect(record.expiryDate.toISOString().slice(0, 10)).toBe("2027-08-19");
  });

  it("Case 2 + 3: CAR + WIBA + EL each keep their OWN dates/premium, all share the batch processingDate", async () => {
    sections.set("sec-car", makeCarSection());
    sections.set("sec-wiba", makeWibaSection());
    sections.set("sec-el", makeElSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const result = await generatePolicyRecordsAction(
      commonInput({
        processingDate: "2026-08-16",
        sections: [
          sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" }),
          sectionInput("sec-wiba", { insurerCost: 60000, effectiveDate: "2026-09-01", expiryDate: "2027-08-31" }),
          sectionInput("sec-el", { insurerCost: 40000, effectiveDate: "2026-09-15", expiryDate: "2027-09-14" }),
        ],
      })
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.created).toHaveLength(3);

    const bySectionId = new Map(result.created.map((c) => [c.sectionId, c]));
    const carRecord = policyRecords.get(bySectionId.get("sec-car")!.id)!;
    const wibaRecord = policyRecords.get(bySectionId.get("sec-wiba")!.id)!;
    const elRecord = policyRecords.get(bySectionId.get("sec-el")!.id)!;

    // Case 10: each Policy uses its OWN section premium (unchanged from
    // the previous phase), never the quotation grand total.
    expect(carRecord.customerPremium.toString()).toBe("500000");
    expect(wibaRecord.customerPremium.toString()).toBe("80000");
    expect(elRecord.customerPremium.toString()).toBe("60000");

    // Case 2: each Policy uses ITS OWN effective/expiry window — the CAR
    // dates must never leak onto WIBA/EL (or vice versa).
    expect(carRecord.effectiveDate.toISOString().slice(0, 10)).toBe("2026-08-20");
    expect(carRecord.expiryDate.toISOString().slice(0, 10)).toBe("2027-08-19");
    expect(wibaRecord.effectiveDate.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(wibaRecord.expiryDate.toISOString().slice(0, 10)).toBe("2027-08-31");
    expect(elRecord.effectiveDate.toISOString().slice(0, 10)).toBe("2026-09-15");
    expect(elRecord.expiryDate.toISOString().slice(0, 10)).toBe("2027-09-14");

    // Case 3: all three share the single batch-level processingDate.
    expect(carRecord.processingDate.toISOString().slice(0, 10)).toBe("2026-08-16");
    expect(wibaRecord.processingDate.toISOString().slice(0, 10)).toBe("2026-08-16");
    expect(elRecord.processingDate.toISOString().slice(0, 10)).toBe("2026-08-16");

    // sourceQuotationSectionId traceability (Phase 1+2, unchanged).
    expect(carRecord.sourceQuotationSectionId).toBe("sec-car");
    expect(wibaRecord.sourceQuotationSectionId).toBe("sec-wiba");
    expect(elRecord.sourceQuotationSectionId).toBe("sec-el");
  });

  it("Phase 4 Part 5: each Policy writes its OWN policyNumber into the correct category detail — never cross-contaminated", async () => {
    sections.set("sec-car", makeCarSection());
    sections.set("sec-wiba", makeWibaSection());
    sections.set("sec-el", makeElSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const result = await generatePolicyRecordsAction(
      commonInput({
        sections: [
          sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19", policyNumber: "PN-CAR-001" }),
          sectionInput("sec-wiba", { insurerCost: 60000, effectiveDate: "2026-09-01", expiryDate: "2027-08-31", policyNumber: "PN-WIBA-002" }),
          sectionInput("sec-el", { insurerCost: 40000, effectiveDate: "2026-09-15", expiryDate: "2027-09-14", policyNumber: "PN-EL-003" }),
        ],
      })
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    const bySectionId = new Map(result.created.map((c) => [c.sectionId, c]));
    expect(bySectionId.get("sec-car")?.policyNumber).toBe("PN-CAR-001");
    expect(bySectionId.get("sec-wiba")?.policyNumber).toBe("PN-WIBA-002");
    expect(bySectionId.get("sec-el")?.policyNumber).toBe("PN-EL-003");

    const carRecord = policyRecords.get(bySectionId.get("sec-car")!.id)!;
    const wibaRecord = policyRecords.get(bySectionId.get("sec-wiba")!.id)!;
    const elRecord = policyRecords.get(bySectionId.get("sec-el")!.id)!;
    expect((carRecord.data.nonMotorDetail as { create: { policyNumber: string | null } }).create.policyNumber).toBe("PN-CAR-001");
    expect((wibaRecord.data.nonMotorDetail as { create: { policyNumber: string | null } }).create.policyNumber).toBe("PN-WIBA-002");
    expect((elRecord.data.nonMotorDetail as { create: { policyNumber: string | null } }).create.policyNumber).toBe("PN-EL-003");
  });

  it("Phase 4 Part 3: policyNumber is OPTIONAL — a blank value never blocks generation and is stored as null (trimmed)", async () => {
    sections.set("sec-car", makeCarSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const noNumber = await generatePolicyRecordsAction(
      commonInput({
        sections: [sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" })],
        idempotencyKey: "no-number-key",
      })
    );
    expect(noNumber.success).toBe(true);
    if (noNumber.success) expect(noNumber.created[0].policyNumber).toBeNull();

    sections.set("sec-wiba", makeWibaSection());
    const withPadding = await generatePolicyRecordsAction(
      commonInput({
        sections: [
          sectionInput("sec-wiba", {
            insurerCost: 60000,
            effectiveDate: "2026-09-01",
            expiryDate: "2027-08-31",
            policyNumber: "  PN-TRIMMED  ",
          }),
        ],
        idempotencyKey: "with-padding-key",
      })
    );
    expect(withPadding.success).toBe(true);
    if (withPadding.success) expect(withPadding.created[0].policyNumber).toBe("PN-TRIMMED");
  });

  it("Phase 4 Part 9: a replay (same idempotencyKey) with a DIFFERENT policyNumber never overwrites the original", async () => {
    sections.set("sec-car", makeCarSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const first = await generatePolicyRecordsAction(
      commonInput({
        sections: [
          sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19", policyNumber: "PN-ORIGINAL" }),
        ],
        idempotencyKey: "replay-policy-number",
      })
    );
    expect(first.success).toBe(true);

    const retry = await generatePolicyRecordsAction(
      commonInput({
        sections: [
          sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19", policyNumber: "PN-DIFFERENT" }),
        ],
        idempotencyKey: "replay-policy-number",
      })
    );
    expect(retry.success).toBe(true);
    if (first.success && retry.success) expect(retry.created).toEqual(first.created);
    if (retry.success) expect(retry.created[0].policyNumber).toBe("PN-ORIGINAL");

    expect(policyRecords.size).toBe(1);
    const record = [...policyRecords.values()][0];
    expect((record.data.nonMotorDetail as { create: { policyNumber: string | null } }).create.policyNumber).toBe("PN-ORIGINAL");
  });

  it("Case 4: a selected section missing effectiveDate fails the WHOLE batch — no partial creation", async () => {
    sections.set("sec-car", makeCarSection());
    sections.set("sec-wiba", makeWibaSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const result = await generatePolicyRecordsAction(
      commonInput({
        sections: [
          sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "", expiryDate: "2027-08-19" }),
          sectionInput("sec-wiba", { insurerCost: 60000, effectiveDate: "2026-09-01", expiryDate: "2027-08-31" }),
        ],
      })
    );

    expect(result).toEqual({ success: false, error: "DATES_REQUIRED" });
    expect(policyRecords.size).toBe(0);
  });

  it("Case 5: a selected section missing expiryDate fails the WHOLE batch", async () => {
    sections.set("sec-car", makeCarSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const result = await generatePolicyRecordsAction(
      commonInput({ sections: [sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "" })] })
    );

    expect(result).toEqual({ success: false, error: "DATES_REQUIRED" });
    expect(policyRecords.size).toBe(0);
  });

  it("Case 6: effectiveDate = expiryDate is rejected", async () => {
    sections.set("sec-car", makeCarSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const result = await generatePolicyRecordsAction(
      commonInput({
        sections: [sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2026-08-20" })],
      })
    );

    expect(result).toEqual({ success: false, error: "EXPIRY_BEFORE_EFFECTIVE" });
    expect(policyRecords.size).toBe(0);
  });

  it("Case 7: effectiveDate > expiryDate is rejected", async () => {
    sections.set("sec-car", makeCarSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const result = await generatePolicyRecordsAction(
      commonInput({
        sections: [sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2027-08-19", expiryDate: "2026-08-20" })],
      })
    );

    expect(result).toEqual({ success: false, error: "EXPIRY_BEFORE_EFFECTIVE" });
    expect(policyRecords.size).toBe(0);
  });

  it("Case 8: an unselected section with no dates never blocks the selected sections", async () => {
    sections.set("sec-car", makeCarSection());
    sections.set("sec-wiba", makeWibaSection()); // never included in the payload at all — mirrors an unchecked row
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const result = await generatePolicyRecordsAction(
      commonInput({
        sections: [sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" })],
      })
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.created).toHaveLength(1);
    expect(policyRecords.size).toBe(1);
  });

  it("Case 9: generating CAR first, then WIBA + EL later — the already-generated CAR is never resubmitted or duplicated", async () => {
    sections.set("sec-car", makeCarSection());
    sections.set("sec-wiba", makeWibaSection());
    sections.set("sec-el", makeElSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const first = await generatePolicyRecordsAction(
      commonInput({
        sections: [sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" })],
        idempotencyKey: "batch-1",
      })
    );
    expect(first.success).toBe(true);
    expect(policyRecords.size).toBe(1);

    // Second modal open re-submits ALL three (mirrors the UI defaulting to
    // "every not-yet-generated section checked") — CAR is already
    // generated so it must be silently skipped, not duplicated.
    const second = await generatePolicyRecordsAction(
      commonInput({
        sections: [
          sectionInput("sec-car", { insurerCost: 999999, effectiveDate: "2030-01-01", expiryDate: "2031-01-01" }),
          sectionInput("sec-wiba", { insurerCost: 60000, effectiveDate: "2026-09-01", expiryDate: "2027-08-31" }),
          sectionInput("sec-el", { insurerCost: 40000, effectiveDate: "2026-09-15", expiryDate: "2027-09-14" }),
        ],
        idempotencyKey: "batch-2",
      })
    );
    expect(second.success).toBe(true);
    if (second.success) {
      expect(second.created).toHaveLength(2);
      expect(second.alreadyGenerated).toEqual(["sec-car"]);
    }
    expect(policyRecords.size).toBe(3);

    const carRecords = [...policyRecords.values()].filter((r) => r.sourceQuotationSectionId === "sec-car");
    expect(carRecords).toHaveLength(1);
    // The original CAR record's dates/premium must be untouched by the
    // second (differently-valued) submission.
    expect(carRecords[0].customerPremium.toString()).toBe("500000");
    expect(carRecords[0].effectiveDate.toISOString().slice(0, 10)).toBe("2026-08-20");
  });

  it("Case 10: submitting the identical batch twice (same idempotencyKey) creates only one set of Policy records", async () => {
    sections.set("sec-car", makeCarSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const input = commonInput({
      sections: [sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" })],
      idempotencyKey: "dup-key",
    });
    const r1 = await generatePolicyRecordsAction(input);
    const r2 = await generatePolicyRecordsAction(input);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    if (r1.success && r2.success) expect(r2.created).toEqual(r1.created);
    expect(policyRecords.size).toBe(1);
  });

  it("Case 11: Promise.all with the same idempotencyKey never creates duplicate Policy records", async () => {
    sections.set("sec-car", makeCarSection());
    sections.set("sec-wiba", makeWibaSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const input = commonInput({
      sections: [
        sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" }),
        sectionInput("sec-wiba", { insurerCost: 60000, effectiveDate: "2026-09-01", expiryDate: "2027-08-31" }),
      ],
      idempotencyKey: "concurrent-key",
    });

    const [r1, r2] = await Promise.all([generatePolicyRecordsAction(input), generatePolicyRecordsAction(input)]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(policyRecords.size).toBe(2);
  });

  it("Case 11b: concurrent DIFFERENT-key requests for an overlapping section never double-create (row-lock dedup)", async () => {
    sections.set("sec-car", makeCarSection());
    sections.set("sec-wiba", makeWibaSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const [r1, r2] = await Promise.all([
      generatePolicyRecordsAction(
        commonInput({
          sections: [sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" })],
          idempotencyKey: "key-a",
        })
      ),
      generatePolicyRecordsAction(
        commonInput({
          sections: [
            sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" }),
            sectionInput("sec-wiba", { insurerCost: 60000, effectiveDate: "2026-09-01", expiryDate: "2027-08-31" }),
          ],
          idempotencyKey: "key-b",
        })
      ),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    const carRecords = [...policyRecords.values()].filter((r) => r.sourceQuotationSectionId === "sec-car");
    expect(carRecords).toHaveLength(1);
    expect(policyRecords.size).toBe(2); // exactly one CAR + one WIBA total
  });

  it("Case 12: retrying the same idempotencyKey with DIFFERENT dates replays the original result — never a second batch", async () => {
    sections.set("sec-car", makeCarSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const first = await generatePolicyRecordsAction(
      commonInput({
        sections: [sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" })],
        idempotencyKey: "retry-key",
      })
    );
    expect(first.success).toBe(true);

    const retry = await generatePolicyRecordsAction(
      commonInput({
        sections: [sectionInput("sec-car", { insurerCost: 999999, effectiveDate: "2030-01-01", expiryDate: "2031-01-01" })],
        idempotencyKey: "retry-key",
      })
    );
    expect(retry.success).toBe(true);
    if (first.success && retry.success) expect(retry.created).toEqual(first.created);

    expect(policyRecords.size).toBe(1);
    const record = [...policyRecords.values()][0];
    // The replay must never apply the retry's different dates/premium —
    // the record still reflects the FIRST (successfully claimed) submission.
    expect(record.effectiveDate.toISOString().slice(0, 10)).toBe("2026-08-20");
    expect(record.insurerCost.toString()).toBe("400000");
  });

  it("Phase 1+2 protection #8: R01 generates CAR+WIBA; creating R02 (with CAR+WIBA+EL sections of its own) never changes R01's Policy sources or dates", async () => {
    sections.set("sec-car", makeCarSection());
    sections.set("sec-wiba", makeWibaSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const r01Result = await generatePolicyRecordsAction(
      commonInput({
        sections: [
          sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" }),
          sectionInput("sec-wiba", { insurerCost: 60000, effectiveDate: "2026-09-01", expiryDate: "2027-08-31" }),
        ],
        idempotencyKey: "r01-batch",
      })
    );
    expect(r01Result.success).toBe(true);
    const r01CarRecord = [...policyRecords.values()].find((r) => r.sourceQuotationSectionId === "sec-car")!;
    expect(r01CarRecord.sourceQuotationId).toBe(QUOTATION_ID);
    expect(r01CarRecord.sourceQuotationRevisionSnapshot).toBe("R01");

    // R02 is a DIFFERENT Quotation row (own sections, own id) — mirrors
    // createRevisionAction's deep-copy-into-a-new-Quotation-row behavior.
    const R02_ID = "quot-2";
    quotations.set(R02_ID, makeQuotation({ id: R02_ID, revisionCode: "R02" }));
    sections.set("sec-car-r02", { ...makeCarSection(), id: "sec-car-r02", quotationId: R02_ID });
    sections.set("sec-wiba-r02", { ...makeWibaSection(), id: "sec-wiba-r02", quotationId: R02_ID });
    sections.set("sec-el-r02", { ...makeElSection(), id: "sec-el-r02", quotationId: R02_ID });

    const r02Result = await generatePolicyRecordsAction(
      commonInput({
        quotationId: R02_ID,
        sections: [sectionInput("sec-el-r02", { insurerCost: 40000, effectiveDate: "2026-09-15", expiryDate: "2027-09-14" })],
        idempotencyKey: "r02-batch",
      })
    );
    expect(r02Result.success).toBe(true);

    // R01's CAR/WIBA records are byte-for-byte unchanged, including dates.
    const r01CarRecordAfter = policyRecords.get(r01CarRecord.id)!;
    expect(r01CarRecordAfter.sourceQuotationId).toBe(QUOTATION_ID);
    expect(r01CarRecordAfter.sourceQuotationRevisionSnapshot).toBe("R01");
    expect(r01CarRecordAfter.sourceQuotationSectionId).toBe("sec-car");
    expect(r01CarRecordAfter.effectiveDate.toISOString().slice(0, 10)).toBe("2026-08-20");

    // The new EL record is sourced from R02's own section, not R01's.
    const elRecord = [...policyRecords.values()].find((r) => r.sourceQuotationSectionId === "sec-el-r02")!;
    expect(elRecord.sourceQuotationId).toBe(R02_ID);
    expect(elRecord.sourceQuotationRevisionSnapshot).toBe("R02");
    expect(elRecord.effectiveDate.toISOString().slice(0, 10)).toBe("2026-09-15");

    expect(policyRecords.size).toBe(3);
  });

  it("Case 13: a historical PolicyRecord with sourceQuotationSectionId = null does not break section-eligibility lookups", async () => {
    sections.set("sec-car", makeCarSection());
    // Simulate a pre-existing, manually-created historical PolicyRecord
    // that happens to reference sourceQuotationId but predates this
    // field — sourceQuotationSectionId is null and must never be
    // (mis)treated as "this section is already generated".
    policyRecords.set("legacy-1", {
      id: "legacy-1",
      recordNumber: "PN202601-0001",
      category: "NON_MOTOR",
      customerPremium: decimal(500000),
      processingDate: new Date("2026-01-01"),
      effectiveDate: new Date("2026-01-01"),
      expiryDate: new Date("2027-01-01"),
      insurerCost: decimal(0),
      sourceQuotationId: QUOTATION_ID,
      sourceQuotationSectionId: null,
      sourceQuotationRevisionSnapshot: "R01",
      deletedAt: null,
      data: {},
    });

    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");
    const result = await generatePolicyRecordsAction(
      commonInput({
        sections: [sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" })],
      })
    );

    // The legacy null-section record must not block CAR from being
    // generated — it created its own, second record.
    expect(result.success).toBe(true);
    expect(policyRecords.size).toBe(2);
  });

  it("after the generated Policy is hard-deleted, the section is eligible for generation again", async () => {
    sections.set("sec-car", makeCarSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const first = await generatePolicyRecordsAction(
      commonInput({
        sections: [sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" })],
        idempotencyKey: "del-1",
      })
    );
    expect(first.success).toBe(true);
    expect(policyRecords.size).toBe(1);

    // PolicyRecord.deletedAt is never actually set by any code path in
    // this codebase — deletePolicyRecord() performs a real hard delete
    // (see that module's own doc comment) — so "soft delete" is simulated
    // here the same way it happens for real: the row is removed entirely.
    const deletedId = [...policyRecords.keys()][0];
    policyRecords.delete(deletedId);

    const second = await generatePolicyRecordsAction(
      commonInput({
        sections: [sectionInput("sec-car", { insurerCost: 450000, effectiveDate: "2026-09-01", expiryDate: "2027-08-31" })],
        idempotencyKey: "del-2",
      })
    );
    expect(second.success).toBe(true);
    if (second.success) {
      expect(second.created).toHaveLength(1);
      expect(second.alreadyGenerated).toEqual([]);
    }
    expect(policyRecords.size).toBe(1);
  });

  it("an unsupported sectionKind (GENERIC) is rejected — no Policy is created", async () => {
    sections.set("sec-generic", {
      id: "sec-generic",
      quotationId: QUOTATION_ID,
      sectionKind: "GENERIC",
      insuranceTypeNameSnapshot: "Custom Coverage",
      sectionTotal: decimal(10000),
    });
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const result = await generatePolicyRecordsAction(
      commonInput({ sections: [sectionInput("sec-generic", { insurerCost: 5000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" })] })
    );

    expect(result).toEqual({ success: false, error: "UNSUPPORTED_SECTION" });
    expect(policyRecords.size).toBe(0);
  });

  it("CUSTOMS_BOND (per-item-row bond values, no single reliable amount) is also rejected", async () => {
    sections.set("sec-customs", {
      id: "sec-customs",
      quotationId: QUOTATION_ID,
      sectionKind: "CUSTOMS_BOND",
      insuranceTypeNameSnapshot: "Customs Bond",
      sectionTotal: decimal(20000),
    });
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const result = await generatePolicyRecordsAction(
      commonInput({ sections: [sectionInput("sec-customs", { insurerCost: 5000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" })] })
    );

    expect(result).toEqual({ success: false, error: "UNSUPPORTED_SECTION" });
    expect(policyRecords.size).toBe(0);
  });

  it("a mixed batch (BOND section) derives bondType/bondAmount from the section's own detail, not a fabricated value, and keeps its own dates", async () => {
    sections.set("sec-tender", {
      id: "sec-tender",
      quotationId: QUOTATION_ID,
      sectionKind: "TENDER_SECURITY",
      insuranceTypeNameSnapshot: "Tender Security Bond",
      sectionTotal: decimal(15000),
      tenderSecurityDetail: { bondValue: decimal(2000000) },
    });
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const result = await generatePolicyRecordsAction(
      commonInput({
        sections: [sectionInput("sec-tender", { insurerCost: 10000, effectiveDate: "2026-08-25", expiryDate: "2027-02-24" })],
      })
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.created[0].category).toBe("BOND");
    const record = policyRecords.get(result.created[0].id)!;
    expect(record.customerPremium.toString()).toBe("15000");
    expect(record.effectiveDate.toISOString().slice(0, 10)).toBe("2026-08-25");
    expect(record.expiryDate.toISOString().slice(0, 10)).toBe("2027-02-24");
    const bondDetail = record.data.bondDetail as { create: { bondType: string; bondAmount: Prisma.Decimal } };
    expect(bondDetail.create.bondType).toBe("TENDER_BOND");
    expect(bondDetail.create.bondAmount.toString()).toBe("2000000");
  });

  it("three different insurance types (CAR / Motor Comprehensive / Performance Bond) each persist their own effective/expiry window in one batch", async () => {
    sections.set("sec-car", makeCarSection());
    sections.set("sec-motor", {
      id: "sec-motor",
      quotationId: QUOTATION_ID,
      sectionKind: "MOTOR_COMP_PRIVATE",
      insuranceTypeNameSnapshot: "Motor Comprehensive - Private",
      sectionTotal: decimal(70355),
      motorCompPrivateDetail: { plateNo: "KDA 123A", vehicleValue: decimal(2500000) },
    });
    sections.set("sec-bond", {
      id: "sec-bond",
      quotationId: QUOTATION_ID,
      sectionKind: "PERFORMANCE_BOND",
      insuranceTypeNameSnapshot: "Performance Bond",
      sectionTotal: decimal(100490),
      performanceBondDetail: { bondValue: decimal(5000000) },
    });
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const result = await generatePolicyRecordsAction(
      commonInput({
        processingDate: "2026-08-16",
        sections: [
          sectionInput("sec-car", { insurerCost: 300000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" }),
          sectionInput("sec-motor", { insurerCost: 70355, effectiveDate: "2026-09-01", expiryDate: "2027-08-31" }),
          sectionInput("sec-bond", { insurerCost: 90000, effectiveDate: "2026-08-25", expiryDate: "2027-02-24" }),
        ],
      })
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.created).toHaveLength(3);
    const bySectionId = new Map(result.created.map((c) => [c.sectionId, c]));
    const car = policyRecords.get(bySectionId.get("sec-car")!.id)!;
    const motor = policyRecords.get(bySectionId.get("sec-motor")!.id)!;
    const bond = policyRecords.get(bySectionId.get("sec-bond")!.id)!;

    // No two Policies must ever end up sharing CAR's dates — the exact
    // failure mode this phase's spec calls out explicitly.
    expect([car.effectiveDate, motor.effectiveDate, bond.effectiveDate].map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2026-08-20",
      "2026-09-01",
      "2026-08-25",
    ]);
    expect([car.expiryDate, motor.expiryDate, bond.expiryDate].map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2027-08-19",
      "2027-08-31",
      "2027-02-24",
    ]);
    expect(motor.category).toBe("MOTOR");
    expect(bond.category).toBe("BOND");
  });

  it("rejects when the quotation revision is not ISSUED/ACCEPTED", async () => {
    quotations.set(QUOTATION_ID, makeQuotation({ revisionStatus: "DRAFT" }));
    sections.set("sec-car", makeCarSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const result = await generatePolicyRecordsAction(
      commonInput({ sections: [sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" })] })
    );
    expect(result).toEqual({ success: false, error: "QUOTATION_NOT_ELIGIBLE" });
    expect(policyRecords.size).toBe(0);
  });

  it("rejects a missing insurerCost for a section that is actually being created", async () => {
    sections.set("sec-car", makeCarSection());
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const result = await generatePolicyRecordsAction(
      commonInput({ sections: [sectionInput("sec-car", { insurerCost: "", effectiveDate: "2026-08-20", expiryDate: "2027-08-19" })] })
    );
    expect(result).toEqual({ success: false, error: "INSURER_COST_INVALID" });
    expect(policyRecords.size).toBe(0);
  });

  it("FORBIDDEN: a user without the relevant policy.* permission cannot generate", async () => {
    const { auth } = await import("@/lib/auth");
    (auth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      user: { id: "staff-1", role: "Staff", status: "ACTIVE", permissions: ["policy.motor.edit"] },
    });
    sections.set("sec-car", makeCarSection()); // NON_MOTOR — staff only has policy.motor.edit
    const { generatePolicyRecordsAction } = await import("../generatePolicyRecordsAction");

    const result = await generatePolicyRecordsAction(
      commonInput({ sections: [sectionInput("sec-car", { insurerCost: 400000, effectiveDate: "2026-08-20", expiryDate: "2027-08-19" })] })
    );
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(policyRecords.size).toBe(0);
  });
});
