"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { generateQuotationNumber } from "@/lib/quotation-utils";
import {
  calculateCoverageItemPremium,
  calculateQuotationTotals,
  calculateSectionTotals,
  roundMoney,
  toDecimal,
  type QuotationTotals,
  type SectionTotals,
} from "@/lib/money";
import { calculateCarPackage, type CarPackageResult } from "@/lib/insuranceCalculations/car";
import { calculateWiba, type WibaResult } from "@/lib/insuranceCalculations/wiba";
import { calculateEl } from "@/lib/insuranceCalculations/el";
import { calculateCpmStandalone, type CpmStandaloneResult } from "@/lib/insuranceCalculations/cpm";
import { calculatePublicLiability } from "@/lib/insuranceCalculations/publicLiability";
import { calculateFire } from "@/lib/insuranceCalculations/fire";
import { calculateBurglary } from "@/lib/insuranceCalculations/burglary";
import { calculateGitSingle } from "@/lib/insuranceCalculations/gitSingle";
import { calculateGitAnnual } from "@/lib/insuranceCalculations/gitAnnual";
import { calculateMarine } from "@/lib/insuranceCalculations/marine";
import { calculateMotorComprehensive, type MotorComprehensiveResult } from "@/lib/insuranceCalculations/motorComprehensive";
import { calculateMotorTpo, type MotorTpoResult } from "@/lib/insuranceCalculations/motorTpo";
import { calculateGpa } from "@/lib/insuranceCalculations/gpa";
import { calculateMedical } from "@/lib/insuranceCalculations/medical";
import { calculateGuarantee, type GuaranteeResult } from "@/lib/insuranceCalculations/guarantee";
import { calculateCustomsBond } from "@/lib/insuranceCalculations/customsBond";
import { ITL_RATE, PHCF_RATE } from "@/lib/insuranceCalculations/constants";
import { Prisma } from "@/generated/prisma/client";
import type { CalculationMethod, QuotationSectionKind, QuotationStatus, MedicalFamilyCategory } from "@/generated/prisma/enums";
import type { InsuranceTypeModel } from "@/generated/prisma/models";

type ActionResult<T = object> =
  | ({ success: true } & T)
  | { success: false; error: string };

type ValidationError = { error: string };
type CustomerProjectCheckResult = ValidationError | { ok: true };
type SectionBuildResult =
  | ValidationError
  | {
      sectionCreates: Prisma.QuotationInsuranceSectionCreateWithoutQuotationInput[];
      quotationTotals: QuotationTotals;
    };
type SingleSectionResult =
  | ValidationError
  | {
      sectionCreate: Prisma.QuotationInsuranceSectionCreateWithoutQuotationInput;
      totals: SectionTotals;
    };

function isErr<T>(value: T | ValidationError): value is ValidationError {
  return typeof value === "object" && value !== null && "error" in value;
}

export type CoverageItemInput = {
  insuredContent: string;
  sumInsured?: number | string | null;
  rate?: number | string | null;
  calculationMethod: CalculationMethod;
  premium?: number | string | null;
  notes?: string | null;
};

// The original generic, freeform line-item section. sectionKind is omitted
// (or "GENERIC") for this variant — it is the only kind that predates Phase 1
// and remains fully backward compatible with existing quotations.
export type GenericSectionInput = {
  sectionKind?: "GENERIC";
  insuranceTypeId: string;
  description?: string | null;
  phcfRate: number | string;
  itlRate: number | string;
  stampDuty: number | string;
  applyPHCF: boolean;
  applyITL: boolean;
  applyStampDuty: boolean;
  clausesSnapshot?: string | null;
  exclusionsSnapshot?: string | null;
  conditionsSnapshot?: string | null;
  items: CoverageItemInput[];
};

export type CarPackageSectionInput = {
  sectionKind: "CAR_PACKAGE";
  insuranceTypeId: string;
  description?: string | null;
  car: {
    projectName?: string | null;
    contractValue: number | string | null;
    carRate: number | string | null;
    constructionPeriodMonths: number | string | null;
    maintenancePeriodMonths: number | string | null;
    cpmValue?: number | string | null;
    cpmRate?: number | string | null;
    tplAnyOneClaim?: number | string | null;
    tplAnyOneEvent?: number | string | null;
    tplAnyOnePeriod?: number | string | null;
    tplRate?: number | string | null;
    tplComplimentary: boolean;
    pvtLoadingEnabled: boolean;
    pvtLoadingRate?: number | string | null;
    pvtLoadingAmount?: number | string | null;
  };
};

export type WibaSectionInput = {
  sectionKind: "WIBA";
  insuranceTypeId: string;
  description?: string | null;
  wiba: {
    wibaRate: number | string | null;
    payrollRows: {
      occupation: string;
      employeeCount: number | string | null;
      annualWages: number | string | null;
      basicMonthlySalary?: number | string | null;
      monthlyAllowance?: number | string | null;
    }[];
  };
};

export type ElSectionInput = {
  sectionKind: "EMPLOYERS_LIABILITY";
  insuranceTypeId: string;
  description?: string | null;
};

export type CpmStandaloneSectionInput = {
  sectionKind: "CPM_STANDALONE";
  insuranceTypeId: string;
  description?: string | null;
  cpm: {
    cpmRate: number | string | null;
    pvtLoadingEnabled: boolean;
    pvtLoadingRate?: number | string | null;
    equipmentRows: {
      equipmentName: string;
      quantity: number | string | null;
      unitValue: number | string | null;
    }[];
  };
};

export type PublicLiabilitySectionInput = {
  sectionKind: "PUBLIC_LIABILITY";
  insuranceTypeId: string;
  description?: string | null;
  publicLiability: {
    anyOnePersonLimit?: number | string | null;
    anyOneOccurrenceLimit?: number | string | null;
    anyOneYearLimit: number | string | null;
    rate: number | string | null;
  };
};

export type FireSectionInput = {
  sectionKind: "FIRE_AND_PERILS";
  insuranceTypeId: string;
  description?: string | null;
  fire: {
    propertyValue: number | string | null;
    rawMaterialValue?: number | string | null;
    goodsInStockValue?: number | string | null;
    rate: number | string | null;
    earthquakeLoadingEnabled: boolean;
    floodLoadingEnabled: boolean;
    pvtLoadingEnabled: boolean;
    pvtLoadingRate?: number | string | null;
    pvtLoadingAmount?: number | string | null;
  };
};

export type BurglarySectionInput = {
  sectionKind: "BURGLARY";
  insuranceTypeId: string;
  description?: string | null;
  burglary: {
    equipmentValue?: number | string | null;
    stockValue?: number | string | null;
    firstLossPercentage: number | string | null;
    rate: number | string | null;
  };
};

export type GitSingleSectionInput = {
  sectionKind: "GIT_SINGLE";
  insuranceTypeId: string;
  description?: string | null;
  gitSingle: {
    cargoDescription: string;
    route?: string | null;
    sumInsured: number | string | null;
    rate: number | string | null;
    pvtLoadingEnabled: boolean;
    pvtLoadingRate?: number | string | null;
    pvtLoadingAmount?: number | string | null;
  };
};

export type GitAnnualSectionInput = {
  sectionKind: "GIT_ANNUAL";
  insuranceTypeId: string;
  description?: string | null;
  gitAnnual: {
    cargoDescription: string;
    singleLimit: number | string | null;
    yearLimit: number | string | null;
    singleLimitRate: number | string | null;
    yearLimitRate: number | string | null;
    pvtLoadingEnabled: boolean;
    pvtLoadingRate?: number | string | null;
    pvtLoadingAmount?: number | string | null;
  };
};

export type MarineSectionInput = {
  sectionKind: "MARINE_COVER";
  insuranceTypeId: string;
  description?: string | null;
  marine: {
    cargoDescription?: string | null;
    origin?: string | null;
    destination?: string | null;
    shipmentRows: {
      referenceNo?: string | null;
      sumInsured: number | string | null;
      rate: number | string | null;
    }[];
  };
};

export type MotorComprehensiveFields = {
  plateNo: string;
  vehicleValue: number | string | null;
  periodFrom: string | null;
  periodTo: string | null;
  excessProtector?: string | null;
  pvt?: string | null;
  rate: number | string | null;
};

export type MotorCompPrivateSectionInput = {
  sectionKind: "MOTOR_COMP_PRIVATE";
  insuranceTypeId: string;
  description?: string | null;
  motor: MotorComprehensiveFields;
};

export type MotorCompCommercialSectionInput = {
  sectionKind: "MOTOR_COMP_COMMERCIAL";
  insuranceTypeId: string;
  description?: string | null;
  motor: MotorComprehensiveFields;
};

export type MotorTpoFields = {
  plateNo: string;
  loadingCapacity?: number | string | null;
  basePremium: number | string | null;
  periodFrom: string | null;
  periodTo: string | null;
};

export type MotorTpoPrivateSectionInput = {
  sectionKind: "MOTOR_TPO_PRIVATE";
  insuranceTypeId: string;
  description?: string | null;
  motor: MotorTpoFields;
};

export type MotorTpoCommercialSectionInput = {
  sectionKind: "MOTOR_TPO_COMMERCIAL";
  insuranceTypeId: string;
  description?: string | null;
  motor: MotorTpoFields;
};

export type GpaSectionInput = {
  sectionKind: "GROUP_PERSONAL_ACCIDENT";
  insuranceTypeId: string;
  description?: string | null;
  gpa: {
    deathLimit: number | string | null;
    ptdLimit: number | string | null;
    ttdLimit: number | string | null;
    medicalLimit: number | string | null;
    funeralLimit: number | string | null;
    deathRate: number | string | null;
    ptdRate: number | string | null;
    ttdRate: number | string | null;
    medicalRate: number | string | null;
    funeralRate: number | string | null;
    numberOfPeople: number | string | null;
  };
};

export type MedicalSectionInput = {
  sectionKind: "GROUP_MEDICAL";
  insuranceTypeId: string;
  description?: string | null;
  medical: {
    inpatientLimit?: number | string | null;
    outpatientLimit?: number | string | null;
    categoryRows: {
      category: string;
      employeeCount: number | string | null;
      inpatientRate: number | string | null;
      outpatientRate: number | string | null;
    }[];
  };
};

export type GuaranteeFields = {
  projectName: string;
  bondValue: number | string | null;
  rate: number | string | null;
};

export type TenderSecuritySectionInput = {
  sectionKind: "TENDER_SECURITY";
  insuranceTypeId: string;
  description?: string | null;
  guarantee: GuaranteeFields;
};

export type PerformanceBondSectionInput = {
  sectionKind: "PERFORMANCE_BOND";
  insuranceTypeId: string;
  description?: string | null;
  guarantee: GuaranteeFields;
};

export type AdvancePaymentGuaranteeSectionInput = {
  sectionKind: "ADVANCE_PAYMENT_GUARANTEE";
  insuranceTypeId: string;
  description?: string | null;
  guarantee: GuaranteeFields;
};

export type CustomsBondSectionInput = {
  sectionKind: "CUSTOMS_BOND";
  insuranceTypeId: string;
  description?: string | null;
  customsBond: {
    itemRows: {
      bondType: string;
      bondValue: number | string | null;
      rate: number | string | null;
    }[];
  };
};

export type SectionInput =
  | GenericSectionInput
  | CarPackageSectionInput
  | WibaSectionInput
  | ElSectionInput
  | CpmStandaloneSectionInput
  | PublicLiabilitySectionInput
  | FireSectionInput
  | BurglarySectionInput
  | GitSingleSectionInput
  | GitAnnualSectionInput
  | MarineSectionInput
  | MotorCompPrivateSectionInput
  | MotorCompCommercialSectionInput
  | MotorTpoPrivateSectionInput
  | MotorTpoCommercialSectionInput
  | GpaSectionInput
  | MedicalSectionInput
  | TenderSecuritySectionInput
  | PerformanceBondSectionInput
  | AdvancePaymentGuaranteeSectionInput
  | CustomsBondSectionInput;

