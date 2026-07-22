"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { InsuranceTypeSelector, type Phase1Selection } from "@/components/quotations/InsuranceTypeSelector";
import { CARSection } from "@/components/quotations/sections/CARSection";
import { WIBASection } from "@/components/quotations/sections/WIBASection";
import { ELSection } from "@/components/quotations/sections/ELSection";
import { CPMSection } from "@/components/quotations/sections/CPMSection";
import { PublicLiabilitySection } from "@/components/quotations/sections/PublicLiabilitySection";
import { FireSection } from "@/components/quotations/sections/FireSection";
import { BurglarySection } from "@/components/quotations/sections/BurglarySection";
import { GITSingleSection } from "@/components/quotations/sections/GITSingleSection";
import { GITAnnualSection } from "@/components/quotations/sections/GITAnnualSection";
import { MarineSection } from "@/components/quotations/sections/MarineSection";
import { MotorComprehensiveSection } from "@/components/quotations/sections/MotorComprehensiveSection";
import { MotorTpoSection } from "@/components/quotations/sections/MotorTpoSection";
import { GPASection } from "@/components/quotations/sections/GPASection";
import { MedicalSection } from "@/components/quotations/sections/MedicalSection";
import { GuaranteeSection } from "@/components/quotations/sections/GuaranteeSection";
import { CustomsBondSection } from "@/components/quotations/sections/CustomsBondSection";
import { QuotationSummary, type QuotationSummaryLine } from "@/components/quotations/QuotationSummary";
import {
  emptyCarDraft,
  emptyCpmDraft,
  emptyCpmEquipmentRow,
  emptyWibaDraft,
  emptyWibaPayrollRow,
  emptyPublicLiabilityDraft,
  emptyFireDraft,
  emptyBurglaryDraft,
  emptyGitSingleDraft,
  emptyGitAnnualDraft,
  emptyMarineDraft,
  emptyMarineShipmentRow,
  emptyMotorComprehensiveDraft,
  emptyMotorTpoDraft,
  emptyGpaDraft,
  emptyMedicalDraft,
  emptyGuaranteeDraft,
  emptyCustomsBondDraft,
  emptyCustomsBondItemRow,
  MEDICAL_CATEGORIES,
  type CarDraft,
  type CpmDraft,
  type WibaDraft,
  type PublicLiabilityDraft,
  type FireDraft,
  type BurglaryDraft,
  type GitSingleDraft,
  type GitAnnualDraft,
  type MarineDraft,
  type MotorComprehensiveDraft,
  type MotorTpoDraft,
  type GpaDraft,
  type MedicalDraft,
  type GuaranteeDraft,
  type CustomsBondDraft,
} from "@/components/quotations/sectionDrafts";
import {
  previewCarPackage,
  previewCpmStandalone,
  previewEl,
  previewWiba,
  previewPublicLiability,
  previewFire,
  previewBurglary,
  previewGitSingle,
  previewGitAnnual,
  previewMarine,
  previewMotorComprehensive,
  previewMotorTpo,
  previewGpa,
  previewMedical,
  previewGuarantee,
  previewCustomsBond,
  round2,
} from "@/lib/insuranceCalculations/clientPreview";
import { startFirstQuotationAction, updateQuotationAction } from "@/app/(app)/quotation/actions";
import type { SectionInput } from "@/app/(app)/quotation/actions";
import type {
  CustomerOption,
  InsuranceTypeOption,
  CalculationMethod,
  SectionRow,
  MotorComprehensiveDetailRow,
  MotorTpoDetailRow,
  GuaranteeSectionDetailRow,
} from "@/components/quotations/types";

type ItemDraft = {
  key: string;
  insuredContent: string;
  sumInsured: string;
  rate: string;
  calculationMethod: CalculationMethod;
  premium: string;
  notes: string;
};

type SectionDraft = {
  key: string;
  insuranceTypeId: string;
  insuranceTypeNameSnapshot: string;
  description: string;
  phcfRate: string;
  itlRate: string;
  stampDuty: string;
  applyPHCF: boolean;
  applyITL: boolean;
  applyStampDuty: boolean;
  clausesSnapshot: string;
  exclusionsSnapshot: string;
  conditionsSnapshot: string;
  items: ItemDraft[];
};

export type QuotationFormData = {
  id: string;
  quotationNumber: string;
  customerId: string;
  projectId: string | null;
  quotationDate: string;
  validUntil: string;
  currency: string;
  internalNotes: string;
  sections: SectionRow[];
};

const ERROR_KEY: Record<string, string> = {
  CUSTOMER_REQUIRED: "customerRequired",
  CUSTOMER_NOT_FOUND: "genericError",
  PROJECT_NOT_BELONG_TO_CUSTOMER: "projectNotBelongToCustomer",
  AT_LEAST_ONE_SECTION: "atLeastOneSection",
  AT_LEAST_ONE_ITEM: "atLeastOneItem",
  INSURANCE_TYPE_NOT_FOUND: "insuranceTypeNotConfigured",
  ITEM_CONTENT_REQUIRED: "requiredField",
  ITEM_SUM_INSURED_REQUIRED: "requiredField",
  ITEM_RATE_REQUIRED: "requiredField",
  ITEM_PREMIUM_REQUIRED: "requiredField",
  CREATE_FAILED: "genericError",
  UPDATE_FAILED: "genericError",
  FORBIDDEN: "genericError",
  CAR_CONTRACT_VALUE_INVALID: "invalidNonNegativeNumber",
  CAR_RATE_INVALID: "invalidNonNegativeNumber",
  CAR_PERIOD_REQUIRED: "carPeriodRequired",
  CAR_PERIOD_INVALID: "carPeriodInvalid",
  CAR_CPM_INCOMPLETE: "carCpmIncomplete",
  CAR_CPM_INVALID: "invalidNonNegativeNumber",
  CAR_TPL_BASIS_REQUIRED: "carTplBasisRequired",
  CAR_TPL_LIMIT_INVALID: "invalidNonNegativeNumber",
  CAR_PVT_AMOUNT_REQUIRED: "pvtAmountRequired",
  CAR_PVT_RATE_INVALID: "invalidNonNegativeNumber",
  WIBA_AT_LEAST_ONE_ROW: "wibaAtLeastOneRow",
  WIBA_ROW_OCCUPATION_REQUIRED: "wibaRowOccupationRequired",
  WIBA_ROW_EMPLOYEE_COUNT_INVALID: "invalidNonNegativeInteger",
  WIBA_ROW_WAGES_INVALID: "invalidNonNegativeNumber",
  WIBA_ROW_BASIC_SALARY_INVALID: "invalidNonNegativeNumber",
  WIBA_ROW_ALLOWANCE_INVALID: "invalidNonNegativeNumber",
  WIBA_RATE_INVALID: "invalidNonNegativeNumber",
  EL_REQUIRES_WIBA: "elRequiresWiba",
  CPM_AT_LEAST_ONE_ROW: "cpmAtLeastOneRow",
  CPM_ROW_NAME_REQUIRED: "cpmRowNameRequired",
  CPM_ROW_QUANTITY_INVALID: "invalidNonNegativeInteger",
  CPM_ROW_UNIT_VALUE_INVALID: "invalidNonNegativeNumber",
  CPM_RATE_INVALID: "invalidNonNegativeNumber",
  CPM_PVT_AMOUNT_REQUIRED: "pvtAmountRequired",
  CPM_PVT_RATE_INVALID: "invalidNonNegativeNumber",
  PL_YEAR_LIMIT_REQUIRED: "invalidNonNegativeNumber",
  PL_RATE_INVALID: "invalidNonNegativeNumber",
  PL_LIMIT_INVALID: "invalidNonNegativeNumber",
  FIRE_VALUE_INVALID: "invalidNonNegativeNumber",
  FIRE_RATE_INVALID: "invalidNonNegativeNumber",
  FIRE_LOADING_RATE_INVALID: "invalidNonNegativeNumber",
  FIRE_PVT_AMOUNT_REQUIRED: "pvtAmountRequired",
  FIRE_PVT_RATE_INVALID: "invalidNonNegativeNumber",
  BURGLARY_VALUE_INVALID: "invalidNonNegativeNumber",
  BURGLARY_PERCENTAGE_INVALID: "invalidNonNegativeNumber",
  BURGLARY_RATE_INVALID: "invalidNonNegativeNumber",
  GIT_CARGO_DESCRIPTION_REQUIRED: "gitCargoDescriptionRequired",
  GIT_SUM_INSURED_INVALID: "invalidNonNegativeNumber",
  GIT_RATE_INVALID: "invalidNonNegativeNumber",
  GIT_PVT_AMOUNT_REQUIRED: "pvtAmountRequired",
  GIT_PVT_RATE_INVALID: "invalidNonNegativeNumber",
  GIT_ANNUAL_LIMIT_INVALID: "invalidNonNegativeNumber",
  GIT_ANNUAL_RATE_INVALID: "invalidNonNegativeNumber",
  MARINE_AT_LEAST_ONE_ROW: "marineAtLeastOneRow",
  MARINE_ROW_SUM_INSURED_INVALID: "invalidNonNegativeNumber",
  MARINE_ROW_RATE_INVALID: "invalidNonNegativeNumber",
  MOTOR_PLATE_NO_REQUIRED: "motorPlateNoRequired",
  MOTOR_VEHICLE_VALUE_INVALID: "invalidNonNegativeNumber",
  MOTOR_RATE_INVALID: "invalidNonNegativeNumber",
  MOTOR_PERIOD_REQUIRED: "motorPeriodRequired",
  MOTOR_PERIOD_INVALID: "motorPeriodInvalid",
  MOTOR_LOADING_CAPACITY_INVALID: "invalidNonNegativeNumber",
  MOTOR_BASE_PREMIUM_INVALID: "invalidNonNegativeNumber",
  GPA_LIMIT_INVALID: "invalidNonNegativeNumber",
  GPA_RATE_INVALID: "invalidNonNegativeNumber",
  GPA_NUMBER_OF_PEOPLE_INVALID: "invalidNonNegativeInteger",
  MEDICAL_LIMIT_INVALID: "invalidNonNegativeNumber",
  MEDICAL_COUNT_INVALID: "invalidNonNegativeInteger",
  MEDICAL_RATE_INVALID: "invalidNonNegativeNumber",
  MEDICAL_AT_LEAST_ONE_POSITIVE_COUNT: "medicalAtLeastOnePositiveCount",
  TENDER_SECURITY_PROJECT_NAME_REQUIRED: "guaranteeProjectNameRequired",
  TENDER_SECURITY_VALUE_INVALID: "invalidNonNegativeNumber",
  TENDER_SECURITY_RATE_INVALID: "invalidNonNegativeNumber",
  PERFORMANCE_BOND_PROJECT_NAME_REQUIRED: "guaranteeProjectNameRequired",
  PERFORMANCE_BOND_VALUE_INVALID: "invalidNonNegativeNumber",
  PERFORMANCE_BOND_RATE_INVALID: "invalidNonNegativeNumber",
  APG_PROJECT_NAME_REQUIRED: "guaranteeProjectNameRequired",
  APG_VALUE_INVALID: "invalidNonNegativeNumber",
  APG_RATE_INVALID: "invalidNonNegativeNumber",
  CUSTOMS_BOND_AT_LEAST_ONE_ROW: "customsBondAtLeastOneRow",
  CUSTOMS_BOND_TYPE_REQUIRED: "customsBondTypeRequired",
  CUSTOMS_BOND_VALUE_INVALID: "invalidNonNegativeNumber",
  CUSTOMS_BOND_RATE_INVALID: "invalidNonNegativeNumber",
};

