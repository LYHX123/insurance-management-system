import { describe, it, expect, vi } from "vitest";

// Phase 9 — WIBA / CPM Schedule Import, Case 16: revision clone/deep-copy
// must carry the two new fields (monthlyOtherEarnings, chassisOrPlate)
// forward into the next revision exactly, not silently drop them (this
// phase's spec, Part XVI: "Revision 必须形成独立 snapshot").

const findUniqueOrThrow = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { quotation: { findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrow(...args) } },
}));

const BASE_SECTION_FIELDS = {
  insuranceTypeId: "it-1",
  sectionKind: "WIBA" as const,
  insuranceTypeNameSnapshot: "WIBA",
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
  basePremium: "1000",
  phcfAmount: "2.5",
  itlAmount: "2",
  stampDutyAmount: "40",
  sectionTotal: "1044.5",
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

describe("deepCopyQuotationSections — WIBA monthlyOtherEarnings / CPM chassisOrPlate", () => {
  it("carries monthlyOtherEarnings forward for every WIBA payroll row", async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: "quo-1",
      customerId: "cust-1",
      projectId: null,
      sections: [
        {
          ...BASE_SECTION_FIELDS,
          sectionKind: "WIBA",
          wibaDetail: {
            wibaRate: "0.5",
            totalEmployeeCount: 2,
            totalAnnualWages: "276000",
            grossPremium: "1380",
            phcfAmount: "3.45",
            itlAmount: "2.76",
            stampDutyAmount: "40",
            totalPremium: "1426.21",
            payrollRows: [
              {
                occupation: "Mason",
                employeeCount: 2,
                annualWages: "276000",
                basicMonthlySalary: "10000",
                monthlyAllowance: "1000",
                monthlyOtherEarnings: "500",
                sortOrder: 0,
              },
            ],
          },
        },
      ],
    });

    const { deepCopyQuotationSections } = await import("../deepCopy");
    const { sectionCreates } = await deepCopyQuotationSections("quo-1");

    const wibaCreate = sectionCreates[0].wibaDetail as { create: { payrollRows: { create: Record<string, unknown>[] } } };
    expect(wibaCreate.create.payrollRows.create).toHaveLength(1);
    expect(wibaCreate.create.payrollRows.create[0].monthlyOtherEarnings).toBe("500");
    expect(wibaCreate.create.payrollRows.create[0].occupation).toBe("Mason");
  });

  it("a legacy row with monthlyOtherEarnings = null clones as null, never as 0 or dropped", async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: "quo-1",
      customerId: "cust-1",
      projectId: null,
      sections: [
        {
          ...BASE_SECTION_FIELDS,
          sectionKind: "WIBA",
          wibaDetail: {
            wibaRate: "0.5",
            totalEmployeeCount: 1,
            totalAnnualWages: "500000",
            grossPremium: "2500",
            phcfAmount: "6.25",
            itlAmount: "5",
            stampDutyAmount: "40",
            totalPremium: "2551.25",
            payrollRows: [
              { occupation: "Legacy", employeeCount: 1, annualWages: "500000", basicMonthlySalary: null, monthlyAllowance: null, monthlyOtherEarnings: null, sortOrder: 0 },
            ],
          },
        },
      ],
    });

    const { deepCopyQuotationSections } = await import("../deepCopy");
    const { sectionCreates } = await deepCopyQuotationSections("quo-1");

    const wibaCreate = sectionCreates[0].wibaDetail as { create: { payrollRows: { create: Record<string, unknown>[] } } };
    expect(wibaCreate.create.payrollRows.create[0].monthlyOtherEarnings).toBeNull();
  });

  it("carries chassisOrPlate forward for every CPM equipment row", async () => {
    findUniqueOrThrow.mockResolvedValue({
      id: "quo-2",
      customerId: "cust-1",
      projectId: null,
      sections: [
        {
          ...BASE_SECTION_FIELDS,
          sectionKind: "CPM_STANDALONE",
          cpmDetail: {
            cpmRate: "0.3",
            pvtLoadingEnabled: false,
            pvtLoadingRate: null,
            pvtLoadingAmount: "0",
            pvtLoadingPremium: "0",
            totalSumInsured: "1000000",
            basicPremium: "3000",
            grossPremium: "3000",
            phcfAmount: "7.5",
            itlAmount: "6",
            stampDutyAmount: "40",
            totalPremium: "3053.5",
            equipmentRows: [
              { equipmentName: "Excavator", quantity: 2, unitValue: "500000", totalValue: "1000000", chassisOrPlate: "KDX 123X", sortOrder: 0 },
            ],
          },
        },
      ],
    });

    const { deepCopyQuotationSections } = await import("../deepCopy");
    const { sectionCreates } = await deepCopyQuotationSections("quo-2");

    const cpmCreate = sectionCreates[0].cpmDetail as { create: { equipmentRows: { create: Record<string, unknown>[] } } };
    expect(cpmCreate.create.equipmentRows.create[0].chassisOrPlate).toBe("KDX 123X");
    expect(cpmCreate.create.equipmentRows.create[0].equipmentName).toBe("Excavator");
  });
});