export type QuotationInput = {
  customerId: string;
  projectId?: string | null;
  quotationDate?: string | null;
  validUntil?: string | null;
  currency?: string;
  internalNotes?: string | null;
  sections: SectionInput[];
};

async function requireQuotationPermission() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "quotation")) {
    return null;
  }
  return session;
}

function isBlank(value: number | string | null | undefined): boolean {
  return value === null || value === undefined || value === "";
}

function parseRequiredNonNegative(
  value: number | string | null | undefined,
  errorCode: string
): ValidationError | Prisma.Decimal {
  if (isBlank(value)) return { error: errorCode };
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return { error: errorCode };
  return toDecimal(value);
}

function parseOptionalNonNegative(
  value: number | string | null | undefined,
  errorCode: string
): ValidationError | Prisma.Decimal | null {
  if (isBlank(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return { error: errorCode };
  return toDecimal(value);
}

// Shared PVT loading parser for the Phase 2A section kinds (Fire, GIT Single,
// GIT Annual) that all follow the same manual-amount-only PVT pattern CAR
// and CPM already established: disabled -> zero/null; enabled -> amount is
// required, rate is optional and stored for reference only.
function parsePvtLoading(
  enabled: boolean,
  amount: number | string | null | undefined,
  rate: number | string | null | undefined,
  amountErrorCode: string,
  rateErrorCode: string
): ValidationError | { pvtLoadingRate: Prisma.Decimal | null; pvtLoadingAmount: Prisma.Decimal } {
  if (!enabled) return { pvtLoadingRate: null, pvtLoadingAmount: toDecimal(0) };
  const amt = parseRequiredNonNegative(amount, amountErrorCode);
  if (isErr(amt)) return amt;
  const r = parseOptionalNonNegative(rate, rateErrorCode);
  if (isErr(r)) return r;
  return { pvtLoadingRate: r, pvtLoadingAmount: amt };
}

function parseRequiredNonNegativeInt(
  value: number | string | null | undefined,
  errorCode: string
): ValidationError | number {
  if (isBlank(value)) return { error: errorCode };
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return { error: errorCode };
  return n;
}

// Blank -> 0 (e.g. a Medical category row nobody filled in), present but
// invalid -> still an error. Distinct from parseRequiredNonNegativeInt,
// which treats blank itself as an error.
function parseOptionalNonNegativeInt(
  value: number | string | null | undefined,
  errorCode: string
): ValidationError | number {
  if (isBlank(value)) return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return { error: errorCode };
  return n;
}

const MEDICAL_FAMILY_CATEGORIES: MedicalFamilyCategory[] = [
  "M",
  "M_PLUS_1",
  "M_PLUS_2",
  "M_PLUS_3",
  "M_PLUS_4",
  "M_PLUS_5",
];

function pickTotals(calc: {
  basePremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  sectionTotal: Prisma.Decimal;
}): SectionTotals {
  return {
    basePremium: calc.basePremium,
    phcfAmount: calc.phcfAmount,
    itlAmount: calc.itlAmount,
    stampDutyAmount: calc.stampDutyAmount,
    sectionTotal: calc.sectionTotal,
  };
}

// Shared roll-up fields every structured (non-GENERIC) section writes onto
// QuotationInsuranceSection — the constants apply universally in Phase 1, so
// there is no per-section apply-toggle for these kinds (unlike GENERIC).
function structuredSectionFields(
  section: { insuranceTypeId: string; description?: string | null },
  insuranceType: InsuranceTypeModel,
  sectionKind: QuotationSectionKind,
  totals: SectionTotals
) {
  return {
    insuranceType: { connect: { id: insuranceType.id } },
    insuranceTypeNameSnapshot: insuranceType.name,
    sectionKind,
    description: section.description?.trim() || null,
    phcfRate: toDecimal(PHCF_RATE),
    itlRate: toDecimal(ITL_RATE),
    stampDuty: totals.stampDutyAmount,
    applyPHCF: true,
    applyITL: true,
    applyStampDuty: true,
    clausesSnapshot: null,
    exclusionsSnapshot: null,
    conditionsSnapshot: null,
    basePremium: totals.basePremium,
    phcfAmount: totals.phcfAmount,
    itlAmount: totals.itlAmount,
    sectionTotal: totals.sectionTotal,
  };
}

function validateItem(
  item: CoverageItemInput
):
  | { error: string }
  | {
      insuredContent: string;
      sumInsured: Prisma.Decimal | null;
      rate: Prisma.Decimal | null;
      calculationMethod: CalculationMethod;
      premium: Prisma.Decimal;
      notes: string | null;
    } {
  const insuredContent = item.insuredContent.trim();
  if (!insuredContent) return { error: "ITEM_CONTENT_REQUIRED" };

  if (item.calculationMethod === "PERCENTAGE") {
    if (isBlank(item.sumInsured)) return { error: "ITEM_SUM_INSURED_REQUIRED" };
    if (isBlank(item.rate)) return { error: "ITEM_RATE_REQUIRED" };
  } else if (isBlank(item.premium)) {
    return { error: "ITEM_PREMIUM_REQUIRED" };
  }

  const premium = calculateCoverageItemPremium({
    calculationMethod: item.calculationMethod,
    sumInsured: item.sumInsured,
    rate: item.rate,
    premium: item.premium,
  });

  return {
    insuredContent,
    sumInsured: isBlank(item.sumInsured) ? null : toDecimal(item.sumInsured),
    rate: isBlank(item.rate) ? null : toDecimal(item.rate),
    calculationMethod: item.calculationMethod,
    premium,
    notes: item.notes?.trim() || null,
  };
}

function buildGenericSection(
  section: GenericSectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  if (!section.items || section.items.length === 0) {
    return { error: "AT_LEAST_ONE_ITEM" };
  }

  const itemCreates: Prisma.QuotationCoverageItemCreateWithoutSectionInput[] = [];
  const itemPremiums: Prisma.Decimal[] = [];

  for (const item of section.items) {
    const validated = validateItem(item);
    if ("error" in validated) return { error: validated.error };
    itemCreates.push({ ...validated, sortOrder: itemCreates.length });
    itemPremiums.push(validated.premium);
  }

  const totals = calculateSectionTotals({
    applyPHCF: section.applyPHCF,
    phcfRate: section.phcfRate,
    applyITL: section.applyITL,
    itlRate: section.itlRate,
    applyStampDuty: section.applyStampDuty,
    stampDuty: section.stampDuty,
    itemPremiums,
  });

  return {
    sectionCreate: {
      insuranceType: { connect: { id: insuranceType.id } },
      insuranceTypeNameSnapshot: insuranceType.name,
      sectionKind: "GENERIC",
      description: section.description?.trim() || null,
      phcfRate: toDecimal(section.phcfRate),
      itlRate: toDecimal(section.itlRate),
      stampDuty: toDecimal(section.stampDuty),
      applyPHCF: section.applyPHCF,
      applyITL: section.applyITL,
      applyStampDuty: section.applyStampDuty,
      clausesSnapshot: section.clausesSnapshot?.trim() || null,
      exclusionsSnapshot: section.exclusionsSnapshot?.trim() || null,
      conditionsSnapshot: section.conditionsSnapshot?.trim() || null,
      basePremium: totals.basePremium,
      phcfAmount: totals.phcfAmount,
      itlAmount: totals.itlAmount,
      sectionTotal: totals.sectionTotal,
      items: { create: itemCreates },
    },
    totals,
  };
}

function buildCarMirrorItems(
  car: CarPackageSectionInput["car"],
  contractValue: Prisma.Decimal,
  carRate: Prisma.Decimal,
  cpmValue: Prisma.Decimal | null,
  cpmRate: Prisma.Decimal | null,
  tplAnyOnePeriod: Prisma.Decimal | null,
  tplRate: Prisma.Decimal | null,
  calc: CarPackageResult
): Prisma.QuotationCoverageItemCreateWithoutSectionInput[] {
  const items: Prisma.QuotationCoverageItemCreateWithoutSectionInput[] = [];

  items.push({
    insuredContent: "Main CAR Premium",
    sumInsured: contractValue,
    rate: carRate,
    calculationMethod: "PERCENTAGE",
    premium: calc.carBasicPremium,
    sortOrder: items.length,
  });

  if (cpmValue !== null && cpmRate !== null) {
    items.push({
      insuredContent: "CPM Inside CAR Premium",
      sumInsured: cpmValue,
      rate: cpmRate,
      calculationMethod: "PERCENTAGE",
      premium: calc.carCpmPremium,
      sortOrder: items.length,
    });
  }

  if (car.pvtLoadingEnabled) {
    items.push({
      insuredContent: "PVT Loading (Main CAR + CPM)",
      sumInsured: calc.carPvtLoadingAmount,
      rate: calc.carPvtLoadingRate,
      calculationMethod: "PERCENTAGE",
      premium: calc.carPvtLoadingPremium,
      sortOrder: items.length,
    });
  }

  if (car.tplComplimentary) {
    items.push({
      insuredContent: "TPL Premium (Complimentary)",
      sumInsured: null,
      rate: null,
      calculationMethod: "MANUAL_PREMIUM",
      premium: toDecimal(0),
      notes: "Complimentary — no charge",
      sortOrder: items.length,
    });
  } else {
    items.push({
      insuredContent: "TPL Premium (Any One Period basis)",
      sumInsured: tplAnyOnePeriod,
      rate: tplRate,
      calculationMethod: "PERCENTAGE",
      premium: calc.tplGrossPremium,
      sortOrder: items.length,
    });
  }

  return items;
}

function buildCarSection(
  section: CarPackageSectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const car = section.car;

  const contractValue = parseRequiredNonNegative(car.contractValue, "CAR_CONTRACT_VALUE_INVALID");
  if (isErr(contractValue)) return contractValue;
  const carRate = parseRequiredNonNegative(car.carRate, "CAR_RATE_INVALID");
  if (isErr(carRate)) return carRate;

  const constructionPeriodMonths = parseRequiredNonNegativeInt(
    car.constructionPeriodMonths,
    "CAR_PERIOD_REQUIRED"
  );
  if (isErr(constructionPeriodMonths)) return constructionPeriodMonths;
  const maintenancePeriodMonths = parseRequiredNonNegativeInt(
    car.maintenancePeriodMonths,
    "CAR_PERIOD_REQUIRED"
  );
  if (isErr(maintenancePeriodMonths)) return maintenancePeriodMonths;

  const cpmProvided = !isBlank(car.cpmValue) || !isBlank(car.cpmRate);
  let cpmValue: Prisma.Decimal | null = null;
  let cpmRate: Prisma.Decimal | null = null;
  if (cpmProvided) {
    if (isBlank(car.cpmValue) || isBlank(car.cpmRate)) return { error: "CAR_CPM_INCOMPLETE" };
    const v = parseRequiredNonNegative(car.cpmValue, "CAR_CPM_INVALID");
    if (isErr(v)) return v;
    const r = parseRequiredNonNegative(car.cpmRate, "CAR_CPM_INVALID");
    if (isErr(r)) return r;
    cpmValue = v;
    cpmRate = r;
  }

  const claim = parseOptionalNonNegative(car.tplAnyOneClaim, "CAR_TPL_LIMIT_INVALID");
  if (isErr(claim)) return claim;
  const event = parseOptionalNonNegative(car.tplAnyOneEvent, "CAR_TPL_LIMIT_INVALID");
  if (isErr(event)) return event;

  let tplAnyOnePeriod: Prisma.Decimal | null = null;
  let tplRate: Prisma.Decimal | null = null;
  if (!car.tplComplimentary) {
    const period = parseRequiredNonNegative(car.tplAnyOnePeriod, "CAR_TPL_BASIS_REQUIRED");
    if (isErr(period)) return period;
    const rate = parseRequiredNonNegative(car.tplRate, "CAR_TPL_BASIS_REQUIRED");
    if (isErr(rate)) return rate;
    tplAnyOnePeriod = period;
    tplRate = rate;
  } else {
    // Complimentary TPL: the limits are still saved (they must appear on the
    // quotation document), but the rate is always zero/null — no premium is
    // ever charged on this block regardless of what a prior, non-complimentary
    // entry left behind in tplRate.
    const period = parseOptionalNonNegative(car.tplAnyOnePeriod, "CAR_TPL_LIMIT_INVALID");
    if (isErr(period)) return period;
    tplAnyOnePeriod = period;
    tplRate = null;
  }

  let pvtLoadingRate: Prisma.Decimal | null = null;
  let pvtLoadingAmount = toDecimal(0);
  if (car.pvtLoadingEnabled) {
    const amt = parseRequiredNonNegative(car.pvtLoadingAmount, "CAR_PVT_AMOUNT_REQUIRED");
    if (isErr(amt)) return amt;
    pvtLoadingAmount = amt;
    const rate = parseOptionalNonNegative(car.pvtLoadingRate, "CAR_PVT_RATE_INVALID");
    if (isErr(rate)) return rate;
    pvtLoadingRate = rate;
  }

  const calc = calculateCarPackage({
    contractValue,
    carRate,
    cpmValue,
    cpmRate,
    pvtLoadingEnabled: car.pvtLoadingEnabled,
    pvtLoadingAmount,
    pvtLoadingRate,
    tplComplimentary: car.tplComplimentary,
    tplAnyOnePeriod,
    tplRate,
  });

  const totals = pickTotals(calc);
  const items = buildCarMirrorItems(
    car,
    contractValue,
    carRate,
    cpmValue,
    cpmRate,
    tplAnyOnePeriod,
    tplRate,
    calc
  );

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "CAR_PACKAGE", totals),
      items: { create: items },
      carDetail: {
        create: {
          projectName: car.projectName?.trim() || null,
          contractValue,
          carRate,
          // Legacy date range is no longer collected — every section created
          // or re-saved from this point on carries the month fields instead.
          contractPeriodFrom: null,
          contractPeriodTo: null,
          constructionPeriodMonths,
          maintenancePeriodMonths,
          cpmValue,
          cpmRate,
          tplAnyOneClaim: claim,
          tplAnyOneEvent: event,
          tplAnyOnePeriod,
          tplRate,
          tplComplimentary: car.tplComplimentary,
          pvtLoadingEnabled: car.pvtLoadingEnabled,
          pvtLoadingRate,
          pvtLoadingAmount,
          pvtLoadingPremium: calc.carPvtLoadingPremium,
          carBasicPremium: calc.carBasicPremium,
          carCpmPremium: calc.carCpmPremium,
          carMainGrossPremium: calc.carMainGrossPremium,
          carMainPhcf: calc.carMainPhcf,
          carMainItl: calc.carMainItl,
          carMainStampDuty: calc.carMainStampDuty,
          carMainTotal: calc.carMainTotal,
          tplGrossPremium: calc.tplGrossPremium,
          tplPhcf: calc.tplPhcf,
          tplItl: calc.tplItl,
          tplStampDuty: calc.tplStampDuty,
          tplTotalPremium: calc.tplTotalPremium,
        },
      },
    },
    totals,
  };
}