function computeItemPremium(item: ItemDraft): number {
  if (item.calculationMethod === "PERCENTAGE") {
    return round2(((Number(item.sumInsured) || 0) * (Number(item.rate) || 0)) / 100);
  }
  return Number(item.premium) || 0;
}

function computeSectionTotals(section: SectionDraft) {
  const basePremium = round2(section.items.reduce((acc, item) => acc + computeItemPremium(item), 0));
  const phcfAmount = section.applyPHCF ? round2((basePremium * (Number(section.phcfRate) || 0)) / 100) : 0;
  const itlAmount = section.applyITL ? round2((basePremium * (Number(section.itlRate) || 0)) / 100) : 0;
  const stampDutyAmount = section.applyStampDuty ? round2(Number(section.stampDuty) || 0) : 0;
  const sectionTotal = round2(basePremium + phcfAmount + itlAmount + stampDutyAmount);
  return { basePremium, phcfAmount, itlAmount, stampDutyAmount, sectionTotal };
}

function emptyItem(): ItemDraft {
  return {
    key: crypto.randomUUID(),
    insuredContent: "",
    sumInsured: "",
    rate: "",
    calculationMethod: "PERCENTAGE",
    premium: "",
    notes: "",
  };
}

// Only GENERIC sections belong in the freeform section list — CAR_PACKAGE /
// WIBA / EMPLOYERS_LIABILITY / CPM_STANDALONE sections are hydrated
// separately into their own structured drafts below.
function hydrateGenericSections(sections: SectionRow[]): SectionDraft[] {
  return sections
    .filter((s) => s.sectionKind === "GENERIC")
    .map((s) => ({
      key: s.id,
      insuranceTypeId: s.insuranceTypeId,
      insuranceTypeNameSnapshot: s.insuranceTypeNameSnapshot,
      description: s.description ?? "",
      phcfRate: s.phcfRate,
      itlRate: s.itlRate,
      stampDuty: s.stampDuty,
      applyPHCF: s.applyPHCF,
      applyITL: s.applyITL,
      applyStampDuty: s.applyStampDuty,
      clausesSnapshot: s.clausesSnapshot ?? "",
      exclusionsSnapshot: s.exclusionsSnapshot ?? "",
      conditionsSnapshot: s.conditionsSnapshot ?? "",
      items: s.items.map((i) => ({
        key: i.id,
        insuredContent: i.insuredContent,
        sumInsured: i.sumInsured ?? "",
        rate: i.rate ?? "",
        calculationMethod: i.calculationMethod,
        premium: i.premium,
        notes: i.notes ?? "",
      })),
    }));
}

function hydrateCarDraft(sections: SectionRow[]): CarDraft {
  const detail = sections.find((s) => s.sectionKind === "CAR_PACKAGE")?.carDetail;
  if (!detail) return emptyCarDraft();
  return {
    projectName: detail.projectName ?? "",
    contractValue: detail.contractValue,
    carRate: detail.carRate,
    constructionPeriodMonths:
      detail.constructionPeriodMonths != null ? String(detail.constructionPeriodMonths) : "",
    maintenancePeriodMonths:
      detail.maintenancePeriodMonths != null ? String(detail.maintenancePeriodMonths) : "",
    cpmValue: detail.cpmValue ?? "",
    cpmRate: detail.cpmRate ?? "",
    tplAnyOneClaim: detail.tplAnyOneClaim ?? "",
    tplAnyOneEvent: detail.tplAnyOneEvent ?? "",
    tplAnyOnePeriod: detail.tplAnyOnePeriod ?? "",
    tplRate: detail.tplRate ?? "",
    tplComplimentary: detail.tplComplimentary,
    pvtLoadingEnabled: detail.pvtLoadingEnabled,
    pvtLoadingRate: detail.pvtLoadingRate ?? "",
    pvtLoadingAmount: detail.pvtLoadingAmount,
  };
}

function hydrateWibaDraft(sections: SectionRow[]): WibaDraft {
  const detail = sections.find((s) => s.sectionKind === "WIBA")?.wibaDetail;
  if (!detail) return emptyWibaDraft();
  return {
    wibaRate: detail.wibaRate,
    payrollRows:
      detail.payrollRows.length > 0
        ? detail.payrollRows.map((r) => ({
            key: crypto.randomUUID(),
            occupation: r.occupation,
            employeeCount: String(r.employeeCount),
            annualWages: r.annualWages,
            basicMonthlySalary: r.basicMonthlySalary ?? "",
            monthlyAllowance: r.monthlyAllowance ?? "",
          }))
        : [emptyWibaPayrollRow()],
  };
}

function hydrateCpmDraft(sections: SectionRow[]): CpmDraft {
  const detail = sections.find((s) => s.sectionKind === "CPM_STANDALONE")?.cpmDetail;
  if (!detail) return emptyCpmDraft();
  return {
    cpmRate: detail.cpmRate,
    pvtLoadingEnabled: detail.pvtLoadingEnabled,
    pvtLoadingRate: detail.pvtLoadingRate ?? "",
    equipmentRows:
      detail.equipmentRows.length > 0
        ? detail.equipmentRows.map((r) => ({
            key: crypto.randomUUID(),
            equipmentName: r.equipmentName,
            quantity: String(r.quantity),
            unitValue: r.unitValue,
          }))
        : [emptyCpmEquipmentRow()],
  };
}

function hydratePublicLiabilityDraft(sections: SectionRow[]): PublicLiabilityDraft {
  const detail = sections.find((s) => s.sectionKind === "PUBLIC_LIABILITY")?.publicLiabilityDetail;
  if (!detail) return emptyPublicLiabilityDraft();
  return {
    anyOnePersonLimit: detail.anyOnePersonLimit ?? "",
    anyOneOccurrenceLimit: detail.anyOneOccurrenceLimit ?? "",
    anyOneYearLimit: detail.anyOneYearLimit,
    rate: detail.rate,
  };
}

function hydrateFireDraft(sections: SectionRow[]): FireDraft {
  const detail = sections.find((s) => s.sectionKind === "FIRE_AND_PERILS")?.fireDetail;
  if (!detail) return emptyFireDraft();
  return {
    propertyValue: detail.propertyValue,
    rawMaterialValue: detail.rawMaterialValue,
    goodsInStockValue: detail.goodsInStockValue,
    rate: detail.rate,
    earthquakeLoadingEnabled: detail.earthquakeLoadingEnabled,
    floodLoadingEnabled: detail.floodLoadingEnabled,
    pvtLoadingEnabled: detail.pvtLoadingEnabled,
    pvtLoadingRate: detail.pvtLoadingRate ?? "",
    pvtLoadingAmount: detail.pvtLoadingAmount,
  };
}

function hydrateBurglaryDraft(sections: SectionRow[]): BurglaryDraft {
  const detail = sections.find((s) => s.sectionKind === "BURGLARY")?.burglaryDetail;
  if (!detail) return emptyBurglaryDraft();
  return {
    equipmentValue: detail.equipmentValue,
    stockValue: detail.stockValue,
    firstLossPercentage: detail.firstLossPercentage,
    rate: detail.rate,
  };
}

function hydrateGitSingleDraft(sections: SectionRow[]): GitSingleDraft {
  const detail = sections.find((s) => s.sectionKind === "GIT_SINGLE")?.gitSingleDetail;
  if (!detail) return emptyGitSingleDraft();
  return {
    cargoDescription: detail.cargoDescription,
    route: detail.route ?? "",
    sumInsured: detail.sumInsured,
    rate: detail.rate,
    pvtLoadingEnabled: detail.pvtLoadingEnabled,
    pvtLoadingRate: detail.pvtLoadingRate ?? "",
    pvtLoadingAmount: detail.pvtLoadingAmount,
  };
}

function hydrateGitAnnualDraft(sections: SectionRow[]): GitAnnualDraft {
  const detail = sections.find((s) => s.sectionKind === "GIT_ANNUAL")?.gitAnnualDetail;
  if (!detail) return emptyGitAnnualDraft();
  return {
    cargoDescription: detail.cargoDescription,
    singleLimit: detail.singleLimit,
    yearLimit: detail.yearLimit,
    singleLimitRate: detail.singleLimitRate,
    yearLimitRate: detail.yearLimitRate,
    pvtLoadingEnabled: detail.pvtLoadingEnabled,
    pvtLoadingRate: detail.pvtLoadingRate ?? "",
    pvtLoadingAmount: detail.pvtLoadingAmount,
  };
}

function hydrateMarineDraft(sections: SectionRow[]): MarineDraft {
  const detail = sections.find((s) => s.sectionKind === "MARINE_COVER")?.marineDetail;
  if (!detail) return emptyMarineDraft();
  return {
    cargoDescription: detail.cargoDescription ?? "",
    origin: detail.origin ?? "",
    destination: detail.destination ?? "",
    shipmentRows:
      detail.shipmentRows.length > 0
        ? detail.shipmentRows.map((r) => ({
            key: crypto.randomUUID(),
            referenceNo: r.referenceNo ?? "",
            sumInsured: r.sumInsured,
            rate: r.rate,
          }))
        : [emptyMarineShipmentRow()],
  };
}

