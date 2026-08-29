import { describe, it, expect, vi } from "vitest";

// Phase 10 — a quotation revision / deep-copy must carry the selected EL
// option tier (and its snapshotted rate + three liability limits) forward
// into the next revision exactly, so "Create revision" of an EL 30% / 40%
// quotation preserves 30% / 40% and its limits.

const findUniqueOrThrow = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { quotation: { findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrow(...args) } },
}));

const BASE_SECTION_FIELDS = {
  insuranceTypeId: "it-el",
  sectionKind: "EMPLOYERS_LIABILITY" as const,
  insuranceTypeNameSnapshot: "Employers' Liability",
  description: null,
  phcfRate: "0.25",
  itlRate: "0.2",
  stampDuty: "40",
  applyPHCF: true,
  applyITL: true,
  applyStampDuty: true,
  clausesSnapshot: null,
  exclusionsSnapshot: null,
  conditionsSnapshot: null,
  basePremium: "30000",
  phcfAmount: "75",
  itlAmount: "60",
  stampDutyAmount: "40",
  sectionTotal: "30175",
  sortOrder: 0,
  items: [],
  carDetail: null,
  wibaDetail: null,
  elDetail: null,
  cpmDetail: null,
  publicLiabilityDetail: null,
  fireDetail: null,
  burglaryDetail: null,
  gitSingleDetail: null,
  gitAnnualDetail: null,
  marineDetail: null,
  motorCompPrivateDetail: null,
  motorCompCommercialDetail: null,
  motorTpoPrivateDetail: null,
  motorTpoCommercialDetail: null,
  gpaDetail: null,
  medicalDetail: null,
  tenderSecurityDetail: null,
  performanceBondDetail: null,
  advancePaymentGuaranteeDetail: null,
  customsBondDetail: null,
};

function elDetail(opt: number, rate: string, aop: string, aoe: string, aoy: string) {
  return {
    linkedWibaGrossPremium: "100000",
    elOption: opt,
    elRatePercent: rate,
    anyOnePersonLimit: aop,
    anyOneOccurrenceLimit: aoe,
    anyOneYearLimit: aoy,
    grossPremium: "30000",
    phcfAmount: "75",
    itlAmount: "60",
    stampDutyAmount: "40",
    totalPremium: "30175",
  };
}

describe("deepCopyQuotationSections — EL option tier", () => {
  it("Option 2 (30%): rate + 4m/15m/30m limits preserved in the clone", async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: "quo-el-30",
      customerId: "cust-1",
      projectId: null,
      sections: [{ ...BASE_SECTION_FIELDS, elDetail: elDetail(2, "30", "4000000", "15000000", "30000000") }],
    });

    const { deepCopyQuotationSections } = await import("../deepCopy");
    const { sectionCreates } = await deepCopyQuotationSections("quo-el-30");
    const create = (sectionCreates[0].elDetail as { create: Record<string, unknown> }).create;

    expect(create.elOption).toBe(2);
    expect(create.elRatePercent).toBe("30");
    expect(create.anyOnePersonLimit).toBe("4000000");
    expect(create.anyOneOccurrenceLimit).toBe("15000000");
    expect(create.anyOneYearLimit).toBe("30000000");
  });

  it("Option 4 (40%): rate + 8m/25m/50m limits preserved in the clone", async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: "quo-el-40",
      customerId: "cust-1",
      projectId: null,
      sections: [{ ...BASE_SECTION_FIELDS, elDetail: elDetail(4, "40", "8000000", "25000000", "50000000") }],
    });

    const { deepCopyQuotationSections } = await import("../deepCopy");
    const { sectionCreates } = await deepCopyQuotationSections("quo-el-40");
    const create = (sectionCreates[0].elDetail as { create: Record<string, unknown> }).create;

    expect(create.elOption).toBe(4);
    expect(create.elRatePercent).toBe("40");
    expect(create.anyOnePersonLimit).toBe("8000000");
    expect(create.anyOneOccurrenceLimit).toBe("25000000");
    expect(create.anyOneYearLimit).toBe("50000000");
  });
});