// Validates and calculates the WIBA section ahead of the main per-section
// loop, because Employer's Liability (processed later in the same loop)
// needs the WIBA gross premium it derives from.
type PreparedWibaRow = {
  occupation: string;
  employeeCount: number;
  annualWages: Prisma.Decimal;
  basicMonthlySalary: Prisma.Decimal | null;
  monthlyAllowance: Prisma.Decimal | null;
};

function prepareWiba(
  wibaSection: WibaSectionInput | undefined
): ValidationError | null | { rows: PreparedWibaRow[]; wibaRate: Prisma.Decimal; calc: WibaResult } {
  if (!wibaSection) return null;

  const rawRows = wibaSection.wiba.payrollRows.filter(
    (r) =>
      !(
        !r.occupation?.trim() &&
        isBlank(r.employeeCount) &&
        isBlank(r.annualWages) &&
        isBlank(r.basicMonthlySalary) &&
        isBlank(r.monthlyAllowance)
      )
  );
  if (rawRows.length === 0) return { error: "WIBA_AT_LEAST_ONE_ROW" };

  const rows: PreparedWibaRow[] = [];
  for (const row of rawRows) {
    const occupation = row.occupation?.trim();
    if (!occupation) return { error: "WIBA_ROW_OCCUPATION_REQUIRED" };
    const employeeCount = parseRequiredNonNegativeInt(row.employeeCount, "WIBA_ROW_EMPLOYEE_COUNT_INVALID");
    if (isErr(employeeCount)) return employeeCount;

    // A row with either salary input filled in uses the Basic Monthly
    // Salary/Monthly Allowance formula (Basic Monthly Salary becomes
    // required, Allowance defaults to 0 left blank). A row with neither —
    // every pre-existing quotation, and any row nobody has touched yet —
    // keeps using its own annualWages value exactly as before.
    const hasSalaryInputs = !isBlank(row.basicMonthlySalary) || !isBlank(row.monthlyAllowance);

    let annualWages: Prisma.Decimal;
    let basicMonthlySalary: Prisma.Decimal | null = null;
    let monthlyAllowance: Prisma.Decimal | null = null;

    if (hasSalaryInputs) {
      const basic = parseRequiredNonNegative(row.basicMonthlySalary, "WIBA_ROW_BASIC_SALARY_INVALID");
      if (isErr(basic)) return basic;
      const allowance = parseOptionalNonNegative(row.monthlyAllowance, "WIBA_ROW_ALLOWANCE_INVALID");
      if (isErr(allowance)) return allowance;
      basicMonthlySalary = basic;
      monthlyAllowance = allowance;
      annualWages = roundMoney(
        basic.plus(allowance ?? toDecimal(0)).times(employeeCount).times(12)
      );
    } else {
      const wages = parseRequiredNonNegative(row.annualWages, "WIBA_ROW_WAGES_INVALID");
      if (isErr(wages)) return wages;
      annualWages = wages;
    }

    rows.push({ occupation, employeeCount, annualWages, basicMonthlySalary, monthlyAllowance });
  }

  const wibaRate = parseRequiredNonNegative(wibaSection.wiba.wibaRate, "WIBA_RATE_INVALID");
  if (isErr(wibaRate)) return wibaRate;

  const calc = calculateWiba({ payrollRows: rows, wibaRate });
  return { rows, wibaRate, calc };
}

function buildWibaSection(
  section: WibaSectionInput,
  insuranceType: InsuranceTypeModel,
  prepared: { rows: PreparedWibaRow[]; wibaRate: Prisma.Decimal; calc: WibaResult }
): SingleSectionResult {
  const totals: SectionTotals = {
    basePremium: prepared.calc.grossPremium,
    phcfAmount: prepared.calc.phcfAmount,
    itlAmount: prepared.calc.itlAmount,
    stampDutyAmount: prepared.calc.stampDutyAmount,
    sectionTotal: prepared.calc.totalPremium,
  };

  // resolvedAnnualWages (from calculateWiba, same order as prepared.rows) is
  // the value actually summed into the section totals — using it here
  // instead of row.annualWages keeps the coverage-item breakdown and the
  // persisted payroll row in exact agreement with the numbers WIBA's own
  // totals were computed from.
  const items: Prisma.QuotationCoverageItemCreateWithoutSectionInput[] = prepared.rows.map((row, index) => {
    const annualWages = prepared.calc.resolvedAnnualWages[index];
    return {
      insuredContent: row.occupation,
      sumInsured: annualWages,
      rate: prepared.wibaRate,
      calculationMethod: "PERCENTAGE",
      premium: annualWages.times(prepared.wibaRate).dividedBy(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      notes: `${row.employeeCount} employee(s)`,
      sortOrder: index,
    };
  });

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "WIBA", totals),
      items: { create: items },
      wibaDetail: {
        create: {
          wibaRate: prepared.wibaRate,
          totalEmployeeCount: prepared.calc.totalEmployeeCount,
          totalAnnualWages: prepared.calc.totalAnnualWages,
          grossPremium: prepared.calc.grossPremium,
          phcfAmount: prepared.calc.phcfAmount,
          itlAmount: prepared.calc.itlAmount,
          stampDutyAmount: prepared.calc.stampDutyAmount,
          totalPremium: prepared.calc.totalPremium,
          payrollRows: {
            create: prepared.rows.map((row, index) => ({
              occupation: row.occupation,
              employeeCount: row.employeeCount,
              annualWages: prepared.calc.resolvedAnnualWages[index],
              basicMonthlySalary: row.basicMonthlySalary,
              monthlyAllowance: row.monthlyAllowance,
              sortOrder: index,
            })),
          },
        },
      },
    },
    totals,
  };
}

function buildElSection(
  section: ElSectionInput,
  insuranceType: InsuranceTypeModel,
  wibaCalc: WibaResult
): SingleSectionResult {
  const calc = calculateEl(wibaCalc.grossPremium);
  const totals: SectionTotals = {
    basePremium: calc.grossPremium,
    phcfAmount: calc.phcfAmount,
    itlAmount: calc.itlAmount,
    stampDutyAmount: calc.stampDutyAmount,
    sectionTotal: calc.totalPremium,
  };

  const items: Prisma.QuotationCoverageItemCreateWithoutSectionInput[] = [
    {
      insuredContent: "Employer's Liability (25% of WIBA Gross Premium)",
      sumInsured: calc.linkedWibaGrossPremium,
      rate: toDecimal(25),
      calculationMethod: "PERCENTAGE",
      premium: calc.grossPremium,
      sortOrder: 0,
    },
  ];

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "EMPLOYERS_LIABILITY", totals),
      items: { create: items },
      elDetail: {
        create: {
          linkedWibaGrossPremium: calc.linkedWibaGrossPremium,
          grossPremium: calc.grossPremium,
          phcfAmount: calc.phcfAmount,
          itlAmount: calc.itlAmount,
          stampDutyAmount: calc.stampDutyAmount,
          totalPremium: calc.totalPremium,
        },
      },
    },
    totals,
  };
}