function motorComprehensiveDraftFromDetail(
  detail: MotorComprehensiveDetailRow | null | undefined
): MotorComprehensiveDraft {
  if (!detail) return emptyMotorComprehensiveDraft();
  return {
    plateNo: detail.plateNo,
    vehicleValue: detail.vehicleValue,
    periodFrom: detail.periodFrom,
    periodTo: detail.periodTo,
    excessProtector: detail.excessProtector ?? "",
    pvt: detail.pvt ?? "",
    rate: detail.rate,
  };
}
function hydrateMotorCompPrivateDraft(sections: SectionRow[]): MotorComprehensiveDraft {
  return motorComprehensiveDraftFromDetail(
    sections.find((s) => s.sectionKind === "MOTOR_COMP_PRIVATE")?.motorCompPrivateDetail
  );
}
function hydrateMotorCompCommercialDraft(sections: SectionRow[]): MotorComprehensiveDraft {
  return motorComprehensiveDraftFromDetail(
    sections.find((s) => s.sectionKind === "MOTOR_COMP_COMMERCIAL")?.motorCompCommercialDetail
  );
}

function motorTpoDraftFromDetail(detail: MotorTpoDetailRow | null | undefined): MotorTpoDraft {
  if (!detail) return emptyMotorTpoDraft();
  return {
    plateNo: detail.plateNo,
    loadingCapacity: detail.loadingCapacity ?? "",
    basePremium: detail.basePremium,
    periodFrom: detail.periodFrom,
    periodTo: detail.periodTo,
  };
}
function hydrateMotorTpoPrivateDraft(sections: SectionRow[]): MotorTpoDraft {
  return motorTpoDraftFromDetail(sections.find((s) => s.sectionKind === "MOTOR_TPO_PRIVATE")?.motorTpoPrivateDetail);
}
function hydrateMotorTpoCommercialDraft(sections: SectionRow[]): MotorTpoDraft {
  return motorTpoDraftFromDetail(
    sections.find((s) => s.sectionKind === "MOTOR_TPO_COMMERCIAL")?.motorTpoCommercialDetail
  );
}

function hydrateGpaDraft(sections: SectionRow[]): GpaDraft {
  const detail = sections.find((s) => s.sectionKind === "GROUP_PERSONAL_ACCIDENT")?.gpaDetail;
  if (!detail) return emptyGpaDraft();
  return {
    deathLimit: detail.deathLimit,
    ptdLimit: detail.ptdLimit,
    ttdLimit: detail.ttdLimit,
    medicalLimit: detail.medicalLimit,
    funeralLimit: detail.funeralLimit,
    deathRate: detail.deathRate,
    ptdRate: detail.ptdRate,
    ttdRate: detail.ttdRate,
    medicalRate: detail.medicalRate,
    funeralRate: detail.funeralRate,
    numberOfPeople: String(detail.numberOfPeople),
  };
}

function hydrateMedicalDraft(sections: SectionRow[]): MedicalDraft {
  const detail = sections.find((s) => s.sectionKind === "GROUP_MEDICAL")?.medicalDetail;
  if (!detail) return emptyMedicalDraft();
  const rowByCategory = new Map(detail.categoryRows.map((r) => [r.category, r]));
  return {
    inpatientLimit: detail.inpatientLimit,
    outpatientLimit: detail.outpatientLimit,
    categoryRows: MEDICAL_CATEGORIES.map((category) => {
      const row = rowByCategory.get(category);
      return {
        category,
        employeeCount: row ? String(row.employeeCount) : "",
        inpatientRate: row ? row.inpatientRate : "",
        outpatientRate: row ? row.outpatientRate : "",
      };
    }),
  };
}

function guaranteeDraftFromDetail(detail: GuaranteeSectionDetailRow | null | undefined): GuaranteeDraft {
  if (!detail) return emptyGuaranteeDraft();
  return { projectName: detail.projectName, bondValue: detail.bondValue, rate: detail.rate };
}
function hydrateTenderSecurityDraft(sections: SectionRow[]): GuaranteeDraft {
  return guaranteeDraftFromDetail(sections.find((s) => s.sectionKind === "TENDER_SECURITY")?.tenderSecurityDetail);
}
function hydratePerformanceBondDraft(sections: SectionRow[]): GuaranteeDraft {
  return guaranteeDraftFromDetail(sections.find((s) => s.sectionKind === "PERFORMANCE_BOND")?.performanceBondDetail);
}
function hydrateApgDraft(sections: SectionRow[]): GuaranteeDraft {
  return guaranteeDraftFromDetail(
    sections.find((s) => s.sectionKind === "ADVANCE_PAYMENT_GUARANTEE")?.advancePaymentGuaranteeDetail
  );
}

function hydrateCustomsBondDraft(sections: SectionRow[]): CustomsBondDraft {
  const detail = sections.find((s) => s.sectionKind === "CUSTOMS_BOND")?.customsBondDetail;
  if (!detail) return emptyCustomsBondDraft();
  return {
    itemRows:
      detail.itemRows.length > 0
        ? detail.itemRows.map((r) => ({
            key: crypto.randomUUID(),
            bondType: r.bondType,
            bondValue: r.bondValue,
            rate: r.rate,
          }))
        : [emptyCustomsBondItemRow()],
  };
}

