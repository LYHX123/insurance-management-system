import { describe, it, expect } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { resolveSectionPolicyPlan, policyCategoryForSectionKind, type SectionForPolicyPlan } from "../sectionPolicyMapping";

function baseSection(overrides: Partial<SectionForPolicyPlan>): SectionForPolicyPlan {
  return {
    id: "sec-1",
    sectionKind: "GENERIC",
    sectionTotal: new Prisma.Decimal(1000),
    motorCompPrivateDetail: null,
    motorCompCommercialDetail: null,
    motorTpoPrivateDetail: null,
    motorTpoCommercialDetail: null,
    tenderSecurityDetail: null,
    performanceBondDetail: null,
    advancePaymentGuaranteeDetail: null,
    ...overrides,
  };
}

describe("resolveSectionPolicyPlan", () => {
  it("maps every documented Non-Motor sectionKind to NON_MOTOR with the matching insuranceType", () => {
    const cases: [string, string][] = [
      ["CAR_PACKAGE", "CONTRACTORS_ALL_RISKS"],
      ["WIBA", "WIBA"],
      ["EMPLOYERS_LIABILITY", "EMPLOYERS_LIABILITY"],
      ["CPM_STANDALONE", "CONTRACTORS_PLANT_MACHINERY"],
      ["PUBLIC_LIABILITY", "PUBLIC_LIABILITY"],
      ["FIRE_AND_PERILS", "FIRE_ALLIED_PERILS"],
      ["BURGLARY", "BURGLARY"],
      ["GIT_SINGLE", "GOODS_IN_TRANSIT_SINGLE"],
      ["GIT_ANNUAL", "GOODS_IN_TRANSIT_ANNUAL"],
      ["MARINE_COVER", "MARINE"],
      ["GROUP_PERSONAL_ACCIDENT", "GROUP_PERSONAL_ACCIDENT"],
      ["GROUP_MEDICAL", "GROUP_MEDICAL"],
    ];
    for (const [sectionKind, expectedType] of cases) {
      const plan = resolveSectionPolicyPlan(baseSection({ sectionKind }));
      expect(plan).toEqual({ supported: true, category: "NON_MOTOR", insuranceType: expectedType });
    }
  });

  it("maps Motor sectionKinds to MOTOR with insuranceType/taxClass derived from the kind and registrationNumber from plateNo", () => {
    const plan = resolveSectionPolicyPlan(
      baseSection({
        sectionKind: "MOTOR_COMP_PRIVATE",
        motorCompPrivateDetail: { plateNo: "kaa 123a", vehicleValue: new Prisma.Decimal(2000000) },
      })
    );
    expect(plan).toEqual({
      supported: true,
      category: "MOTOR",
      insuranceType: "COMPREHENSIVE",
      taxClass: "PRIVATE",
      registrationNumber: "KAA 123A",
      vehicleValue: new Prisma.Decimal(2000000),
    });
  });

  it("Motor Third Party has no vehicleValue and never fabricates one", () => {
    const plan = resolveSectionPolicyPlan(
      baseSection({ sectionKind: "MOTOR_TPO_COMMERCIAL", motorTpoCommercialDetail: { plateNo: "KBZ 999Z" } })
    );
    expect(plan).toEqual({
      supported: true,
      category: "MOTOR",
      insuranceType: "THIRD PARTY",
      taxClass: "COMMERCIAL",
      registrationNumber: "KBZ 999Z",
      vehicleValue: null,
    });
  });

  it("a Motor sectionKind with no matching detail row is unsupported rather than guessed", () => {
    const plan = resolveSectionPolicyPlan(baseSection({ sectionKind: "MOTOR_COMP_PRIVATE", motorCompPrivateDetail: null }));
    expect(plan).toEqual({ supported: false });
  });

  it("maps the three single-value Bond sectionKinds to BOND using the section's own bondValue", () => {
    const plan = resolveSectionPolicyPlan(
      baseSection({ sectionKind: "PERFORMANCE_BOND", performanceBondDetail: { bondValue: new Prisma.Decimal(3000000) } })
    );
    expect(plan).toEqual({ supported: true, category: "BOND", bondType: "PERFORMANCE_BOND", bondAmount: new Prisma.Decimal(3000000) });
  });

  it("CUSTOMS_BOND is unsupported (per-item-row bond values, no single reliable section-level amount)", () => {
    expect(resolveSectionPolicyPlan(baseSection({ sectionKind: "CUSTOMS_BOND" }))).toEqual({ supported: false });
  });

  it("GENERIC is unsupported", () => {
    expect(resolveSectionPolicyPlan(baseSection({ sectionKind: "GENERIC" }))).toEqual({ supported: false });
  });
});

describe("policyCategoryForSectionKind", () => {
  it("returns the category for every supported kind and null for unsupported ones", () => {
    expect(policyCategoryForSectionKind("WIBA")).toBe("NON_MOTOR");
    expect(policyCategoryForSectionKind("MOTOR_COMP_PRIVATE")).toBe("MOTOR");
    expect(policyCategoryForSectionKind("TENDER_SECURITY")).toBe("BOND");
    expect(policyCategoryForSectionKind("CUSTOMS_BOND")).toBeNull();
    expect(policyCategoryForSectionKind("GENERIC")).toBeNull();
  });
});