function buildCpmSection(
  section: CpmStandaloneSectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const cpm = section.cpm;

  const rawRows = cpm.equipmentRows.filter(
    (r) => !(!r.equipmentName?.trim() && isBlank(r.quantity) && isBlank(r.unitValue))
  );
  if (rawRows.length === 0) return { error: "CPM_AT_LEAST_ONE_ROW" };

  const rows: { equipmentName: string; quantity: number; unitValue: Prisma.Decimal }[] = [];
  for (const row of rawRows) {
    const equipmentName = row.equipmentName?.trim();
    if (!equipmentName) return { error: "CPM_ROW_NAME_REQUIRED" };
    const quantity = parseRequiredNonNegativeInt(row.quantity, "CPM_ROW_QUANTITY_INVALID");
    if (isErr(quantity)) return quantity;
    const unitValue = parseRequiredNonNegative(row.unitValue, "CPM_ROW_UNIT_VALUE_INVALID");
    if (isErr(unitValue)) return unitValue;
    rows.push({ equipmentName, quantity, unitValue });
  }

  const cpmRate = parseRequiredNonNegative(cpm.cpmRate, "CPM_RATE_INVALID");
  if (isErr(cpmRate)) return cpmRate;

  // PVT Loading Amount is never taken from the client — calculateCpmStandalone
  // always derives it from this section's own CPM Base Premium, so a
  // tampered or stale submitted amount can't affect what gets saved.
  let pvtLoadingRate: Prisma.Decimal | null = null;
  if (cpm.pvtLoadingEnabled) {
    const rate = parseOptionalNonNegative(cpm.pvtLoadingRate, "CPM_PVT_RATE_INVALID");
    if (isErr(rate)) return rate;
    pvtLoadingRate = rate;
  }

  const calc: CpmStandaloneResult = calculateCpmStandalone({
    equipmentRows: rows,
    cpmRate,
    pvtLoadingEnabled: cpm.pvtLoadingEnabled,
    pvtLoadingRate,
  });
  const totals: SectionTotals = {
    basePremium: calc.grossPremium,
    phcfAmount: calc.phcfAmount,
    itlAmount: calc.itlAmount,
    stampDutyAmount: calc.stampDutyAmount,
    sectionTotal: calc.totalPremium,
  };

  const items: Prisma.QuotationCoverageItemCreateWithoutSectionInput[] = rows.map((row, index) => {
    const totalValue = toDecimal(row.quantity).times(row.unitValue);
    return {
      insuredContent: row.equipmentName,
      sumInsured: totalValue,
      rate: cpmRate,
      calculationMethod: "PERCENTAGE",
      premium: totalValue.times(cpmRate).dividedBy(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      notes: `Qty ${row.quantity}`,
      sortOrder: index,
    };
  });
  if (cpm.pvtLoadingEnabled) {
    items.push({
      insuredContent: "PVT Loading",
      sumInsured: calc.pvtLoadingAmount,
      rate: calc.pvtLoadingRate,
      calculationMethod: "PERCENTAGE",
      premium: calc.pvtLoadingPremium,
      sortOrder: items.length,
    });
  }

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "CPM_STANDALONE", totals),
      items: { create: items },
      cpmDetail: {
        create: {
          cpmRate,
          pvtLoadingEnabled: cpm.pvtLoadingEnabled,
          pvtLoadingRate,
          pvtLoadingAmount: calc.pvtLoadingAmount,
          pvtLoadingPremium: calc.pvtLoadingPremium,
          totalSumInsured: calc.totalSumInsured,
          basicPremium: calc.basicPremium,
          grossPremium: calc.grossPremium,
          phcfAmount: calc.phcfAmount,
          itlAmount: calc.itlAmount,
          stampDutyAmount: calc.stampDutyAmount,
          totalPremium: calc.totalPremium,
          equipmentRows: {
            create: rows.map((row, index) => ({
              equipmentName: row.equipmentName,
              quantity: row.quantity,
              unitValue: row.unitValue,
              totalValue: row.quantity != null ? toDecimal(row.quantity).times(row.unitValue) : toDecimal(0),
              sortOrder: index,
            })),
          },
        },
      },
    },
    totals,
  };
}

function buildPublicLiabilitySection(
  section: PublicLiabilitySectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const pl = section.publicLiability;

  const anyOneYearLimit = parseRequiredNonNegative(pl.anyOneYearLimit, "PL_YEAR_LIMIT_REQUIRED");
  if (isErr(anyOneYearLimit)) return anyOneYearLimit;
  const rate = parseRequiredNonNegative(pl.rate, "PL_RATE_INVALID");
  if (isErr(rate)) return rate;
  const personLimit = parseOptionalNonNegative(pl.anyOnePersonLimit, "PL_LIMIT_INVALID");
  if (isErr(personLimit)) return personLimit;
  const occurrenceLimit = parseOptionalNonNegative(pl.anyOneOccurrenceLimit, "PL_LIMIT_INVALID");
  if (isErr(occurrenceLimit)) return occurrenceLimit;

  const calc = calculatePublicLiability({ anyOneYearLimit, rate });
  const totals: SectionTotals = {
    basePremium: calc.grossPremium,
    phcfAmount: calc.phcfAmount,
    itlAmount: calc.itlAmount,
    stampDutyAmount: calc.stampDutyAmount,
    sectionTotal: calc.totalPremium,
  };

  const items: Prisma.QuotationCoverageItemCreateWithoutSectionInput[] = [
    {
      insuredContent: "Public Liability Premium (Any One Year Limit basis)",
      sumInsured: anyOneYearLimit,
      rate,
      calculationMethod: "PERCENTAGE",
      premium: calc.grossPremium,
      sortOrder: 0,
    },
  ];

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "PUBLIC_LIABILITY", totals),
      items: { create: items },
      publicLiabilityDetail: {
        create: {
          anyOnePersonLimit: personLimit,
          anyOneOccurrenceLimit: occurrenceLimit,
          anyOneYearLimit,
          rate,
          grossPremium: calc.grossPremium,
          phcfAmount: calc.phcfAmount,
          itlAmount: calc.itlAmount,
          stampDutyAmount: calc.stampDutyAmount,
          totalPremium: calc.totalPremium,
        },
      },
    },
    totals,
  };
}

function buildFireSection(
  section: FireSectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const fire = section.fire;

  const propertyValue = parseRequiredNonNegative(fire.propertyValue, "FIRE_VALUE_INVALID");
  if (isErr(propertyValue)) return propertyValue;
  const rawMaterialValueParsed = parseOptionalNonNegative(fire.rawMaterialValue, "FIRE_VALUE_INVALID");
  if (isErr(rawMaterialValueParsed)) return rawMaterialValueParsed;
  const rawMaterialValue = rawMaterialValueParsed ?? toDecimal(0);
  const goodsInStockValueParsed = parseOptionalNonNegative(fire.goodsInStockValue, "FIRE_VALUE_INVALID");
  if (isErr(goodsInStockValueParsed)) return goodsInStockValueParsed;
  const goodsInStockValue = goodsInStockValueParsed ?? toDecimal(0);
  const rate = parseRequiredNonNegative(fire.rate, "FIRE_RATE_INVALID");
  if (isErr(rate)) return rate;

  const pvt = parsePvtLoading(
    fire.pvtLoadingEnabled,
    fire.pvtLoadingAmount,
    fire.pvtLoadingRate,
    "FIRE_PVT_AMOUNT_REQUIRED",
    "FIRE_PVT_RATE_INVALID"
  );
  if (isErr(pvt)) return pvt;

  // Earthquake/Flood Loading are fixed business rates (calculateFire
  // resolves them internally from constants), not something taken from the
  // client — a submitted rate value, if any, is ignored.
  const calc = calculateFire({
    propertyValue,
    rawMaterialValue,
    goodsInStockValue,
    rate,
    earthquakeLoadingEnabled: fire.earthquakeLoadingEnabled,
    floodLoadingEnabled: fire.floodLoadingEnabled,
    pvtLoadingEnabled: fire.pvtLoadingEnabled,
    pvtLoadingAmount: pvt.pvtLoadingAmount,
    pvtLoadingRate: pvt.pvtLoadingRate,
  });
  const totals: SectionTotals = {
    basePremium: calc.grossPremium,
    phcfAmount: calc.phcfAmount,
    itlAmount: calc.itlAmount,
    stampDutyAmount: calc.stampDutyAmount,
    sectionTotal: calc.totalPremium,
  };

  const items: Prisma.QuotationCoverageItemCreateWithoutSectionInput[] = [
    {
      insuredContent: "Fire Basic Premium",
      sumInsured: calc.totalSumInsured,
      rate,
      calculationMethod: "PERCENTAGE",
      premium: calc.basicPremium,
      sortOrder: 0,
    },
  ];
  if (fire.earthquakeLoadingEnabled) {
    items.push({
      insuredContent: "Earthquake Loading",
      sumInsured: calc.totalSumInsured,
      rate: calc.earthquakeLoadingRate,
      calculationMethod: "PERCENTAGE",
      premium: calc.earthquakeLoadingAmount,
      sortOrder: items.length,
    });
  }
  if (fire.floodLoadingEnabled) {
    items.push({
      insuredContent: "Flood Loading",
      sumInsured: calc.totalSumInsured,
      rate: calc.floodLoadingRate,
      calculationMethod: "PERCENTAGE",
      premium: calc.floodLoadingAmount,
      sortOrder: items.length,
    });
  }
  if (fire.pvtLoadingEnabled) {
    items.push({
      insuredContent: "PVT Loading",
      sumInsured: calc.pvtLoadingAmount,
      rate: calc.pvtLoadingRate,
      calculationMethod: "PERCENTAGE",
      premium: calc.pvtLoadingPremium,
      sortOrder: items.length,
    });
  }

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "FIRE_AND_PERILS", totals),
      items: { create: items },
      fireDetail: {
        create: {
          propertyValue,
          rawMaterialValue,
          goodsInStockValue,
          rate,
          earthquakeLoadingRate: calc.earthquakeLoadingRate,
          floodLoadingRate: calc.floodLoadingRate,
          earthquakeLoadingEnabled: fire.earthquakeLoadingEnabled,
          floodLoadingEnabled: fire.floodLoadingEnabled,
          pvtLoadingEnabled: fire.pvtLoadingEnabled,
          pvtLoadingRate: pvt.pvtLoadingRate,
          pvtLoadingAmount: pvt.pvtLoadingAmount,
          pvtLoadingPremium: calc.pvtLoadingPremium,
          totalSumInsured: calc.totalSumInsured,
          basicPremium: calc.basicPremium,
          earthquakeLoadingAmount: calc.earthquakeLoadingAmount,
          floodLoadingAmount: calc.floodLoadingAmount,
          grossPremium: calc.grossPremium,
          phcfAmount: calc.phcfAmount,
          itlAmount: calc.itlAmount,
          stampDutyAmount: calc.stampDutyAmount,
          totalPremium: calc.totalPremium,
        },
      },
    },
    totals,
  };
}

function buildBurglarySection(
  section: BurglarySectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const burglary = section.burglary;

  const equipmentValueParsed = parseOptionalNonNegative(burglary.equipmentValue, "BURGLARY_VALUE_INVALID");
  if (isErr(equipmentValueParsed)) return equipmentValueParsed;
  const equipmentValue = equipmentValueParsed ?? toDecimal(0);
  const stockValueParsed = parseOptionalNonNegative(burglary.stockValue, "BURGLARY_VALUE_INVALID");
  if (isErr(stockValueParsed)) return stockValueParsed;
  const stockValue = stockValueParsed ?? toDecimal(0);
  const firstLossPercentage = parseRequiredNonNegative(burglary.firstLossPercentage, "BURGLARY_PERCENTAGE_INVALID");
  if (isErr(firstLossPercentage)) return firstLossPercentage;
  const rate = parseRequiredNonNegative(burglary.rate, "BURGLARY_RATE_INVALID");
  if (isErr(rate)) return rate;

  const calc = calculateBurglary({ equipmentValue, stockValue, firstLossPercentage, rate });
  const totals: SectionTotals = {
    basePremium: calc.grossPremium,
    phcfAmount: calc.phcfAmount,
    itlAmount: calc.itlAmount,
    stampDutyAmount: calc.stampDutyAmount,
    sectionTotal: calc.totalPremium,
  };

  const items: Prisma.QuotationCoverageItemCreateWithoutSectionInput[] = [
    {
      insuredContent: "Burglary Premium (First Loss Sum Insured basis)",
      sumInsured: calc.firstLossSumInsured,
      rate,
      calculationMethod: "PERCENTAGE",
      premium: calc.grossPremium,
      notes: `First loss ${firstLossPercentage.toString()}% of ${calc.totalValue.toString()}`,
      sortOrder: 0,
    },
  ];

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "BURGLARY", totals),
      items: { create: items },
      burglaryDetail: {
        create: {
          equipmentValue,
          stockValue,
          firstLossPercentage,
          rate,
          totalValue: calc.totalValue,
          firstLossSumInsured: calc.firstLossSumInsured,
          grossPremium: calc.grossPremium,
          phcfAmount: calc.phcfAmount,
          itlAmount: calc.itlAmount,
          stampDutyAmount: calc.stampDutyAmount,
          totalPremium: calc.totalPremium,
        },
      },
    },
    totals,
  };
}