export function QuotationForm({
  customers,
  insuranceTypes,
  quotation,
  startFirstQuotationFor,
}: {
  customers: CustomerOption[];
  insuranceTypes: InsuranceTypeOption[];
  quotation: QuotationFormData | null;
  /**
   * Phase 2B "Start First Quotation": creates R01 for a case that already
   * exists (customer/project already fixed by the case, so those fields are
   * locked here rather than re-collected). Mutually exclusive with
   * `quotation` — either editing an existing revision, or creating the
   * first one for this case, never both.
   */
  startFirstQuotationFor?: { quotationCaseId: string; customerId: string; projectId: string | null } | null;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const isEdit = !!quotation;
  const isStartingFirstQuotation = !isEdit && !!startFirstQuotationFor;

  const [customerId, setCustomerId] = useState(quotation?.customerId ?? startFirstQuotationFor?.customerId ?? "");
  const [projectId, setProjectId] = useState(quotation?.projectId ?? startFirstQuotationFor?.projectId ?? "");
  const [quotationDate, setQuotationDate] = useState(
    quotation?.quotationDate ?? new Date().toISOString().slice(0, 10)
  );
  const [validUntil, setValidUntil] = useState(quotation?.validUntil ?? "");
  const [currency, setCurrency] = useState(quotation?.currency ?? "KES");
  // Internal Notes no longer has a UI control (see requirement to remove it
  // from the create/edit form), but its value is still carried through in
  // the save payload unchanged so legacy notes on existing quotations are
  // never wiped out by an edit-save.
  const [internalNotes] = useState(quotation?.internalNotes ?? "");
  const [sections, setSections] = useState<SectionDraft[]>(
    () => hydrateGenericSections(quotation?.sections ?? [])
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    { type: "section"; key: string } | { type: "item"; sectionKey: string; itemKey: string } | null
  >(null);

  const [carEnabled, setCarEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "CAR_PACKAGE")
  );
  const [carDraft, setCarDraft] = useState<CarDraft>(() => hydrateCarDraft(quotation?.sections ?? []));
  const [wibaEnabled, setWibaEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "WIBA")
  );
  const [wibaDraft, setWibaDraft] = useState<WibaDraft>(() => hydrateWibaDraft(quotation?.sections ?? []));
  const [elEnabled, setElEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "EMPLOYERS_LIABILITY")
  );
  const [cpmEnabled, setCpmEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "CPM_STANDALONE")
  );
  const [cpmDraft, setCpmDraft] = useState<CpmDraft>(() => hydrateCpmDraft(quotation?.sections ?? []));

  const [plEnabled, setPlEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "PUBLIC_LIABILITY")
  );
  const [plDraft, setPlDraft] = useState<PublicLiabilityDraft>(() =>
    hydratePublicLiabilityDraft(quotation?.sections ?? [])
  );
  const [fireEnabled, setFireEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "FIRE_AND_PERILS")
  );
  const [fireDraft, setFireDraft] = useState<FireDraft>(() => hydrateFireDraft(quotation?.sections ?? []));
  const [burglaryEnabled, setBurglaryEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "BURGLARY")
  );
  const [burglaryDraft, setBurglaryDraft] = useState<BurglaryDraft>(() =>
    hydrateBurglaryDraft(quotation?.sections ?? [])
  );
  const [gitSingleEnabled, setGitSingleEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "GIT_SINGLE")
  );
  const [gitSingleDraft, setGitSingleDraft] = useState<GitSingleDraft>(() =>
    hydrateGitSingleDraft(quotation?.sections ?? [])
  );
  const [gitAnnualEnabled, setGitAnnualEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "GIT_ANNUAL")
  );
  const [gitAnnualDraft, setGitAnnualDraft] = useState<GitAnnualDraft>(() =>
    hydrateGitAnnualDraft(quotation?.sections ?? [])
  );
  const [marineEnabled, setMarineEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "MARINE_COVER")
  );
  const [marineDraft, setMarineDraft] = useState<MarineDraft>(() =>
    hydrateMarineDraft(quotation?.sections ?? [])
  );

  const [motorCompPrivateEnabled, setMotorCompPrivateEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "MOTOR_COMP_PRIVATE")
  );
  const [motorCompPrivateDraft, setMotorCompPrivateDraft] = useState<MotorComprehensiveDraft>(() =>
    hydrateMotorCompPrivateDraft(quotation?.sections ?? [])
  );
  const [motorCompCommercialEnabled, setMotorCompCommercialEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "MOTOR_COMP_COMMERCIAL")
  );
  const [motorCompCommercialDraft, setMotorCompCommercialDraft] = useState<MotorComprehensiveDraft>(() =>
    hydrateMotorCompCommercialDraft(quotation?.sections ?? [])
  );
  const [motorTpoPrivateEnabled, setMotorTpoPrivateEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "MOTOR_TPO_PRIVATE")
  );
  const [motorTpoPrivateDraft, setMotorTpoPrivateDraft] = useState<MotorTpoDraft>(() =>
    hydrateMotorTpoPrivateDraft(quotation?.sections ?? [])
  );
  const [motorTpoCommercialEnabled, setMotorTpoCommercialEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "MOTOR_TPO_COMMERCIAL")
  );
  const [motorTpoCommercialDraft, setMotorTpoCommercialDraft] = useState<MotorTpoDraft>(() =>
    hydrateMotorTpoCommercialDraft(quotation?.sections ?? [])
  );
  const [gpaEnabled, setGpaEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "GROUP_PERSONAL_ACCIDENT")
  );
  const [gpaDraft, setGpaDraft] = useState<GpaDraft>(() => hydrateGpaDraft(quotation?.sections ?? []));
  const [medicalEnabled, setMedicalEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "GROUP_MEDICAL")
  );
  const [medicalDraft, setMedicalDraft] = useState<MedicalDraft>(() =>
    hydrateMedicalDraft(quotation?.sections ?? [])
  );
  const [tenderSecurityEnabled, setTenderSecurityEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "TENDER_SECURITY")
  );
  const [tenderSecurityDraft, setTenderSecurityDraft] = useState<GuaranteeDraft>(() =>
    hydrateTenderSecurityDraft(quotation?.sections ?? [])
  );
  const [performanceBondEnabled, setPerformanceBondEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "PERFORMANCE_BOND")
  );
  const [performanceBondDraft, setPerformanceBondDraft] = useState<GuaranteeDraft>(() =>
    hydratePerformanceBondDraft(quotation?.sections ?? [])
  );
  const [apgEnabled, setApgEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "ADVANCE_PAYMENT_GUARANTEE")
  );
  const [apgDraft, setApgDraft] = useState<GuaranteeDraft>(() => hydrateApgDraft(quotation?.sections ?? []));
  const [customsBondEnabled, setCustomsBondEnabled] = useState(
    () => (quotation?.sections ?? []).some((s) => s.sectionKind === "CUSTOMS_BOND")
  );
  const [customsBondDraft, setCustomsBondDraft] = useState<CustomsBondDraft>(() =>
    hydrateCustomsBondDraft(quotation?.sections ?? [])
  );

  const insuranceTypeByCode = useMemo(
    () => new Map(insuranceTypes.map((it) => [it.code, it])),
    [insuranceTypes]
  );

  const phase1Selection: Phase1Selection = {
    carPackage: carEnabled,
    wiba: wibaEnabled,
    employersLiability: elEnabled,
    cpmStandalone: cpmEnabled,
    publicLiability: plEnabled,
    fireAndPerils: fireEnabled,
    burglary: burglaryEnabled,
    gitSingle: gitSingleEnabled,
    gitAnnual: gitAnnualEnabled,
    marineCover: marineEnabled,
    motorCompPrivate: motorCompPrivateEnabled,
    motorCompCommercial: motorCompCommercialEnabled,
    motorTpoPrivate: motorTpoPrivateEnabled,
    motorTpoCommercial: motorTpoCommercialEnabled,
    gpa: gpaEnabled,
    medical: medicalEnabled,
    tenderSecurity: tenderSecurityEnabled,
    performanceBond: performanceBondEnabled,
    apg: apgEnabled,
    customsBond: customsBondEnabled,
  };
  const handlePhase1SelectionChange = (next: Phase1Selection) => {
    setCarEnabled(next.carPackage);
    setWibaEnabled(next.wiba);
    setElEnabled(next.employersLiability);
    setCpmEnabled(next.cpmStandalone);
    setPlEnabled(next.publicLiability);
    setFireEnabled(next.fireAndPerils);
    setBurglaryEnabled(next.burglary);
    setGitSingleEnabled(next.gitSingle);
    setGitAnnualEnabled(next.gitAnnual);
    setMarineEnabled(next.marineCover);
    setMotorCompPrivateEnabled(next.motorCompPrivate);
    setMotorCompCommercialEnabled(next.motorCompCommercial);
    setMotorTpoPrivateEnabled(next.motorTpoPrivate);
    setMotorTpoCommercialEnabled(next.motorTpoCommercial);
    setGpaEnabled(next.gpa);
    setMedicalEnabled(next.medical);
    setTenderSecurityEnabled(next.tenderSecurity);
    setPerformanceBondEnabled(next.performanceBond);
    setApgEnabled(next.apg);
    setCustomsBondEnabled(next.customsBond);
  };

  const calculationMethodLabel: Record<CalculationMethod, string> = {
    PERCENTAGE: t.quotations.percentage,
    FIXED_PREMIUM: t.quotations.fixedPremium,
    MANUAL_PREMIUM: t.quotations.manualPremium,
  };

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const availableProjects = selectedCustomer?.projects ?? [];

  const sectionTotalsByKey = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeSectionTotals>>();
    sections.forEach((s) => map.set(s.key, computeSectionTotals(s)));
    return map;
  }, [sections]);

  const carPreview = useMemo(() => previewCarPackage(carDraft), [carDraft]);
  const wibaPreview = useMemo(() => previewWiba(wibaDraft), [wibaDraft]);
  const elPreview = useMemo(() => previewEl(wibaPreview.grossPremium), [wibaPreview]);
  const cpmPreview = useMemo(() => previewCpmStandalone(cpmDraft), [cpmDraft]);
  const plPreview = useMemo(() => previewPublicLiability(plDraft), [plDraft]);
  const firePreview = useMemo(() => previewFire(fireDraft), [fireDraft]);
  const burglaryPreview = useMemo(() => previewBurglary(burglaryDraft), [burglaryDraft]);
  const gitSinglePreview = useMemo(() => previewGitSingle(gitSingleDraft), [gitSingleDraft]);
  const gitAnnualPreview = useMemo(() => previewGitAnnual(gitAnnualDraft), [gitAnnualDraft]);
  const marinePreview = useMemo(() => previewMarine(marineDraft), [marineDraft]);
  const motorCompPrivatePreview = useMemo(
    () => previewMotorComprehensive(motorCompPrivateDraft),
    [motorCompPrivateDraft]
  );
  const motorCompCommercialPreview = useMemo(
    () => previewMotorComprehensive(motorCompCommercialDraft),
    [motorCompCommercialDraft]
  );
  const motorTpoPrivatePreview = useMemo(() => previewMotorTpo(motorTpoPrivateDraft), [motorTpoPrivateDraft]);
  const motorTpoCommercialPreview = useMemo(
    () => previewMotorTpo(motorTpoCommercialDraft),
    [motorTpoCommercialDraft]
  );
  const gpaPreview = useMemo(() => previewGpa(gpaDraft), [gpaDraft]);
  const medicalPreview = useMemo(() => previewMedical(medicalDraft), [medicalDraft]);
  const tenderSecurityPreview = useMemo(() => previewGuarantee(tenderSecurityDraft), [tenderSecurityDraft]);
  const performanceBondPreview = useMemo(() => previewGuarantee(performanceBondDraft), [performanceBondDraft]);
  const apgPreview = useMemo(() => previewGuarantee(apgDraft), [apgDraft]);
  const customsBondPreview = useMemo(
    () => previewCustomsBond({ rows: customsBondDraft.itemRows }),
    [customsBondDraft]
  );

  const quotationTotals = useMemo(() => {
    const totalsList = sections.map((s) => sectionTotalsByKey.get(s.key)!);
    let subtotalPremium = totalsList.reduce((acc, t2) => acc + t2.basePremium, 0);
    let totalPHCF = totalsList.reduce((acc, t2) => acc + t2.phcfAmount, 0);
    let totalITL = totalsList.reduce((acc, t2) => acc + t2.itlAmount, 0);
    let totalStampDuty = totalsList.reduce((acc, t2) => acc + t2.stampDutyAmount, 0);

    if (carEnabled) {
      subtotalPremium += carPreview.basePremium;
      totalPHCF += carPreview.phcfAmount;
      totalITL += carPreview.itlAmount;
      totalStampDuty += carPreview.stampDutyAmount;
    }
    if (wibaEnabled) {
      subtotalPremium += wibaPreview.grossPremium;
      totalPHCF += wibaPreview.phcfAmount;
      totalITL += wibaPreview.itlAmount;
      totalStampDuty += wibaPreview.stampDutyAmount;
    }
    if (elEnabled) {
      subtotalPremium += elPreview.grossPremium;
      totalPHCF += elPreview.phcfAmount;
      totalITL += elPreview.itlAmount;
      totalStampDuty += elPreview.stampDutyAmount;
    }
    if (cpmEnabled) {
      subtotalPremium += cpmPreview.grossPremium;
      totalPHCF += cpmPreview.phcfAmount;
      totalITL += cpmPreview.itlAmount;
      totalStampDuty += cpmPreview.stampDutyAmount;
    }
    if (plEnabled) {
      subtotalPremium += plPreview.grossPremium;
      totalPHCF += plPreview.phcfAmount;
      totalITL += plPreview.itlAmount;
      totalStampDuty += plPreview.stampDutyAmount;
    }
    if (fireEnabled) {
      subtotalPremium += firePreview.grossPremium;
      totalPHCF += firePreview.phcfAmount;
      totalITL += firePreview.itlAmount;
      totalStampDuty += firePreview.stampDutyAmount;
    }
    if (burglaryEnabled) {
      subtotalPremium += burglaryPreview.grossPremium;
      totalPHCF += burglaryPreview.phcfAmount;
      totalITL += burglaryPreview.itlAmount;
      totalStampDuty += burglaryPreview.stampDutyAmount;
    }
    if (gitSingleEnabled) {
      subtotalPremium += gitSinglePreview.grossPremium;
      totalPHCF += gitSinglePreview.phcfAmount;
      totalITL += gitSinglePreview.itlAmount;
      totalStampDuty += gitSinglePreview.stampDutyAmount;
    }
    if (gitAnnualEnabled) {
      subtotalPremium += gitAnnualPreview.grossPremium;
      totalPHCF += gitAnnualPreview.phcfAmount;
      totalITL += gitAnnualPreview.itlAmount;
      totalStampDuty += gitAnnualPreview.stampDutyAmount;
    }
    if (marineEnabled) {
      subtotalPremium += marinePreview.grossPremium;
      totalPHCF += marinePreview.phcfAmount;
      totalITL += marinePreview.itlAmount;
      totalStampDuty += marinePreview.marineStampDutyAmount;
    }
    if (motorCompPrivateEnabled) {
      subtotalPremium += motorCompPrivatePreview.grossPremium;
      totalPHCF += motorCompPrivatePreview.phcfAmount;
      totalITL += motorCompPrivatePreview.itlAmount;
      totalStampDuty += motorCompPrivatePreview.stampDutyAmount;
    }
    if (motorCompCommercialEnabled) {
      subtotalPremium += motorCompCommercialPreview.grossPremium;
      totalPHCF += motorCompCommercialPreview.phcfAmount;
      totalITL += motorCompCommercialPreview.itlAmount;
      totalStampDuty += motorCompCommercialPreview.stampDutyAmount;
    }
    if (motorTpoPrivateEnabled) {
      subtotalPremium += motorTpoPrivatePreview.grossPremium;
      totalPHCF += motorTpoPrivatePreview.phcfAmount;
      totalITL += motorTpoPrivatePreview.itlAmount;
      totalStampDuty += motorTpoPrivatePreview.stampDutyAmount;
    }
    if (motorTpoCommercialEnabled) {
      subtotalPremium += motorTpoCommercialPreview.grossPremium;
      totalPHCF += motorTpoCommercialPreview.phcfAmount;
      totalITL += motorTpoCommercialPreview.itlAmount;
      totalStampDuty += motorTpoCommercialPreview.stampDutyAmount;
    }
    if (gpaEnabled) {
      subtotalPremium += gpaPreview.grossPremium;
      totalPHCF += gpaPreview.phcfAmount;
      totalITL += gpaPreview.itlAmount;
      totalStampDuty += gpaPreview.stampDutyAmount;
    }
    if (medicalEnabled) {
      subtotalPremium += medicalPreview.grossPremium;
      totalPHCF += medicalPreview.phcfAmount;
      totalITL += medicalPreview.itlAmount;
      totalStampDuty += medicalPreview.stampDutyAmount;
    }
    if (tenderSecurityEnabled) {
      subtotalPremium += tenderSecurityPreview.grossPremium;
      totalPHCF += tenderSecurityPreview.phcfAmount;
      totalITL += tenderSecurityPreview.itlAmount;
      totalStampDuty += tenderSecurityPreview.stampDutyAmount;
    }
    if (performanceBondEnabled) {
      subtotalPremium += performanceBondPreview.grossPremium;
      totalPHCF += performanceBondPreview.phcfAmount;
      totalITL += performanceBondPreview.itlAmount;
      totalStampDuty += performanceBondPreview.stampDutyAmount;
    }
    if (apgEnabled) {
      subtotalPremium += apgPreview.grossPremium;
      totalPHCF += apgPreview.phcfAmount;
      totalITL += apgPreview.itlAmount;
      totalStampDuty += apgPreview.stampDutyAmount;
    }
    if (customsBondEnabled) {
      subtotalPremium += customsBondPreview.grossPremium;
      totalPHCF += customsBondPreview.phcfAmount;
      totalITL += customsBondPreview.itlAmount;
      totalStampDuty += customsBondPreview.stampDutyAmount;
    }

    subtotalPremium = round2(subtotalPremium);
    totalPHCF = round2(totalPHCF);
    totalITL = round2(totalITL);
    totalStampDuty = round2(totalStampDuty);
    const grandTotal = round2(subtotalPremium + totalPHCF + totalITL + totalStampDuty);

    return { subtotalPremium, totalPHCF, totalITL, totalStampDuty, grandTotal };
  }, [
    sections,
    sectionTotalsByKey,
    carEnabled,
    carPreview,
    wibaEnabled,
    wibaPreview,
    elEnabled,
    elPreview,
    cpmEnabled,
    cpmPreview,
    plEnabled,
    plPreview,
    fireEnabled,
    firePreview,
    burglaryEnabled,
    burglaryPreview,
    gitSingleEnabled,
    gitSinglePreview,
    gitAnnualEnabled,
    gitAnnualPreview,
    marineEnabled,
    marinePreview,
    motorCompPrivateEnabled,
    motorCompPrivatePreview,
    motorCompCommercialEnabled,
    motorCompCommercialPreview,
    motorTpoPrivateEnabled,
    motorTpoPrivatePreview,
    motorTpoCommercialEnabled,
    motorTpoCommercialPreview,
    gpaEnabled,
    gpaPreview,
    medicalEnabled,
    medicalPreview,
    tenderSecurityEnabled,
    tenderSecurityPreview,
    performanceBondEnabled,
    performanceBondPreview,
    apgEnabled,
    apgPreview,
    customsBondEnabled,
    customsBondPreview,
  ]);

  const summaryLines: QuotationSummaryLine[] = useMemo(() => {
    const lines: QuotationSummaryLine[] = sections.map((s) => ({
      key: s.key,
      label: s.insuranceTypeNameSnapshot,
      total: sectionTotalsByKey.get(s.key)!.sectionTotal,
    }));
    if (carEnabled) lines.push({ key: "car", label: t.quotations.carPackage, total: carPreview.sectionTotal });
    if (wibaEnabled) lines.push({ key: "wiba", label: t.quotations.wibaType, total: wibaPreview.totalPremium });
    if (elEnabled) lines.push({ key: "el", label: t.quotations.elType, total: elPreview.totalPremium });
    if (cpmEnabled) lines.push({ key: "cpm", label: t.quotations.cpmStandaloneType, total: cpmPreview.totalPremium });
    if (plEnabled) lines.push({ key: "pl", label: t.quotations.publicLiabilityType, total: plPreview.totalPremium });
    if (fireEnabled) lines.push({ key: "fire", label: t.quotations.fireAndPerilsType, total: firePreview.totalPremium });
    if (burglaryEnabled) lines.push({ key: "burglary", label: t.quotations.burglaryType, total: burglaryPreview.totalPremium });
    if (gitSingleEnabled) lines.push({ key: "gitSingle", label: t.quotations.gitSingleType, total: gitSinglePreview.totalPremium });
    if (gitAnnualEnabled) lines.push({ key: "gitAnnual", label: t.quotations.gitAnnualType, total: gitAnnualPreview.totalPremium });
    if (marineEnabled) lines.push({ key: "marine", label: t.quotations.marineCoverType, total: marinePreview.totalPremium });
    if (motorCompPrivateEnabled) lines.push({ key: "motorCompPrivate", label: t.quotations.motorCompPrivateType, total: motorCompPrivatePreview.totalPremium });
    if (motorCompCommercialEnabled) lines.push({ key: "motorCompCommercial", label: t.quotations.motorCompCommercialType, total: motorCompCommercialPreview.totalPremium });
    if (motorTpoPrivateEnabled) lines.push({ key: "motorTpoPrivate", label: t.quotations.motorTpoPrivateType, total: motorTpoPrivatePreview.totalPremium });
    if (motorTpoCommercialEnabled) lines.push({ key: "motorTpoCommercial", label: t.quotations.motorTpoCommercialType, total: motorTpoCommercialPreview.totalPremium });
    if (gpaEnabled) lines.push({ key: "gpa", label: t.quotations.gpaType, total: gpaPreview.totalPremium });
    if (medicalEnabled) lines.push({ key: "medical", label: t.quotations.medicalType, total: medicalPreview.totalPremium });
    if (tenderSecurityEnabled) lines.push({ key: "tenderSecurity", label: t.quotations.tenderSecurityType, total: tenderSecurityPreview.totalPremium });
    if (performanceBondEnabled) lines.push({ key: "performanceBond", label: t.quotations.performanceBondType, total: performanceBondPreview.totalPremium });
    if (apgEnabled) lines.push({ key: "apg", label: t.quotations.apgType, total: apgPreview.totalPremium });
    if (customsBondEnabled) lines.push({ key: "customsBond", label: t.quotations.customsBondType, total: customsBondPreview.totalPremium });
    return lines;
  }, [
    sections,
    sectionTotalsByKey,
    carEnabled,
    carPreview,
    wibaEnabled,
    wibaPreview,
    elEnabled,
    elPreview,
    cpmEnabled,
    cpmPreview,
    plEnabled,
    plPreview,
    fireEnabled,
    firePreview,
    burglaryEnabled,
    burglaryPreview,
    gitSingleEnabled,
    gitSinglePreview,
    gitAnnualEnabled,
    gitAnnualPreview,
    marineEnabled,
    marinePreview,
    motorCompPrivateEnabled,
    motorCompPrivatePreview,
    motorCompCommercialEnabled,
    motorCompCommercialPreview,
    motorTpoPrivateEnabled,
    motorTpoPrivatePreview,
    motorTpoCommercialEnabled,
    motorTpoCommercialPreview,
    gpaEnabled,
    gpaPreview,
    medicalEnabled,
    medicalPreview,
    tenderSecurityEnabled,
    tenderSecurityPreview,
    performanceBondEnabled,
    performanceBondPreview,
    apgEnabled,
    apgPreview,
    customsBondEnabled,
    customsBondPreview,
    t,
  ]);

  const handleCustomerChange = (newCustomerId: string) => {
    setCustomerId(newCustomerId);
    const newCustomer = customers.find((c) => c.id === newCustomerId);
    if (!newCustomer?.projects.some((p) => p.id === projectId)) {
      setProjectId("");
    }
  };

  const updateSection = (key: string, patch: Partial<SectionDraft>) => {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  };

  const updateItem = (sectionKey: string, itemKey: string, patch: Partial<ItemDraft>) => {
    setSections((prev) =>
      prev.map((s) =>
        s.key !== sectionKey
          ? s
          : { ...s, items: s.items.map((i) => (i.key === itemKey ? { ...i, ...patch } : i)) }
      )
    );
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    setSections((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!customerId) {
      setError(t.quotations.customerRequired);
      return;
    }
    const hasAnySection =
      sections.length > 0 ||
      carEnabled ||
      wibaEnabled ||
      elEnabled ||
      cpmEnabled ||
      plEnabled ||
      fireEnabled ||
      burglaryEnabled ||
      gitSingleEnabled ||
      gitAnnualEnabled ||
      marineEnabled ||
      motorCompPrivateEnabled ||
      motorCompCommercialEnabled ||
      motorTpoPrivateEnabled ||
      motorTpoCommercialEnabled ||
      gpaEnabled ||
      medicalEnabled ||
      tenderSecurityEnabled ||
      performanceBondEnabled ||
      apgEnabled ||
      customsBondEnabled;
    if (!hasAnySection) {
      setError(t.quotations.atLeastOneSection);
      return;
    }
    if (sections.some((s) => s.items.length === 0)) {
      setError(t.quotations.atLeastOneItem);
      return;
    }
    if (elEnabled && !wibaEnabled) {
      setError(t.quotations.elRequiresWiba);
      return;
    }

    const structuredSections: SectionInput[] = [];

    if (carEnabled) {
      const carType = insuranceTypeByCode.get("CAR");
      if (!carType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "CAR_PACKAGE",
        insuranceTypeId: carType.id,
        description: null,
        car: {
          projectName: carDraft.projectName || null,
          contractValue: carDraft.contractValue || null,
          carRate: carDraft.carRate || null,
          constructionPeriodMonths: carDraft.constructionPeriodMonths || null,
          maintenancePeriodMonths: carDraft.maintenancePeriodMonths || null,
          cpmValue: carDraft.cpmValue || null,
          cpmRate: carDraft.cpmRate || null,
          tplAnyOneClaim: carDraft.tplAnyOneClaim || null,
          tplAnyOneEvent: carDraft.tplAnyOneEvent || null,
          tplAnyOnePeriod: carDraft.tplAnyOnePeriod || null,
          tplRate: carDraft.tplRate || null,
          tplComplimentary: carDraft.tplComplimentary,
          pvtLoadingEnabled: carDraft.pvtLoadingEnabled,
          pvtLoadingRate: carDraft.pvtLoadingRate || null,
          pvtLoadingAmount: carDraft.pvtLoadingAmount || null,
        },
      });
    }

    if (wibaEnabled) {
      const wibaType = insuranceTypeByCode.get("WIBA");
      if (!wibaType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "WIBA",
        insuranceTypeId: wibaType.id,
        description: null,
        wiba: {
          wibaRate: wibaDraft.wibaRate || null,
          payrollRows: wibaDraft.payrollRows.map((r) => ({
            occupation: r.occupation,
            employeeCount: r.employeeCount || null,
            annualWages: r.annualWages || null,
            basicMonthlySalary: r.basicMonthlySalary || null,
            monthlyAllowance: r.monthlyAllowance || null,
          })),
        },
      });
    }

    if (elEnabled) {
      const elType = insuranceTypeByCode.get("EL");
      if (!elType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "EMPLOYERS_LIABILITY",
        insuranceTypeId: elType.id,
        description: null,
      });
    }

    if (cpmEnabled) {
      const cpmType = insuranceTypeByCode.get("CPM");
      if (!cpmType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "CPM_STANDALONE",
        insuranceTypeId: cpmType.id,
        description: null,
        cpm: {
          cpmRate: cpmDraft.cpmRate || null,
          pvtLoadingEnabled: cpmDraft.pvtLoadingEnabled,
          pvtLoadingRate: cpmDraft.pvtLoadingRate || null,
          equipmentRows: cpmDraft.equipmentRows.map((r) => ({
            equipmentName: r.equipmentName,
            quantity: r.quantity || null,
            unitValue: r.unitValue || null,
          })),
        },
      });
    }

    if (plEnabled) {
      const plType = insuranceTypeByCode.get("PL");
      if (!plType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "PUBLIC_LIABILITY",
        insuranceTypeId: plType.id,
        description: null,
        publicLiability: {
          anyOnePersonLimit: plDraft.anyOnePersonLimit || null,
          anyOneOccurrenceLimit: plDraft.anyOneOccurrenceLimit || null,
          anyOneYearLimit: plDraft.anyOneYearLimit || null,
          rate: plDraft.rate || null,
        },
      });
    }

    if (fireEnabled) {
      const fireType = insuranceTypeByCode.get("FIRE");
      if (!fireType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "FIRE_AND_PERILS",
        insuranceTypeId: fireType.id,
        description: null,
        fire: {
          propertyValue: fireDraft.propertyValue || null,
          rawMaterialValue: fireDraft.rawMaterialValue || null,
          goodsInStockValue: fireDraft.goodsInStockValue || null,
          rate: fireDraft.rate || null,
          earthquakeLoadingEnabled: fireDraft.earthquakeLoadingEnabled,
          floodLoadingEnabled: fireDraft.floodLoadingEnabled,
          pvtLoadingEnabled: fireDraft.pvtLoadingEnabled,
          pvtLoadingRate: fireDraft.pvtLoadingRate || null,
          pvtLoadingAmount: fireDraft.pvtLoadingAmount || null,
        },
      });
    }

    if (burglaryEnabled) {
      const burglaryType = insuranceTypeByCode.get("BURGLARY");
      if (!burglaryType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "BURGLARY",
        insuranceTypeId: burglaryType.id,
        description: null,
        burglary: {
          equipmentValue: burglaryDraft.equipmentValue || null,
          stockValue: burglaryDraft.stockValue || null,
          firstLossPercentage: burglaryDraft.firstLossPercentage || null,
          rate: burglaryDraft.rate || null,
        },
      });
    }

    if (gitSingleEnabled) {
      const gitSingleType = insuranceTypeByCode.get("GIT_SINGLE");
      if (!gitSingleType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "GIT_SINGLE",
        insuranceTypeId: gitSingleType.id,
        description: null,
        gitSingle: {
          cargoDescription: gitSingleDraft.cargoDescription,
          route: gitSingleDraft.route || null,
          sumInsured: gitSingleDraft.sumInsured || null,
          rate: gitSingleDraft.rate || null,
          pvtLoadingEnabled: gitSingleDraft.pvtLoadingEnabled,
          pvtLoadingRate: gitSingleDraft.pvtLoadingRate || null,
          pvtLoadingAmount: gitSingleDraft.pvtLoadingAmount || null,
        },
      });
    }

    if (gitAnnualEnabled) {
      const gitAnnualType = insuranceTypeByCode.get("GIT_ANNUAL");
      if (!gitAnnualType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "GIT_ANNUAL",
        insuranceTypeId: gitAnnualType.id,
        description: null,
        gitAnnual: {
          cargoDescription: gitAnnualDraft.cargoDescription,
          singleLimit: gitAnnualDraft.singleLimit || null,
          yearLimit: gitAnnualDraft.yearLimit || null,
          singleLimitRate: gitAnnualDraft.singleLimitRate || null,
          yearLimitRate: gitAnnualDraft.yearLimitRate || null,
          pvtLoadingEnabled: gitAnnualDraft.pvtLoadingEnabled,
          pvtLoadingRate: gitAnnualDraft.pvtLoadingRate || null,
          pvtLoadingAmount: gitAnnualDraft.pvtLoadingAmount || null,
        },
      });
    }

    if (marineEnabled) {
      const marineType = insuranceTypeByCode.get("MARINE");
      if (!marineType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "MARINE_COVER",
        insuranceTypeId: marineType.id,
        description: null,
        marine: {
          cargoDescription: marineDraft.cargoDescription || null,
          origin: marineDraft.origin || null,
          destination: marineDraft.destination || null,
          shipmentRows: marineDraft.shipmentRows.map((r) => ({
            referenceNo: r.referenceNo || null,
            sumInsured: r.sumInsured || null,
            rate: r.rate || null,
          })),
        },
      });
    }

    if (motorCompPrivateEnabled) {
      const motorType = insuranceTypeByCode.get("MOTOR_COMP_PRIVATE");
      if (!motorType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "MOTOR_COMP_PRIVATE",
        insuranceTypeId: motorType.id,
        description: null,
        motor: {
          plateNo: motorCompPrivateDraft.plateNo,
          vehicleValue: motorCompPrivateDraft.vehicleValue || null,
          periodFrom: motorCompPrivateDraft.periodFrom || null,
          periodTo: motorCompPrivateDraft.periodTo || null,
          excessProtector: motorCompPrivateDraft.excessProtector || null,
          pvt: motorCompPrivateDraft.pvt || null,
          rate: motorCompPrivateDraft.rate || null,
        },
      });
    }

    if (motorCompCommercialEnabled) {
      const motorType = insuranceTypeByCode.get("MOTOR_COMP_COMMERCIAL");
      if (!motorType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "MOTOR_COMP_COMMERCIAL",
        insuranceTypeId: motorType.id,
        description: null,
        motor: {
          plateNo: motorCompCommercialDraft.plateNo,
          vehicleValue: motorCompCommercialDraft.vehicleValue || null,
          periodFrom: motorCompCommercialDraft.periodFrom || null,
          periodTo: motorCompCommercialDraft.periodTo || null,
          excessProtector: motorCompCommercialDraft.excessProtector || null,
          pvt: motorCompCommercialDraft.pvt || null,
          rate: motorCompCommercialDraft.rate || null,
        },
      });
    }

    if (motorTpoPrivateEnabled) {
      const motorType = insuranceTypeByCode.get("MOTOR_TPO_PRIVATE");
      if (!motorType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "MOTOR_TPO_PRIVATE",
        insuranceTypeId: motorType.id,
        description: null,
        motor: {
          plateNo: motorTpoPrivateDraft.plateNo,
          basePremium: motorTpoPrivateDraft.basePremium || null,
          periodFrom: motorTpoPrivateDraft.periodFrom || null,
          periodTo: motorTpoPrivateDraft.periodTo || null,
        },
      });
    }

    if (motorTpoCommercialEnabled) {
      const motorType = insuranceTypeByCode.get("MOTOR_TPO_COMMERCIAL");
      if (!motorType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "MOTOR_TPO_COMMERCIAL",
        insuranceTypeId: motorType.id,
        description: null,
        motor: {
          plateNo: motorTpoCommercialDraft.plateNo,
          loadingCapacity: motorTpoCommercialDraft.loadingCapacity || null,
          basePremium: motorTpoCommercialDraft.basePremium || null,
          periodFrom: motorTpoCommercialDraft.periodFrom || null,
          periodTo: motorTpoCommercialDraft.periodTo || null,
        },
      });
    }

    if (gpaEnabled) {
      const gpaType = insuranceTypeByCode.get("GPA");
      if (!gpaType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "GROUP_PERSONAL_ACCIDENT",
        insuranceTypeId: gpaType.id,
        description: null,
        gpa: {
          deathLimit: gpaDraft.deathLimit || null,
          ptdLimit: gpaDraft.ptdLimit || null,
          ttdLimit: gpaDraft.ttdLimit || null,
          medicalLimit: gpaDraft.medicalLimit || null,
          funeralLimit: gpaDraft.funeralLimit || null,
          deathRate: gpaDraft.deathRate || null,
          ptdRate: gpaDraft.ptdRate || null,
          ttdRate: gpaDraft.ttdRate || null,
          medicalRate: gpaDraft.medicalRate || null,
          funeralRate: gpaDraft.funeralRate || null,
          numberOfPeople: gpaDraft.numberOfPeople || null,
        },
      });
    }

    if (medicalEnabled) {
      const medicalType = insuranceTypeByCode.get("MEDICAL");
      if (!medicalType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "GROUP_MEDICAL",
        insuranceTypeId: medicalType.id,
        description: null,
        medical: {
          inpatientLimit: medicalDraft.inpatientLimit || null,
          outpatientLimit: medicalDraft.outpatientLimit || null,
          categoryRows: medicalDraft.categoryRows.map((r) => ({
            category: r.category,
            employeeCount: r.employeeCount || null,
            inpatientRate: r.inpatientRate || null,
            outpatientRate: r.outpatientRate || null,
          })),
        },
      });
    }

    if (tenderSecurityEnabled) {
      const tenderType = insuranceTypeByCode.get("TENDER_SECURITY");
      if (!tenderType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "TENDER_SECURITY",
        insuranceTypeId: tenderType.id,
        description: null,
        guarantee: {
          projectName: tenderSecurityDraft.projectName,
          bondValue: tenderSecurityDraft.bondValue || null,
          rate: tenderSecurityDraft.rate || null,
        },
      });
    }

    if (performanceBondEnabled) {
      const pbType = insuranceTypeByCode.get("PERFORMANCE_BOND");
      if (!pbType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "PERFORMANCE_BOND",
        insuranceTypeId: pbType.id,
        description: null,
        guarantee: {
          projectName: performanceBondDraft.projectName,
          bondValue: performanceBondDraft.bondValue || null,
          rate: performanceBondDraft.rate || null,
        },
      });
    }

    if (apgEnabled) {
      const apgType = insuranceTypeByCode.get("APG");
      if (!apgType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "ADVANCE_PAYMENT_GUARANTEE",
        insuranceTypeId: apgType.id,
        description: null,
        guarantee: {
          projectName: apgDraft.projectName,
          bondValue: apgDraft.bondValue || null,
          rate: apgDraft.rate || null,
        },
      });
    }

    if (customsBondEnabled) {
      const customsBondType = insuranceTypeByCode.get("CUSTOMS_BOND");
      if (!customsBondType) {
        setError(t.quotations.insuranceTypeNotConfigured);
        return;
      }
      structuredSections.push({
        sectionKind: "CUSTOMS_BOND",
        insuranceTypeId: customsBondType.id,
        description: null,
        customsBond: {
          itemRows: customsBondDraft.itemRows.map((r) => ({
            bondType: r.bondType,
            bondValue: r.bondValue || null,
            rate: r.rate || null,
          })),
        },
      });
    }

    const genericSectionsPayload: SectionInput[] = sections.map((s) => ({
      sectionKind: "GENERIC",
      insuranceTypeId: s.insuranceTypeId,
      description: s.description,
      phcfRate: s.phcfRate,
      itlRate: s.itlRate,
      stampDuty: s.stampDuty,
      applyPHCF: s.applyPHCF,
      applyITL: s.applyITL,
      applyStampDuty: s.applyStampDuty,
      clausesSnapshot: s.clausesSnapshot,
      exclusionsSnapshot: s.exclusionsSnapshot,
      conditionsSnapshot: s.conditionsSnapshot,
      items: s.items.map((i) => ({
        insuredContent: i.insuredContent,
        sumInsured: i.sumInsured || null,
        rate: i.rate || null,
        calculationMethod: i.calculationMethod,
        premium: i.premium || null,
        notes: i.notes,
      })),
    }));

    const payload = {
      customerId,
      projectId: projectId || null,
      quotationDate,
      validUntil: validUntil || null,
      currency,
      internalNotes,
      sections: [...genericSectionsPayload, ...structuredSections],
    };

    setIsSubmitting(true);

    if (isEdit) {
      const result = await updateQuotationAction(quotation.id, payload);
      setIsSubmitting(false);
      if (!result.success) {
        const key = ERROR_KEY[result.error] ?? "genericError";
        setError(t.quotations[key as keyof typeof t.quotations]);
        return;
      }
      router.push(`/quotation/${quotation.id}`);
      return;
    }

    if (isStartingFirstQuotation) {
      const result = await startFirstQuotationAction(startFirstQuotationFor.quotationCaseId, payload);
      setIsSubmitting(false);
      if (!result.success) {
        const key = ERROR_KEY[result.error] ?? "genericError";
        setError(t.quotations[key as keyof typeof t.quotations]);
        return;
      }
      router.push(`/quotation/case/${startFirstQuotationFor.quotationCaseId}`);
      return;
    }

    setIsSubmitting(false);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "section") {
      setSections((prev) => prev.filter((s) => s.key !== deleteTarget.key));
    } else {
      setSections((prev) =>
        prev.map((s) =>
          s.key !== deleteTarget.sectionKey
            ? s
            : { ...s, items: s.items.filter((i) => i.key !== deleteTarget.itemKey) }
        )
      );
    }
    setDeleteTarget(null);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-section">
      <PageHeader
        title={isEdit ? t.quotations.editQuotationTitle : t.quotations.startFirstQuotationTitle}
        description={isEdit ? quotation.quotationNumber : undefined}
      />

      {insuranceTypes.length === 0 && (
        <div className="rounded-control border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">{t.quotations.insuranceTypesNotInitializedTitle}</p>
          <p>{t.quotations.insuranceTypesNotInitializedMessage}</p>
        </div>
      )}

      <Card>
        <h2 className="section-title mb-4">{t.quotations.quotationInformation}</h2>
        <div className="form-grid">
          <FormField label={t.quotations.customer}>
            <Select
              value={customerId}
              onChange={(e) => handleCustomerChange(e.target.value)}
              required
              disabled={isStartingFirstQuotation}
            >
              <option value="">{t.quotations.selectCustomer}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName} ({c.customerNumber})
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t.quotations.project}>
            <Select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={!customerId || isStartingFirstQuotation}
            >
              <option value="">{t.quotations.noProject}</option>
              {availableProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectName}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t.quotations.quotationDate}>
            <Input type="date" value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} required />
          </FormField>
          <FormField label={t.quotations.validUntil}>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </FormField>
          <FormField label={t.quotations.currency}>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </FormField>
        </div>
      </Card>

      <InsuranceTypeSelector selection={phase1Selection} onChange={handlePhase1SelectionChange} />

      {carEnabled && (
        <CollapsibleCard title={t.quotations.carPackage}>
          <CARSection draft={carDraft} onChange={(patch) => setCarDraft((prev) => ({ ...prev, ...patch }))} />
        </CollapsibleCard>
      )}

      {wibaEnabled && (
        <CollapsibleCard title={t.quotations.wibaType}>
          <WIBASection draft={wibaDraft} onChange={(patch) => setWibaDraft((prev) => ({ ...prev, ...patch }))} />
        </CollapsibleCard>
      )}

      {elEnabled && (
        <CollapsibleCard title={t.quotations.elType}>
          <ELSection wibaDraft={wibaDraft} />
        </CollapsibleCard>
      )}

      {cpmEnabled && (
        <CollapsibleCard title={t.quotations.cpmStandaloneType}>
          <CPMSection draft={cpmDraft} onChange={(patch) => setCpmDraft((prev) => ({ ...prev, ...patch }))} />
        </CollapsibleCard>
      )}

      {plEnabled && (
        <CollapsibleCard title={t.quotations.publicLiabilityType}>
          <PublicLiabilitySection draft={plDraft} onChange={(patch) => setPlDraft((prev) => ({ ...prev, ...patch }))} />
        </CollapsibleCard>
      )}

      {fireEnabled && (
        <CollapsibleCard title={t.quotations.fireAndPerilsType}>
          <FireSection draft={fireDraft} onChange={(patch) => setFireDraft((prev) => ({ ...prev, ...patch }))} />
        </CollapsibleCard>
      )}

      {burglaryEnabled && (
        <CollapsibleCard title={t.quotations.burglaryType}>
          <BurglarySection
            draft={burglaryDraft}
            onChange={(patch) => setBurglaryDraft((prev) => ({ ...prev, ...patch }))}
          />
        </CollapsibleCard>
      )}

      {gitSingleEnabled && (
        <CollapsibleCard title={t.quotations.gitSingleType}>
          <GITSingleSection
            draft={gitSingleDraft}
            onChange={(patch) => setGitSingleDraft((prev) => ({ ...prev, ...patch }))}
          />
        </CollapsibleCard>
      )}

      {gitAnnualEnabled && (
        <CollapsibleCard title={t.quotations.gitAnnualType}>
          <GITAnnualSection
            draft={gitAnnualDraft}
            onChange={(patch) => setGitAnnualDraft((prev) => ({ ...prev, ...patch }))}
          />
        </CollapsibleCard>
      )}

      {marineEnabled && (
        <CollapsibleCard title={t.quotations.marineCoverType}>
          <MarineSection draft={marineDraft} onChange={(patch) => setMarineDraft((prev) => ({ ...prev, ...patch }))} />
        </CollapsibleCard>
      )}

      {motorCompPrivateEnabled && (
        <CollapsibleCard title={t.quotations.motorCompPrivateType}>
          <MotorComprehensiveSection
            draft={motorCompPrivateDraft}
            onChange={(patch) => setMotorCompPrivateDraft((prev) => ({ ...prev, ...patch }))}
            datalistId="motor-comp-private-text-options"
          />
        </CollapsibleCard>
      )}

      {motorCompCommercialEnabled && (
        <CollapsibleCard title={t.quotations.motorCompCommercialType}>
          <MotorComprehensiveSection
            draft={motorCompCommercialDraft}
            onChange={(patch) => setMotorCompCommercialDraft((prev) => ({ ...prev, ...patch }))}
            datalistId="motor-comp-commercial-text-options"
          />
        </CollapsibleCard>
      )}

      {motorTpoPrivateEnabled && (
        <CollapsibleCard title={t.quotations.motorTpoPrivateType}>
          <MotorTpoSection
            draft={motorTpoPrivateDraft}
            onChange={(patch) => setMotorTpoPrivateDraft((prev) => ({ ...prev, ...patch }))}
            showLoadingCapacity={false}
          />
        </CollapsibleCard>
      )}

      {motorTpoCommercialEnabled && (
        <CollapsibleCard title={t.quotations.motorTpoCommercialType}>
          <MotorTpoSection
            draft={motorTpoCommercialDraft}
            onChange={(patch) => setMotorTpoCommercialDraft((prev) => ({ ...prev, ...patch }))}
            showLoadingCapacity
          />
        </CollapsibleCard>
      )}

      {gpaEnabled && (
        <CollapsibleCard title={t.quotations.gpaType}>
          <GPASection draft={gpaDraft} onChange={(patch) => setGpaDraft((prev) => ({ ...prev, ...patch }))} />
        </CollapsibleCard>
      )}

      {medicalEnabled && (
        <CollapsibleCard title={t.quotations.medicalType}>
          <MedicalSection draft={medicalDraft} onChange={(patch) => setMedicalDraft((prev) => ({ ...prev, ...patch }))} />
        </CollapsibleCard>
      )}

      {tenderSecurityEnabled && (
        <CollapsibleCard title={t.quotations.tenderSecurityType}>
          <GuaranteeSection
            draft={tenderSecurityDraft}
            onChange={(patch) => setTenderSecurityDraft((prev) => ({ ...prev, ...patch }))}
          />
        </CollapsibleCard>
      )}

      {performanceBondEnabled && (
        <CollapsibleCard title={t.quotations.performanceBondType}>
          <GuaranteeSection
            draft={performanceBondDraft}
            onChange={(patch) => setPerformanceBondDraft((prev) => ({ ...prev, ...patch }))}
          />
        </CollapsibleCard>
      )}

      {apgEnabled && (
        <CollapsibleCard title={t.quotations.apgType}>
          <GuaranteeSection draft={apgDraft} onChange={(patch) => setApgDraft((prev) => ({ ...prev, ...patch }))} />
        </CollapsibleCard>
      )}

      {customsBondEnabled && (
        <CollapsibleCard title={t.quotations.customsBondType}>
          <CustomsBondSection
            draft={customsBondDraft}
            onChange={(patch) => setCustomsBondDraft((prev) => ({ ...prev, ...patch }))}
          />
        </CollapsibleCard>
      )}

      {sections.length > 0 && (
      <Card>
        <div className="mb-4">
          <h2 className="section-title">{t.quotations.insuranceSections}</h2>
          <p className="text-secondary mt-1">{t.quotations.legacySectionsHint}</p>
        </div>

        <div className="flex flex-col gap-4">
          {sections.map((section, sectionIndex) => {
            const totals = sectionTotalsByKey.get(section.key)!;
            return (
              <div key={section.key} className="rounded-control border border-zinc-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="table-title">{section.insuranceTypeNameSnapshot}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="btn-icon"
                      disabled={sectionIndex === 0}
                      onClick={() => moveSection(sectionIndex, -1)}
                      title={t.quotations.moveUp}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon"
                      disabled={sectionIndex === sections.length - 1}
                      onClick={() => moveSection(sectionIndex, 1)}
                      title={t.quotations.moveDown}
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon text-red-500 hover:bg-red-50"
                      onClick={() => setDeleteTarget({ type: "section", key: section.key })}
                      title={t.quotations.deleteSection}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <FormField label={t.quotations.description}>
                  <Input
                    value={section.description}
                    onChange={(e) => updateSection(section.key, { description: e.target.value })}
                  />
                </FormField>

                <div className="form-grid mt-field">
                  <FormField label={t.quotations.phcfRate}>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={section.phcfRate}
                        onChange={(e) => updateSection(section.key, { phcfRate: e.target.value })}
                        disabled={!section.applyPHCF}
                      />
                      <label className="flex items-center gap-1 whitespace-nowrap text-sm text-zinc-600">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
                          checked={section.applyPHCF}
                          onChange={(e) => updateSection(section.key, { applyPHCF: e.target.checked })}
                        />
                        {t.quotations.applyPHCF}
                      </label>
                    </div>
                  </FormField>
                  <FormField label={t.quotations.itlRate}>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={section.itlRate}
                        onChange={(e) => updateSection(section.key, { itlRate: e.target.value })}
                        disabled={!section.applyITL}
                      />
                      <label className="flex items-center gap-1 whitespace-nowrap text-sm text-zinc-600">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
                          checked={section.applyITL}
                          onChange={(e) => updateSection(section.key, { applyITL: e.target.checked })}
                        />
                        {t.quotations.applyITL}
                      </label>
                    </div>
                  </FormField>
                  <FormField label={t.quotations.stampDuty}>
                    <div className="flex items-center gap-2">
                      <MoneyInput
                        value={section.stampDuty}
                        onChange={(v) => updateSection(section.key, { stampDuty: v })}
                        disabled={!section.applyStampDuty}
                      />
                      <label className="flex items-center gap-1 whitespace-nowrap text-sm text-zinc-600">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
                          checked={section.applyStampDuty}
                          onChange={(e) => updateSection(section.key, { applyStampDuty: e.target.checked })}
                        />
                        {t.quotations.applyStampDuty}
                      </label>
                    </div>
                  </FormField>
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="table-title">{t.quotations.coverageItems}</span>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        updateSection(section.key, { items: [...section.items, emptyItem()] })
                      }
                    >
                      <Plus size={16} />
                      {t.quotations.addCoverageItem}
                    </Button>
                  </div>

                  {section.items.length === 0 && (
                    <p className="text-secondary">{t.quotations.noItemsYet}</p>
                  )}

                  <div className="flex flex-col gap-3">
                    {section.items.map((item) => (
                      <div key={item.key} className="rounded-control border border-zinc-100 bg-zinc-50/60 p-3">
                        <div className="form-grid">
                          <FormField label={t.quotations.insuredContent}>
                            <Input
                              value={item.insuredContent}
                              onChange={(e) =>
                                updateItem(section.key, item.key, { insuredContent: e.target.value })
                              }
                              required
                            />
                          </FormField>
                          <FormField label={t.quotations.calculationMethod}>
                            <Select
                              value={item.calculationMethod}
                              onChange={(e) =>
                                updateItem(section.key, item.key, {
                                  calculationMethod: e.target.value as CalculationMethod,
                                })
                              }
                            >
                              {(["PERCENTAGE", "FIXED_PREMIUM", "MANUAL_PREMIUM"] as CalculationMethod[]).map(
                                (m) => (
                                  <option key={m} value={m}>
                                    {calculationMethodLabel[m]}
                                  </option>
                                )
                              )}
                            </Select>
                          </FormField>
                          <FormField label={t.quotations.sumInsured}>
                            <MoneyInput
                              value={item.sumInsured}
                              onChange={(v) => updateItem(section.key, item.key, { sumInsured: v })}
                              disabled={item.calculationMethod === "FIXED_PREMIUM"}
                            />
                          </FormField>
                          <FormField label={t.quotations.rate}>
                            <Input
                              type="number"
                              step="0.0001"
                              min="0"
                              value={item.rate}
                              onChange={(e) => updateItem(section.key, item.key, { rate: e.target.value })}
                              disabled={item.calculationMethod === "FIXED_PREMIUM"}
                            />
                          </FormField>
                          <FormField label={t.quotations.premium}>
                            <MoneyInput
                              value={
                                item.calculationMethod === "PERCENTAGE"
                                  ? computeItemPremium(item).toFixed(2)
                                  : item.premium
                              }
                              onChange={(v) => updateItem(section.key, item.key, { premium: v })}
                              disabled={item.calculationMethod === "PERCENTAGE"}
                            />
                          </FormField>
                          <FormField label={t.quotations.notes}>
                            <Input
                              value={item.notes}
                              onChange={(e) => updateItem(section.key, item.key, { notes: e.target.value })}
                            />
                          </FormField>
                        </div>
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            className="btn-icon text-red-500 hover:bg-red-50"
                            onClick={() =>
                              setDeleteTarget({ type: "item", sectionKey: section.key, itemKey: item.key })
                            }
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4">
                  <FormField label={t.quotations.clauses}>
                    <Textarea
                      value={section.clausesSnapshot}
                      onChange={(e) => updateSection(section.key, { clausesSnapshot: e.target.value })}
                    />
                  </FormField>
                </div>
                <div className="mt-field">
                  <FormField label={t.quotations.exclusions}>
                    <Textarea
                      value={section.exclusionsSnapshot}
                      onChange={(e) => updateSection(section.key, { exclusionsSnapshot: e.target.value })}
                    />
                  </FormField>
                </div>
                <div className="mt-field">
                  <FormField label={t.quotations.conditions}>
                    <Textarea
                      value={section.conditionsSnapshot}
                      onChange={(e) => updateSection(section.key, { conditionsSnapshot: e.target.value })}
                    />
                  </FormField>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 rounded-control bg-zinc-50 p-3 text-sm sm:grid-cols-4">
                  <div>
                    <div className="text-secondary">{t.quotations.premium}</div>
                    <div className="font-medium text-zinc-800">{formatMoney(totals.basePremium)}</div>
                  </div>
                  <div>
                    <div className="text-secondary">{t.quotations.phcf}</div>
                    <div className="font-medium text-zinc-800">{formatMoney(totals.phcfAmount)}</div>
                  </div>
                  <div>
                    <div className="text-secondary">{t.quotations.itl}</div>
                    <div className="font-medium text-zinc-800">{formatMoney(totals.itlAmount)}</div>
                  </div>
                  <div>
                    <div className="text-secondary">{t.quotations.sectionTotal}</div>
                    <div className="font-semibold text-emerald-800">{formatMoney(totals.sectionTotal)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      )}

      <QuotationSummary lines={summaryLines} currency={currency} />

      <Card>
        <h2 className="section-title mb-4">{t.quotations.financialSummary}</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <div>
            <div className="text-secondary">{t.quotations.subtotalPremium}</div>
            <div className="text-body font-medium">{formatMoney(quotationTotals.subtotalPremium)}</div>
          </div>
          <div>
            <div className="text-secondary">{t.quotations.totalPHCF}</div>
            <div className="text-body font-medium">{formatMoney(quotationTotals.totalPHCF)}</div>
          </div>
          <div>
            <div className="text-secondary">{t.quotations.totalITL}</div>
            <div className="text-body font-medium">{formatMoney(quotationTotals.totalITL)}</div>
          </div>
          <div>
            <div className="text-secondary">{t.quotations.totalStampDuty}</div>
            <div className="text-body font-medium">{formatMoney(quotationTotals.totalStampDuty)}</div>
          </div>
          <div>
            <div className="text-secondary">{t.quotations.grandTotal}</div>
            <div className="text-lg font-semibold text-emerald-800">
              {currency} {formatMoney(quotationTotals.grandTotal)}
            </div>
          </div>
        </div>
      </Card>

      {sections.length > 0 && (
        <Card>
          <h2 className="section-title mb-4">{t.quotations.termsAndConditions}</h2>
          <div className="flex flex-col gap-4">
            {sections.map((section) => (
              <div key={section.key}>
                <p className="table-title mb-1">{section.insuranceTypeNameSnapshot}</p>
                <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <dt className="text-secondary">{t.quotations.clauses}</dt>
                    <dd className="text-body whitespace-pre-wrap">{section.clausesSnapshot || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-secondary">{t.quotations.exclusions}</dt>
                    <dd className="text-body whitespace-pre-wrap">{section.exclusionsSnapshot || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-secondary">{t.quotations.conditions}</dt>
                    <dd className="text-body whitespace-pre-wrap">{section.conditionsSnapshot || "—"}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </Card>
      )}

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            router.push(
              isEdit
                ? `/quotation/${quotation.id}`
                : isStartingFirstQuotation
                  ? `/quotation/case/${startFirstQuotationFor.quotationCaseId}`
                  : "/quotation"
            )
          }
          disabled={isSubmitting}
        >
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t.common.save}
        </Button>
      </div>

      {deleteTarget?.type === "section" && (
        <ConfirmDialog
          title={t.quotations.confirmDeleteSection}
          message={t.quotations.confirmDeleteSectionMessage}
          isSubmitting={false}
          onConfirm={confirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      {deleteTarget?.type === "item" && (
        <ConfirmDialog
          title={t.quotations.confirmDeleteItem}
          message={t.quotations.confirmDeleteItemMessage}
          isSubmitting={false}
          onConfirm={confirmDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </form>
  );
}