function buildGitSingleSection(
  section: GitSingleSectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const git = section.gitSingle;

  const cargoDescription = git.cargoDescription?.trim();
  if (!cargoDescription) return { error: "GIT_CARGO_DESCRIPTION_REQUIRED" };
  const sumInsured = parseRequiredNonNegative(git.sumInsured, "GIT_SUM_INSURED_INVALID");
  if (isErr(sumInsured)) return sumInsured;
  const rate = parseRequiredNonNegative(git.rate, "GIT_RATE_INVALID");
  if (isErr(rate)) return rate;

  const pvt = parsePvtLoading(
    git.pvtLoadingEnabled,
    git.pvtLoadingAmount,
    git.pvtLoadingRate,
    "GIT_PVT_AMOUNT_REQUIRED",
    "GIT_PVT_RATE_INVALID"
  );
  if (isErr(pvt)) return pvt;

  const calc = calculateGitSingle({
    sumInsured,
    rate,
    pvtLoadingEnabled: git.pvtLoadingEnabled,
    pvtLoadingAmount: pvt.pvtLoadingAmount,
    pvtLoadingRate: pvt.pvtLoadingRate,
  });
  const totals: SectionTotals = {
    basePremium: calc.grossPremium,
    phcfAmount: calc.phcfAmount,
    itlAmount: calc.itlAmount,
    stampDutyAmount: calc.stampDutyAmount,
    sectionTotal: calc.totalPremium,
  };

  const items: Prisma.QuotationCoverageItemCreateWithoutSectionInput[] = [
    {
      insuredContent: `Goods in Transit Premium — ${cargoDescription}`,
      sumInsured,
      rate,
      calculationMethod: "PERCENTAGE",
      premium: calc.basicPremium,
      sortOrder: 0,
    },
  ];
  if (git.pvtLoadingEnabled) {
    items.push({
      insuredContent: "PVT Loading",
      sumInsured: calc.pvtLoadingAmount,
      rate: calc.pvtLoadingRate,
      calculationMethod: "PERCENTAGE",
      premium: calc.pvtLoadingPremium,
      sortOrder: items.length,
    });
  }

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "GIT_SINGLE", totals),
      items: { create: items },
      gitSingleDetail: {
        create: {
          cargoDescription,
          route: git.route?.trim() || null,
          sumInsured,
          rate,
          pvtLoadingEnabled: git.pvtLoadingEnabled,
          pvtLoadingRate: pvt.pvtLoadingRate,
          pvtLoadingAmount: pvt.pvtLoadingAmount,
          pvtLoadingPremium: calc.pvtLoadingPremium,
          basicPremium: calc.basicPremium,
          grossPremium: calc.grossPremium,
          phcfAmount: calc.phcfAmount,
          itlAmount: calc.itlAmount,
          stampDutyAmount: calc.stampDutyAmount,
          totalPremium: calc.totalPremium,
        },
      },
    },
    totals,
  };
}

function buildGitAnnualSection(
  section: GitAnnualSectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const git = section.gitAnnual;

  const cargoDescription = git.cargoDescription?.trim();
  if (!cargoDescription) return { error: "GIT_CARGO_DESCRIPTION_REQUIRED" };
  const singleLimit = parseRequiredNonNegative(git.singleLimit, "GIT_ANNUAL_LIMIT_INVALID");
  if (isErr(singleLimit)) return singleLimit;
  const yearLimit = parseRequiredNonNegative(git.yearLimit, "GIT_ANNUAL_LIMIT_INVALID");
  if (isErr(yearLimit)) return yearLimit;
  const singleLimitRate = parseRequiredNonNegative(git.singleLimitRate, "GIT_ANNUAL_RATE_INVALID");
  if (isErr(singleLimitRate)) return singleLimitRate;
  const yearLimitRate = parseRequiredNonNegative(git.yearLimitRate, "GIT_ANNUAL_RATE_INVALID");
  if (isErr(yearLimitRate)) return yearLimitRate;

  const pvt = parsePvtLoading(
    git.pvtLoadingEnabled,
    git.pvtLoadingAmount,
    git.pvtLoadingRate,
    "GIT_PVT_AMOUNT_REQUIRED",
    "GIT_PVT_RATE_INVALID"
  );
  if (isErr(pvt)) return pvt;

  const calc = calculateGitAnnual({
    singleLimit,
    yearLimit,
    singleLimitRate,
    yearLimitRate,
    pvtLoadingEnabled: git.pvtLoadingEnabled,
    pvtLoadingAmount: pvt.pvtLoadingAmount,
    pvtLoadingRate: pvt.pvtLoadingRate,
  });
  const totals: SectionTotals = {
    basePremium: calc.grossPremium,
    phcfAmount: calc.phcfAmount,
    itlAmount: calc.itlAmount,
    stampDutyAmount: calc.stampDutyAmount,
    sectionTotal: calc.totalPremium,
  };

  const items: Prisma.QuotationCoverageItemCreateWithoutSectionInput[] = [
    {
      insuredContent: `GIT Any One Consignment Premium — ${cargoDescription}`,
      sumInsured: singleLimit,
      rate: singleLimitRate,
      calculationMethod: "PERCENTAGE",
      premium: calc.singlePremium,
      sortOrder: 0,
    },
    {
      insuredContent: `GIT Any One Year Premium — ${cargoDescription}`,
      sumInsured: yearLimit,
      rate: yearLimitRate,
      calculationMethod: "PERCENTAGE",
      premium: calc.yearPremium,
      sortOrder: 1,
    },
  ];
  if (git.pvtLoadingEnabled) {
    items.push({
      insuredContent: "PVT Loading",
      sumInsured: calc.pvtLoadingAmount,
      rate: calc.pvtLoadingRate,
      calculationMethod: "PERCENTAGE",
      premium: calc.pvtLoadingPremium,
      sortOrder: items.length,
    });
  }

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "GIT_ANNUAL", totals),
      items: { create: items },
      gitAnnualDetail: {
        create: {
          cargoDescription,
          singleLimit,
          yearLimit,
          singleLimitRate,
          yearLimitRate,
          pvtLoadingEnabled: git.pvtLoadingEnabled,
          pvtLoadingRate: pvt.pvtLoadingRate,
          pvtLoadingAmount: pvt.pvtLoadingAmount,
          pvtLoadingPremium: calc.pvtLoadingPremium,
          singlePremium: calc.singlePremium,
          yearPremium: calc.yearPremium,
          grossPremium: calc.grossPremium,
          phcfAmount: calc.phcfAmount,
          itlAmount: calc.itlAmount,
          stampDutyAmount: calc.stampDutyAmount,
          totalPremium: calc.totalPremium,
        },
      },
    },
    totals,
  };
}

function buildMarineSection(
  section: MarineSectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const marine = section.marine;

  const rawRows = marine.shipmentRows.filter(
    (r) => !(!r.referenceNo?.trim() && isBlank(r.sumInsured) && isBlank(r.rate))
  );
  if (rawRows.length === 0) return { error: "MARINE_AT_LEAST_ONE_ROW" };

  const rows: { referenceNo: string | null; sumInsured: Prisma.Decimal; rate: Prisma.Decimal }[] = [];
  for (const row of rawRows) {
    const sumInsured = parseRequiredNonNegative(row.sumInsured, "MARINE_ROW_SUM_INSURED_INVALID");
    if (isErr(sumInsured)) return sumInsured;
    const rate = parseRequiredNonNegative(row.rate, "MARINE_ROW_RATE_INVALID");
    if (isErr(rate)) return rate;
    rows.push({ referenceNo: row.referenceNo?.trim() || null, sumInsured, rate });
  }

  const calc = calculateMarine({ shipmentRows: rows });
  const totals: SectionTotals = {
    basePremium: calc.grossPremium,
    phcfAmount: calc.phcfAmount,
    itlAmount: calc.itlAmount,
    stampDutyAmount: calc.marineStampDutyAmount,
    sectionTotal: calc.totalPremium,
  };

  const items: Prisma.QuotationCoverageItemCreateWithoutSectionInput[] = calc.rows.map((row, index) => ({
    insuredContent: rows[index].referenceNo ?? `Shipment ${index + 1}`,
    sumInsured: row.sumInsured,
    rate: row.rate,
    calculationMethod: "PERCENTAGE",
    premium: row.linePremium,
    sortOrder: index,
  }));

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "MARINE_COVER", totals),
      items: { create: items },
      marineDetail: {
        create: {
          cargoDescription: marine.cargoDescription?.trim() || null,
          origin: marine.origin?.trim() || null,
          destination: marine.destination?.trim() || null,
          marineStampDutyRate: calc.marineStampDutyRate,
          totalSumInsured: calc.totalSumInsured,
          grossPremium: calc.grossPremium,
          phcfAmount: calc.phcfAmount,
          itlAmount: calc.itlAmount,
          marineStampDutyAmount: calc.marineStampDutyAmount,
          totalPremium: calc.totalPremium,
          shipmentRows: {
            create: rows.map((row, index) => ({
              referenceNo: row.referenceNo,
              sumInsured: row.sumInsured,
              rate: row.rate,
              linePremium: calc.rows[index].linePremium,
              sortOrder: index,
            })),
          },
        },
      },
    },
    totals,
  };
}

// --- Motor Comprehensive (Private & Commercial share this validator) -----

type MotorComprehensiveCore = {
  plateNo: string;
  vehicleValue: Prisma.Decimal;
  periodFrom: Date;
  periodTo: Date;
  excessProtector: string | null;
  pvt: string | null;
  rate: Prisma.Decimal;
  calc: MotorComprehensiveResult;
};

function validateMotorComprehensive(motor: MotorComprehensiveFields): ValidationError | MotorComprehensiveCore {
  const plateNo = motor.plateNo?.trim();
  if (!plateNo) return { error: "MOTOR_PLATE_NO_REQUIRED" };
  const vehicleValue = parseRequiredNonNegative(motor.vehicleValue, "MOTOR_VEHICLE_VALUE_INVALID");
  if (isErr(vehicleValue)) return vehicleValue;
  const rate = parseRequiredNonNegative(motor.rate, "MOTOR_RATE_INVALID");
  if (isErr(rate)) return rate;
  if (!motor.periodFrom || !motor.periodTo) return { error: "MOTOR_PERIOD_REQUIRED" };
  const periodFrom = new Date(motor.periodFrom);
  const periodTo = new Date(motor.periodTo);
  if (Number.isNaN(periodFrom.getTime()) || Number.isNaN(periodTo.getTime())) {
    return { error: "MOTOR_PERIOD_REQUIRED" };
  }
  if (periodTo < periodFrom) return { error: "MOTOR_PERIOD_INVALID" };

  const calc = calculateMotorComprehensive({ vehicleValue, rate });

  return {
    plateNo,
    vehicleValue,
    periodFrom,
    periodTo,
    excessProtector: motor.excessProtector?.trim() || null,
    pvt: motor.pvt?.trim() || null,
    rate,
    calc,
  };
}

function motorComprehensiveMirrorItems(
  core: MotorComprehensiveCore
): Prisma.QuotationCoverageItemCreateWithoutSectionInput[] {
  return [
    {
      insuredContent: `Motor Premium — ${core.plateNo}`,
      sumInsured: core.vehicleValue,
      rate: core.rate,
      calculationMethod: "PERCENTAGE",
      premium: core.calc.grossPremium,
      sortOrder: 0,
    },
  ];
}

function buildMotorCompPrivateSection(
  section: MotorCompPrivateSectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const core = validateMotorComprehensive(section.motor);
  if (isErr(core)) return core;
  const totals: SectionTotals = {
    basePremium: core.calc.grossPremium,
    phcfAmount: core.calc.phcfAmount,
    itlAmount: core.calc.itlAmount,
    stampDutyAmount: core.calc.stampDutyAmount,
    sectionTotal: core.calc.totalPremium,
  };

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "MOTOR_COMP_PRIVATE", totals),
      items: { create: motorComprehensiveMirrorItems(core) },
      motorCompPrivateDetail: {
        create: {
          plateNo: core.plateNo,
          vehicleValue: core.vehicleValue,
          periodFrom: core.periodFrom,
          periodTo: core.periodTo,
          excessProtector: core.excessProtector,
          pvt: core.pvt,
          rate: core.rate,
          grossPremium: core.calc.grossPremium,
          phcfAmount: core.calc.phcfAmount,
          itlAmount: core.calc.itlAmount,
          stampDutyAmount: core.calc.stampDutyAmount,
          totalPremium: core.calc.totalPremium,
        },
      },
    },
    totals,
  };
}

function buildMotorCompCommercialSection(
  section: MotorCompCommercialSectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const core = validateMotorComprehensive(section.motor);
  if (isErr(core)) return core;
  const totals: SectionTotals = {
    basePremium: core.calc.grossPremium,
    phcfAmount: core.calc.phcfAmount,
    itlAmount: core.calc.itlAmount,
    stampDutyAmount: core.calc.stampDutyAmount,
    sectionTotal: core.calc.totalPremium,
  };

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "MOTOR_COMP_COMMERCIAL", totals),
      items: { create: motorComprehensiveMirrorItems(core) },
      motorCompCommercialDetail: {
        create: {
          plateNo: core.plateNo,
          vehicleValue: core.vehicleValue,
          periodFrom: core.periodFrom,
          periodTo: core.periodTo,
          excessProtector: core.excessProtector,
          pvt: core.pvt,
          rate: core.rate,
          grossPremium: core.calc.grossPremium,
          phcfAmount: core.calc.phcfAmount,
          itlAmount: core.calc.itlAmount,
          stampDutyAmount: core.calc.stampDutyAmount,
          totalPremium: core.calc.totalPremium,
        },
      },
    },
    totals,
  };
}

// --- Motor TPO (Private & Commercial share this validator) ---------------

type MotorTpoCore = {
  plateNo: string;
  loadingCapacity: Prisma.Decimal;
  basePremium: Prisma.Decimal;
  periodFrom: Date;
  periodTo: Date;
  calc: MotorTpoResult;
};

function validateMotorTpo(motor: MotorTpoFields): ValidationError | MotorTpoCore {
  const plateNo = motor.plateNo?.trim();
  if (!plateNo) return { error: "MOTOR_PLATE_NO_REQUIRED" };
  const loadingCapacityParsed = parseOptionalNonNegative(motor.loadingCapacity, "MOTOR_LOADING_CAPACITY_INVALID");
  if (isErr(loadingCapacityParsed)) return loadingCapacityParsed;
  const loadingCapacity = loadingCapacityParsed ?? toDecimal(0);
  const basePremium = parseRequiredNonNegative(motor.basePremium, "MOTOR_BASE_PREMIUM_INVALID");
  if (isErr(basePremium)) return basePremium;
  if (!motor.periodFrom || !motor.periodTo) return { error: "MOTOR_PERIOD_REQUIRED" };
  const periodFrom = new Date(motor.periodFrom);
  const periodTo = new Date(motor.periodTo);
  if (Number.isNaN(periodFrom.getTime()) || Number.isNaN(periodTo.getTime())) {
    return { error: "MOTOR_PERIOD_REQUIRED" };
  }
  if (periodTo < periodFrom) return { error: "MOTOR_PERIOD_INVALID" };

  const calc = calculateMotorTpo({ basePremium });

  return { plateNo, loadingCapacity, basePremium, periodFrom, periodTo, calc };
}

function motorTpoMirrorItems(core: MotorTpoCore): Prisma.QuotationCoverageItemCreateWithoutSectionInput[] {
  return [
    {
      insuredContent: `Motor TPO Premium — ${core.plateNo}`,
      sumInsured: null,
      rate: null,
      calculationMethod: "MANUAL_PREMIUM",
      premium: core.calc.grossPremium,
      sortOrder: 0,
    },
  ];
}

function buildMotorTpoPrivateSection(
  section: MotorTpoPrivateSectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const core = validateMotorTpo(section.motor);
  if (isErr(core)) return core;
  const totals: SectionTotals = {
    basePremium: core.calc.grossPremium,
    phcfAmount: core.calc.phcfAmount,
    itlAmount: core.calc.itlAmount,
    stampDutyAmount: core.calc.stampDutyAmount,
    sectionTotal: core.calc.totalPremium,
  };

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "MOTOR_TPO_PRIVATE", totals),
      items: { create: motorTpoMirrorItems(core) },
      motorTpoPrivateDetail: {
        create: {
          plateNo: core.plateNo,
          basePremium: core.basePremium,
          periodFrom: core.periodFrom,
          periodTo: core.periodTo,
          grossPremium: core.calc.grossPremium,
          phcfAmount: core.calc.phcfAmount,
          itlAmount: core.calc.itlAmount,
          stampDutyAmount: core.calc.stampDutyAmount,
          totalPremium: core.calc.totalPremium,
        },
      },
    },
    totals,
  };
}

function buildMotorTpoCommercialSection(
  section: MotorTpoCommercialSectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const core = validateMotorTpo(section.motor);
  if (isErr(core)) return core;
  const totals: SectionTotals = {
    basePremium: core.calc.grossPremium,
    phcfAmount: core.calc.phcfAmount,
    itlAmount: core.calc.itlAmount,
    stampDutyAmount: core.calc.stampDutyAmount,
    sectionTotal: core.calc.totalPremium,
  };

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "MOTOR_TPO_COMMERCIAL", totals),
      items: { create: motorTpoMirrorItems(core) },
      motorTpoCommercialDetail: {
        create: {
          plateNo: core.plateNo,
          loadingCapacity: core.loadingCapacity,
          basePremium: core.basePremium,
          periodFrom: core.periodFrom,
          periodTo: core.periodTo,
          grossPremium: core.calc.grossPremium,
          phcfAmount: core.calc.phcfAmount,
          itlAmount: core.calc.itlAmount,
          stampDutyAmount: core.calc.stampDutyAmount,
          totalPremium: core.calc.totalPremium,
        },
      },
    },
    totals,
  };
}

// --- Group Personal Accident ----------------------------------------------

function buildGpaSection(section: GpaSectionInput, insuranceType: InsuranceTypeModel): SingleSectionResult {
  const gpa = section.gpa;

  const deathLimitParsed = parseOptionalNonNegative(gpa.deathLimit, "GPA_LIMIT_INVALID");
  if (isErr(deathLimitParsed)) return deathLimitParsed;
  const deathLimit = deathLimitParsed ?? toDecimal(0);
  const ptdLimitParsed = parseOptionalNonNegative(gpa.ptdLimit, "GPA_LIMIT_INVALID");
  if (isErr(ptdLimitParsed)) return ptdLimitParsed;
  const ptdLimit = ptdLimitParsed ?? toDecimal(0);
  const ttdLimitParsed = parseOptionalNonNegative(gpa.ttdLimit, "GPA_LIMIT_INVALID");
  if (isErr(ttdLimitParsed)) return ttdLimitParsed;
  const ttdLimit = ttdLimitParsed ?? toDecimal(0);
  const medicalLimitParsed = parseOptionalNonNegative(gpa.medicalLimit, "GPA_LIMIT_INVALID");
  if (isErr(medicalLimitParsed)) return medicalLimitParsed;
  const medicalLimit = medicalLimitParsed ?? toDecimal(0);
  const funeralLimitParsed = parseOptionalNonNegative(gpa.funeralLimit, "GPA_LIMIT_INVALID");
  if (isErr(funeralLimitParsed)) return funeralLimitParsed;
  const funeralLimit = funeralLimitParsed ?? toDecimal(0);

  const deathRateParsed = parseOptionalNonNegative(gpa.deathRate, "GPA_RATE_INVALID");
  if (isErr(deathRateParsed)) return deathRateParsed;
  const deathRate = deathRateParsed ?? toDecimal(0);
  const ptdRateParsed = parseOptionalNonNegative(gpa.ptdRate, "GPA_RATE_INVALID");
  if (isErr(ptdRateParsed)) return ptdRateParsed;
  const ptdRate = ptdRateParsed ?? toDecimal(0);
  const ttdRateParsed = parseOptionalNonNegative(gpa.ttdRate, "GPA_RATE_INVALID");
  if (isErr(ttdRateParsed)) return ttdRateParsed;
  const ttdRate = ttdRateParsed ?? toDecimal(0);
  const medicalRateParsed = parseOptionalNonNegative(gpa.medicalRate, "GPA_RATE_INVALID");
  if (isErr(medicalRateParsed)) return medicalRateParsed;
  const medicalRate = medicalRateParsed ?? toDecimal(0);
  const funeralRateParsed = parseOptionalNonNegative(gpa.funeralRate, "GPA_RATE_INVALID");
  if (isErr(funeralRateParsed)) return funeralRateParsed;
  const funeralRate = funeralRateParsed ?? toDecimal(0);

  const numberOfPeople = parseRequiredNonNegativeInt(gpa.numberOfPeople, "GPA_NUMBER_OF_PEOPLE_INVALID");
  if (isErr(numberOfPeople)) return numberOfPeople;

  const calc = calculateGpa({
    deathLimit,
    ptdLimit,
    ttdLimit,
    medicalLimit,
    funeralLimit,
    deathRate,
    ptdRate,
    ttdRate,
    medicalRate,
    funeralRate,
    numberOfPeople,
  });
  const totals: SectionTotals = {
    basePremium: calc.grossPremium,
    phcfAmount: calc.phcfAmount,
    itlAmount: calc.itlAmount,
    stampDutyAmount: calc.stampDutyAmount,
    sectionTotal: calc.totalPremium,
  };

  const items: Prisma.QuotationCoverageItemCreateWithoutSectionInput[] = [
    { insuredContent: "Death Benefit", sumInsured: deathLimit, rate: deathRate, calculationMethod: "PERCENTAGE", premium: calc.deathPremium, sortOrder: 0 },
    { insuredContent: "Permanent Total Disability Benefit", sumInsured: ptdLimit, rate: ptdRate, calculationMethod: "PERCENTAGE", premium: calc.ptdPremium, sortOrder: 1 },
    { insuredContent: "Temporary Total Disability Benefit", sumInsured: ttdLimit, rate: ttdRate, calculationMethod: "PERCENTAGE", premium: calc.ttdPremium, sortOrder: 2 },
    { insuredContent: "Medical Expenses Benefit", sumInsured: medicalLimit, rate: medicalRate, calculationMethod: "PERCENTAGE", premium: calc.medicalPremium, sortOrder: 3 },
    { insuredContent: "Funeral Expenses Benefit", sumInsured: funeralLimit, rate: funeralRate, calculationMethod: "PERCENTAGE", premium: calc.funeralPremium, sortOrder: 4 },
  ];

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "GROUP_PERSONAL_ACCIDENT", totals),
      items: { create: items },
      gpaDetail: {
        create: {
          deathLimit,
          ptdLimit,
          ttdLimit,
          medicalLimit,
          funeralLimit,
          deathRate,
          ptdRate,
          ttdRate,
          medicalRate,
          funeralRate,
          numberOfPeople,
          deathPremium: calc.deathPremium,
          ptdPremium: calc.ptdPremium,
          ttdPremium: calc.ttdPremium,
          medicalPremium: calc.medicalPremium,
          funeralPremium: calc.funeralPremium,
          premiumPerPerson: calc.premiumPerPerson,
          grossPremium: calc.grossPremium,
          phcfAmount: calc.phcfAmount,
          itlAmount: calc.itlAmount,
          stampDutyAmount: calc.stampDutyAmount,
          totalPremium: calc.totalPremium,
        },
      },
    },
    totals,
  };
}

// --- Group Medical Insurance ----------------------------------------------

function medicalCategoryLabel(category: MedicalFamilyCategory): string {
  return category === "M" ? "M" : category.replace("M_PLUS_", "M+");
}

function buildMedicalSection(
  section: MedicalSectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const medical = section.medical;

  const inpatientLimitParsed = parseOptionalNonNegative(medical.inpatientLimit, "MEDICAL_LIMIT_INVALID");
  if (isErr(inpatientLimitParsed)) return inpatientLimitParsed;
  const inpatientLimit = inpatientLimitParsed ?? toDecimal(0);
  const outpatientLimitParsed = parseOptionalNonNegative(medical.outpatientLimit, "MEDICAL_LIMIT_INVALID");
  if (isErr(outpatientLimitParsed)) return outpatientLimitParsed;
  const outpatientLimit = outpatientLimitParsed ?? toDecimal(0);

  const rowByCategory = new Map(medical.categoryRows.map((r) => [r.category, r]));
  const rows: {
    category: MedicalFamilyCategory;
    employeeCount: number;
    inpatientRate: Prisma.Decimal;
    outpatientRate: Prisma.Decimal;
  }[] = [];
  for (const category of MEDICAL_FAMILY_CATEGORIES) {
    const raw = rowByCategory.get(category);
    const employeeCount = parseOptionalNonNegativeInt(raw?.employeeCount, "MEDICAL_COUNT_INVALID");
    if (isErr(employeeCount)) return employeeCount;
    const inpatientRateParsed = parseOptionalNonNegative(raw?.inpatientRate, "MEDICAL_RATE_INVALID");
    if (isErr(inpatientRateParsed)) return inpatientRateParsed;
    const outpatientRateParsed = parseOptionalNonNegative(raw?.outpatientRate, "MEDICAL_RATE_INVALID");
    if (isErr(outpatientRateParsed)) return outpatientRateParsed;
    rows.push({
      category,
      employeeCount,
      inpatientRate: inpatientRateParsed ?? toDecimal(0),
      outpatientRate: outpatientRateParsed ?? toDecimal(0),
    });
  }

  if (!rows.some((r) => r.employeeCount > 0)) return { error: "MEDICAL_AT_LEAST_ONE_POSITIVE_COUNT" };

  const calc = calculateMedical({ categoryRows: rows });
  const totals: SectionTotals = {
    basePremium: calc.grossPremium,
    phcfAmount: calc.phcfAmount,
    itlAmount: calc.itlAmount,
    stampDutyAmount: calc.stampDutyAmount,
    sectionTotal: calc.totalPremium,
  };

  const items: Prisma.QuotationCoverageItemCreateWithoutSectionInput[] = rows
    .map((row, index) => ({ row, index, calcRow: calc.rows[index] }))
    .filter(({ row }) => row.employeeCount > 0)
    .map(({ row, calcRow }, i) => ({
      insuredContent: `${medicalCategoryLabel(row.category)} — Inpatient/Outpatient`,
      sumInsured: null,
      rate: null,
      calculationMethod: "MANUAL_PREMIUM" as const,
      premium: calcRow.inpatientAmount.plus(calcRow.outpatientAmount),
      notes: `${row.employeeCount} employee(s)`,
      sortOrder: i,
    }));

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "GROUP_MEDICAL", totals),
      items: { create: items },
      medicalDetail: {
        create: {
          inpatientLimit,
          outpatientLimit,
          employeeCount: calc.employeeCount,
          inpatientPremium: calc.inpatientPremium,
          outpatientPremium: calc.outpatientPremium,
          subtotal: calc.subtotal,
          grossPremium: calc.grossPremium,
          phcfAmount: calc.phcfAmount,
          itlAmount: calc.itlAmount,
          stampDutyAmount: calc.stampDutyAmount,
          totalPremium: calc.totalPremium,
          categoryRows: {
            create: rows.map((row, index) => ({
              category: row.category,
              employeeCount: row.employeeCount,
              inpatientRate: row.inpatientRate,
              outpatientRate: row.outpatientRate,
              inpatientAmount: calc.rows[index].inpatientAmount,
              outpatientAmount: calc.rows[index].outpatientAmount,
              sortOrder: index,
            })),
          },
        },
      },
    },
    totals,
  };
}

// --- Guarantee family: Tender Security / Performance Bond / APG ----------
// Identical formula, validated once, wired to three separate Prisma models
// so a quotation can hold all three at once.

type GuaranteeCore = {
  projectName: string;
  bondValue: Prisma.Decimal;
  rate: Prisma.Decimal;
  calc: GuaranteeResult;
};

function validateGuarantee(guarantee: GuaranteeFields, errorPrefix: string): ValidationError | GuaranteeCore {
  const projectName = guarantee.projectName?.trim();
  if (!projectName) return { error: `${errorPrefix}_PROJECT_NAME_REQUIRED` };
  const bondValue = parseRequiredNonNegative(guarantee.bondValue, `${errorPrefix}_VALUE_INVALID`);
  if (isErr(bondValue)) return bondValue;
  const rate = parseRequiredNonNegative(guarantee.rate, `${errorPrefix}_RATE_INVALID`);
  if (isErr(rate)) return rate;

  const calc = calculateGuarantee({ bondValue, rate });
  return { projectName, bondValue, rate, calc };
}

function guaranteeMirrorItems(
  core: GuaranteeCore,
  label: string
): Prisma.QuotationCoverageItemCreateWithoutSectionInput[] {
  return [
    {
      insuredContent: `${label} — ${core.projectName}`,
      sumInsured: core.bondValue,
      rate: core.rate,
      calculationMethod: "PERCENTAGE",
      premium: core.calc.grossPremium,
      sortOrder: 0,
    },
  ];
}

function buildTenderSecuritySection(
  section: TenderSecuritySectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const core = validateGuarantee(section.guarantee, "TENDER_SECURITY");
  if (isErr(core)) return core;
  const totals: SectionTotals = {
    basePremium: core.calc.grossPremium,
    phcfAmount: core.calc.phcfAmount,
    itlAmount: core.calc.itlAmount,
    stampDutyAmount: core.calc.stampDutyAmount,
    sectionTotal: core.calc.totalPremium,
  };

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "TENDER_SECURITY", totals),
      items: { create: guaranteeMirrorItems(core, "Tender Security Premium") },
      tenderSecurityDetail: {
        create: {
          projectName: core.projectName,
          bondValue: core.bondValue,
          rate: core.rate,
          grossPremium: core.calc.grossPremium,
          phcfAmount: core.calc.phcfAmount,
          itlAmount: core.calc.itlAmount,
          stampDutyAmount: core.calc.stampDutyAmount,
          totalPremium: core.calc.totalPremium,
        },
      },
    },
    totals,
  };
}

function buildPerformanceBondSection(
  section: PerformanceBondSectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const core = validateGuarantee(section.guarantee, "PERFORMANCE_BOND");
  if (isErr(core)) return core;
  const totals: SectionTotals = {
    basePremium: core.calc.grossPremium,
    phcfAmount: core.calc.phcfAmount,
    itlAmount: core.calc.itlAmount,
    stampDutyAmount: core.calc.stampDutyAmount,
    sectionTotal: core.calc.totalPremium,
  };

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "PERFORMANCE_BOND", totals),
      items: { create: guaranteeMirrorItems(core, "Performance Bond Premium") },
      performanceBondDetail: {
        create: {
          projectName: core.projectName,
          bondValue: core.bondValue,
          rate: core.rate,
          grossPremium: core.calc.grossPremium,
          phcfAmount: core.calc.phcfAmount,
          itlAmount: core.calc.itlAmount,
          stampDutyAmount: core.calc.stampDutyAmount,
          totalPremium: core.calc.totalPremium,
        },
      },
    },
    totals,
  };
}

function buildAdvancePaymentGuaranteeSection(
  section: AdvancePaymentGuaranteeSectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const core = validateGuarantee(section.guarantee, "APG");
  if (isErr(core)) return core;
  const totals: SectionTotals = {
    basePremium: core.calc.grossPremium,
    phcfAmount: core.calc.phcfAmount,
    itlAmount: core.calc.itlAmount,
    stampDutyAmount: core.calc.stampDutyAmount,
    sectionTotal: core.calc.totalPremium,
  };

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "ADVANCE_PAYMENT_GUARANTEE", totals),
      items: { create: guaranteeMirrorItems(core, "Advance Payment Guarantee Premium") },
      advancePaymentGuaranteeDetail: {
        create: {
          projectName: core.projectName,
          bondValue: core.bondValue,
          rate: core.rate,
          grossPremium: core.calc.grossPremium,
          phcfAmount: core.calc.phcfAmount,
          itlAmount: core.calc.itlAmount,
          stampDutyAmount: core.calc.stampDutyAmount,
          totalPremium: core.calc.totalPremium,
        },
      },
    },
    totals,
  };
}

// --- Customs Bond -----------------------------------------------------------

function buildCustomsBondSection(
  section: CustomsBondSectionInput,
  insuranceType: InsuranceTypeModel
): SingleSectionResult {
  const customsBond = section.customsBond;

  const rawRows = customsBond.itemRows.filter(
    (r) => !(!r.bondType?.trim() && isBlank(r.bondValue) && isBlank(r.rate))
  );
  if (rawRows.length === 0) return { error: "CUSTOMS_BOND_AT_LEAST_ONE_ROW" };

  const rows: { bondType: string; bondValue: Prisma.Decimal; rate: Prisma.Decimal }[] = [];
  for (const row of rawRows) {
    const bondType = row.bondType?.trim();
    if (!bondType) return { error: "CUSTOMS_BOND_TYPE_REQUIRED" };
    const bondValue = parseRequiredNonNegative(row.bondValue, "CUSTOMS_BOND_VALUE_INVALID");
    if (isErr(bondValue)) return bondValue;
    const rate = parseRequiredNonNegative(row.rate, "CUSTOMS_BOND_RATE_INVALID");
    if (isErr(rate)) return rate;
    rows.push({ bondType, bondValue, rate });
  }

  const calc = calculateCustomsBond({ rows });
  const totals: SectionTotals = {
    basePremium: calc.grossPremium,
    phcfAmount: calc.phcfAmount,
    itlAmount: calc.itlAmount,
    stampDutyAmount: calc.stampDutyAmount,
    sectionTotal: calc.totalPremium,
  };

  const items: Prisma.QuotationCoverageItemCreateWithoutSectionInput[] = calc.rows.map((row, index) => ({
    insuredContent: rows[index].bondType,
    sumInsured: row.bondValue,
    rate: row.rate,
    calculationMethod: "PERCENTAGE",
    premium: row.premium,
    sortOrder: index,
  }));

  return {
    sectionCreate: {
      ...structuredSectionFields(section, insuranceType, "CUSTOMS_BOND", totals),
      items: { create: items },
      customsBondDetail: {
        create: {
          grossPremium: calc.grossPremium,
          phcfAmount: calc.phcfAmount,
          itlAmount: calc.itlAmount,
          stampDutyAmount: calc.stampDutyAmount,
          totalPremium: calc.totalPremium,
          itemRows: {
            create: rows.map((row, index) => ({
              bondType: row.bondType,
              bondValue: row.bondValue,
              rate: row.rate,
              premium: calc.rows[index].premium,
              sortOrder: index,
            })),
          },
        },
      },
    },
    totals,
  };
}

async function buildSectionCreates(sections: SectionInput[]): Promise<SectionBuildResult> {
  if (!sections || sections.length === 0) {
    return { error: "AT_LEAST_ONE_SECTION" };
  }

  const insuranceTypes = await prisma.insuranceType.findMany({
    where: { id: { in: sections.map((s) => s.insuranceTypeId) } },
  });
  const insuranceTypeById = new Map(insuranceTypes.map((it) => [it.id, it]));

  const wibaSection = sections.find(
    (s): s is WibaSectionInput => (s.sectionKind ?? "GENERIC") === "WIBA"
  );
  const preparedWiba = prepareWiba(wibaSection);
  if (preparedWiba && isErr(preparedWiba)) return preparedWiba;

  const elSection = sections.find((s) => s.sectionKind === "EMPLOYERS_LIABILITY");
  if (elSection && !preparedWiba) return { error: "EL_REQUIRES_WIBA" };

  const sectionCreates: Prisma.QuotationInsuranceSectionCreateWithoutQuotationInput[] = [];
  const sectionTotalsList: SectionTotals[] = [];

  for (let sIndex = 0; sIndex < sections.length; sIndex++) {
    const section = sections[sIndex];
    const kind = section.sectionKind ?? "GENERIC";
    const insuranceType = insuranceTypeById.get(section.insuranceTypeId);
    if (!insuranceType) return { error: "INSURANCE_TYPE_NOT_FOUND" };

    let built: SingleSectionResult;
    switch (kind) {
      case "GENERIC":
        built = buildGenericSection(section as GenericSectionInput, insuranceType);
        break;
      case "CAR_PACKAGE":
        built = buildCarSection(section as CarPackageSectionInput, insuranceType);
        break;
      case "WIBA":
        built = buildWibaSection(section as WibaSectionInput, insuranceType, preparedWiba!);
        break;
      case "EMPLOYERS_LIABILITY":
        built = buildElSection(section as ElSectionInput, insuranceType, preparedWiba!.calc);
        break;
      case "CPM_STANDALONE":
        built = buildCpmSection(section as CpmStandaloneSectionInput, insuranceType);
        break;
      case "PUBLIC_LIABILITY":
        built = buildPublicLiabilitySection(section as PublicLiabilitySectionInput, insuranceType);
        break;
      case "FIRE_AND_PERILS":
        built = buildFireSection(section as FireSectionInput, insuranceType);
        break;
      case "BURGLARY":
        built = buildBurglarySection(section as BurglarySectionInput, insuranceType);
        break;
      case "GIT_SINGLE":
        built = buildGitSingleSection(section as GitSingleSectionInput, insuranceType);
        break;
      case "GIT_ANNUAL":
        built = buildGitAnnualSection(section as GitAnnualSectionInput, insuranceType);
        break;
      case "MARINE_COVER":
        built = buildMarineSection(section as MarineSectionInput, insuranceType);
        break;
      case "MOTOR_COMP_PRIVATE":
        built = buildMotorCompPrivateSection(section as MotorCompPrivateSectionInput, insuranceType);
        break;
      case "MOTOR_COMP_COMMERCIAL":
        built = buildMotorCompCommercialSection(section as MotorCompCommercialSectionInput, insuranceType);
        break;
      case "MOTOR_TPO_PRIVATE":
        built = buildMotorTpoPrivateSection(section as MotorTpoPrivateSectionInput, insuranceType);
        break;
      case "MOTOR_TPO_COMMERCIAL":
        built = buildMotorTpoCommercialSection(section as MotorTpoCommercialSectionInput, insuranceType);
        break;
      case "GROUP_PERSONAL_ACCIDENT":
        built = buildGpaSection(section as GpaSectionInput, insuranceType);
        break;
      case "GROUP_MEDICAL":
        built = buildMedicalSection(section as MedicalSectionInput, insuranceType);
        break;
      case "TENDER_SECURITY":
        built = buildTenderSecuritySection(section as TenderSecuritySectionInput, insuranceType);
        break;
      case "PERFORMANCE_BOND":
        built = buildPerformanceBondSection(section as PerformanceBondSectionInput, insuranceType);
        break;
      case "ADVANCE_PAYMENT_GUARANTEE":
        built = buildAdvancePaymentGuaranteeSection(section as AdvancePaymentGuaranteeSectionInput, insuranceType);
        break;
      case "CUSTOMS_BOND":
        built = buildCustomsBondSection(section as CustomsBondSectionInput, insuranceType);
        break;
    }

    if ("error" in built) return { error: built.error };

    sectionCreates.push({ ...built.sectionCreate, sortOrder: sIndex });
    sectionTotalsList.push(built.totals);
  }

  return { sectionCreates, quotationTotals: calculateQuotationTotals(sectionTotalsList) };
}

async function validateCustomerAndProject(
  customerId: string,
  projectId: string | null | undefined
): Promise<CustomerProjectCheckResult> {
  if (!customerId) return { error: "CUSTOMER_REQUIRED" };

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return { error: "CUSTOMER_NOT_FOUND" };

  if (projectId) {
    const project = await prisma.customerProject.findUnique({ where: { id: projectId } });
    if (!project || project.customerId !== customerId) {
      return { error: "PROJECT_NOT_BELONG_TO_CUSTOMER" };
    }
  }

  return { ok: true };
}

// --- Phase 2B: quotation case workflow -------------------------------------
// "New Quotation" no longer creates a case + R01 in one shot (that's what
// createQuotationAction used to do, before Phase 2B — see git history).
// Real brokerage workflow collects underwriting documents against a bare
// case BEFORE any quotation revision exists, so case creation and R01
// creation are now two separate, independently-timed actions:
//   createQuotationCaseAction   — the case only, no Quotation row at all.
//   startFirstQuotationAction   — creates R01 for an EXISTING case (the
//                                 "Start First Quotation" button, shown only
//                                 while the case has no revision yet).
// Insurance types are no longer collected at case-creation time — they are
// selected later, in the full quotation editor, when "Start First Quotation"
// creates R01 (see startFirstQuotationAction below). intendedInsuranceTypeIds
// and internalNote remain on the QuotationCase model for backward
// compatibility with cases created before this change, but new cases never
// write them (intendedInsuranceTypeIds is stored empty, internalNote null).
export type CreateQuotationCaseInput = {
  customerId: string;
  projectId?: string | null;
  enquiryDate: string;
};

export async function createQuotationCaseAction(
  data: CreateQuotationCaseInput
): Promise<ActionResult<{ id: string; quotationNumber: string }>> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const customerCheck = await validateCustomerAndProject(data.customerId, data.projectId);
  if ("error" in customerCheck) return { success: false, error: customerCheck.error };

  if (!data.enquiryDate) {
    return { success: false, error: "ENQUIRY_DATE_REQUIRED" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const quotationNumber = await generateQuotationNumber(tx);
      return tx.quotationCase.create({
        data: {
          quotationNumber,
          customerId: data.customerId,
          projectId: data.projectId || null,
          intendedInsuranceTypeIds: [],
          enquiryDate: new Date(data.enquiryDate),
          internalNote: null,
          status: "DRAFT",
          createdById: session.user.id,
        },
      });
    });

    revalidatePath("/quotation");
    return { success: true, id: result.id, quotationNumber: result.quotationNumber };
  } catch (err) {
    console.error("Failed to create quotation case:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

export async function startFirstQuotationAction(
  quotationCaseId: string,
  data: QuotationInput
): Promise<ActionResult<{ id: string; quotationNumber: string }>> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const quotationCase = await prisma.quotationCase.findUnique({ where: { id: quotationCaseId } });
  if (!quotationCase) return { success: false, error: "CASE_NOT_FOUND" };
  if (quotationCase.currentRevisionId) return { success: false, error: "REVISION_ALREADY_EXISTS" };

  const customerCheck = await validateCustomerAndProject(data.customerId, data.projectId);
  if ("error" in customerCheck) return { success: false, error: customerCheck.error };

  const built = await buildSectionCreates(data.sections);
  if ("error" in built) return { success: false, error: built.error };

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction: safe if two "Start First
      // Quotation" submissions raced each other.
      const fresh = await tx.quotationCase.findUniqueOrThrow({ where: { id: quotationCaseId } });
      if (fresh.currentRevisionId) throw new Error("REVISION_ALREADY_EXISTS");

      const quotation = await tx.quotation.create({
        data: {
          quotationNumber: fresh.quotationNumber,
          customerId: data.customerId,
          projectId: data.projectId || null,
          quotationDate: data.quotationDate ? new Date(data.quotationDate) : new Date(),
          validUntil: data.validUntil ? new Date(data.validUntil) : null,
          currency: data.currency?.trim() || "KES",
          internalNotes: data.internalNotes?.trim() || null,
          status: "DRAFT",
          subtotalPremium: built.quotationTotals.subtotalPremium,
          totalPHCF: built.quotationTotals.totalPHCF,
          totalITL: built.quotationTotals.totalITL,
          totalStampDuty: built.quotationTotals.totalStampDuty,
          grandTotal: built.quotationTotals.grandTotal,
          createdBy: session.user.id,
          quotationCaseId,
          revisionNumber: 1,
          revisionCode: "R01",
          revisionReason: "Initial quotation",
          revisionStatus: "DRAFT",
          isCurrentRevision: true,
          sections: { create: built.sectionCreates },
        },
      });

      await tx.quotationCase.update({
        where: { id: quotationCaseId },
        data: { currentRevisionId: quotation.id, status: "IN_PROGRESS", updatedById: session.user.id },
      });

      return quotation;
    });

    revalidatePath("/quotation");
    revalidatePath(`/quotation/case/${quotationCaseId}`);
    return { success: true, id: result.id, quotationNumber: result.quotationNumber };
  } catch (err) {
    if (err instanceof Error && err.message === "REVISION_ALREADY_EXISTS") {
      return { success: false, error: "REVISION_ALREADY_EXISTS" };
    }
    console.error("Failed to start first quotation:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

export async function updateQuotationAction(
  id: string,
  data: QuotationInput
): Promise<ActionResult> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const existing = await prisma.quotation.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "QUOTATION_NOT_FOUND" };
  // Phase 1 revision locking: a revision that has ever been issued is a
  // historical record from here on. Pre-Phase-1 rows (revisionStatus still
  // null, never backfilled — should not exist after the backfill script
  // runs, but checked defensively) are treated as editable, matching their
  // original behavior.
  if (existing.revisionStatus && existing.revisionStatus !== "DRAFT") {
    return { success: false, error: "REVISION_LOCKED" };
  }

  const customerCheck = await validateCustomerAndProject(data.customerId, data.projectId);
  if ("error" in customerCheck) return { success: false, error: customerCheck.error };

  const built = await buildSectionCreates(data.sections);
  if ("error" in built) return { success: false, error: built.error };

  try {
    await prisma.$transaction(async (tx) => {
      // Sections/items/detail rows are always fully replaced on edit —
      // cascade delete removes the old coverage items and structured detail
      // rows (WIBA payroll rows, CPM equipment rows, etc.) along with their
      // sections.
      await tx.quotationInsuranceSection.deleteMany({ where: { quotationId: id } });

      await tx.quotation.update({
        where: { id },
        data: {
          customerId: data.customerId,
          projectId: data.projectId || null,
          quotationDate: data.quotationDate ? new Date(data.quotationDate) : existing.quotationDate,
          validUntil: data.validUntil ? new Date(data.validUntil) : null,
          currency: data.currency?.trim() || "KES",
          internalNotes: data.internalNotes?.trim() || null,
          subtotalPremium: built.quotationTotals.subtotalPremium,
          totalPHCF: built.quotationTotals.totalPHCF,
          totalITL: built.quotationTotals.totalITL,
          totalStampDuty: built.quotationTotals.totalStampDuty,
          grandTotal: built.quotationTotals.grandTotal,
          sections: { create: built.sectionCreates },
        },
      });
    });

    revalidatePath("/quotation");
    revalidatePath(`/quotation/${id}`);
    return { success: true };
  } catch (err) {
    console.error("Failed to update quotation:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

export async function updateQuotationStatusAction(
  id: string,
  status: QuotationStatus
): Promise<ActionResult> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  await prisma.quotation.update({ where: { id }, data: { status } });

  revalidatePath("/quotation");
  revalidatePath(`/quotation/${id}`);
  return { success: true };
}

// Deleting a Quotation cascades (schema-level onDelete: Cascade) through its
// QuotationInsuranceSection rows to their coverage items and structured
// detail rows (CAR/WIBA/EL/CPM, including WIBA payroll rows and CPM
// equipment rows) — nothing is left orphaned. There are currently no
// Invoice/Policy models in the schema (those modules are placeholders), so
// there is no downstream record that could reference a quotation; once such
// a relation exists, add a guard here that blocks deletion with a clear
// error instead of letting the cascade run.
export async function deleteQuotationAction(id: string): Promise<ActionResult> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const existing = await prisma.quotation.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { success: false, error: "QUOTATION_NOT_FOUND" };

  try {
    await prisma.quotation.delete({ where: { id } });
    revalidatePath("/quotation");
    return { success: true };
  } catch (err) {
    console.error("Failed to delete quotation:", err);
    return { success: false, error: "DELETE_FAILED" };
  }
}
