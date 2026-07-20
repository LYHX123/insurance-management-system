// Maps a fully-loaded quotation (raw Prisma shape, including every computed
// breakdown field already stored on each *SectionDetail model) into a flat
// placeholder-name -> value dictionary per section. This module is
// deliberately decoupled from the client-facing QuotationDetail/SectionRow
// types in src/components/quotations/types.ts — those only expose the
// subset of fields the web UI needs, while the Excel template needs the
// full computed breakdown (e.g. CAR's carBasicPremium, tplGrossPremium,
// etc.) that already exists as real columns on the Prisma models. Values
// here are plain app-convention numbers/strings/booleans — no /100 rate
// conversion and no Excel number-format concerns happen in this module;
// that is replaceVariables.ts's job, driven by each StaticVariable's `kind`.

import type { Prisma } from "@/generated/prisma/client";
import type { TemplateSectionKind } from "./types";
import { deriveMarineBasicSumInsured, deriveMarineIncidentalLoading } from "@/lib/insuranceCalculations/marine";
import { roundMoney, toDecimal } from "@/lib/money";

export type QuotationForExport = Prisma.QuotationGetPayload<{
  include: {
    customer: { select: { companyName: true } };
    project: { select: { projectName: true } };
    sections: {
      include: {
        items: true;
        carDetail: true;
        wibaDetail: { include: { payrollRows: true } };
        elDetail: true;
        cpmDetail: { include: { equipmentRows: true } };
        publicLiabilityDetail: true;
        fireDetail: true;
        burglaryDetail: true;
        gitSingleDetail: true;
        gitAnnualDetail: true;
        marineDetail: { include: { shipmentRows: true } };
        motorCompPrivateDetail: true;
        motorCompCommercialDetail: true;
        motorTpoPrivateDetail: true;
        motorTpoCommercialDetail: true;
        gpaDetail: true;
        medicalDetail: { include: { categoryRows: true } };
        tenderSecurityDetail: true;
        performanceBondDetail: true;
        advancePaymentGuaranteeDetail: true;
        customsBondDetail: { include: { itemRows: true } };
      };
    };
  };
}>;

export type PlaceholderValue = string | number | boolean | null;
export type PlaceholderValues = Record<string, PlaceholderValue>;

export type MappedSection = {
  kind: TemplateSectionKind;
  values: PlaceholderValues;
  /** One object per dynamic data row, keyed by the dynamic column placeholder names. */
  dynamicRows?: PlaceholderValues[];
};

export type MappedQuotation = {
  common: PlaceholderValues;
  sections: MappedSection[];
  /** Server-calculated grand total — the value the generated workbook's total MUST equal exactly. */
  grandTotal: number;
};

function num(d: Prisma.Decimal | number | null | undefined): number {
  if (d === null || d === undefined) return 0;
  return typeof d === "number" ? d : d.toNumber();
}

function numOrNull(d: Prisma.Decimal | number | null | undefined): number | null {
  if (d === null || d === undefined) return null;
  return typeof d === "number" ? d : d.toNumber();
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

type Section = QuotationForExport["sections"][number];

function mapCar(section: Section): MappedSection | null {
  const d = section.carDetail;
  if (!d) return null;
  return {
    kind: "CAR_PACKAGE",
    values: {
      project_name: d.projectName ?? "",
      car_contract_value: num(d.contractValue),
      car_rate: num(d.carRate),
      car_premium: num(d.carBasicPremium),
      car_construction_period_months: num(d.constructionPeriodMonths),
      car_maintenance_period_months: num(d.maintenancePeriodMonths),
      cpm_value: numOrNull(d.cpmValue),
      cpm_rate: numOrNull(d.cpmRate),
      cpm_premium: num(d.carCpmPremium),
      tpl_any_one_claim: numOrNull(d.tplAnyOneClaim),
      tpl_any_one_event: numOrNull(d.tplAnyOneEvent),
      tpl_any_one_period: numOrNull(d.tplAnyOnePeriod),
      tpl_rate: numOrNull(d.tplRate),
      tpl_premium: num(d.tplGrossPremium),
      car_pvt_loading_amount: d.pvtLoadingEnabled ? num(d.pvtLoadingAmount) : null,
      car_pvt_loading_rate: numOrNull(d.pvtLoadingRate),
      car_pvt_loading_premium: d.pvtLoadingEnabled ? num(d.pvtLoadingPremium) : null,
      car_gross_premium: num(section.basePremium),
      car_phcf: num(section.phcfAmount),
      car_itl: num(section.itlAmount),
      car_stamp_duty: num(section.stampDuty),
      car_total_premium: num(section.sectionTotal),
    },
  };
}

function mapWiba(section: Section): MappedSection | null {
  const d = section.wibaDetail;
  if (!d) return null;
  return {
    kind: "WIBA",
    values: {
      wiba_employee_count: d.totalEmployeeCount,
      wiba_total_wages: num(d.totalAnnualWages),
      wiba_rate: num(d.wibaRate),
      wiba_gross_premium: num(d.grossPremium),
      wiba_phcf: num(d.phcfAmount),
      wiba_itl: num(d.itlAmount),
      wiba_stamp_duty: num(d.stampDutyAmount),
      wiba_total_premium: num(d.totalPremium),
    },
    // "Occupation" + exactly three spaces + "EmployeeCount" — no tab,
    // dash, colon, or "employees" suffix. Column B keeps showing that
    // row's own Annual Salary, one row per occupation.
    dynamicRows: d.payrollRows.map((row) => ({
      wiba_occupation: `${row.occupation}   ${row.employeeCount}`,
      wiba_annual_wages: num(row.annualWages),
    })),
  };
}

function mapEl(section: Section): MappedSection | null {
  const d = section.elDetail;
  if (!d) return null;
  return {
    kind: "EMPLOYERS_LIABILITY",
    values: {
      el_gross_premium: num(d.grossPremium),
      el_phcf: num(d.phcfAmount),
      el_itl: num(d.itlAmount),
      el_stamp_duty: num(d.stampDutyAmount),
      el_total_premium: num(d.totalPremium),
    },
  };
}

function mapCpm(section: Section): MappedSection | null {
  const d = section.cpmDetail;
  if (!d) return null;
  return {
    kind: "CPM_STANDALONE",
    values: {
      // cpm_sum_insured/cpm_rate/cpm_basic_premium are the section-level
      // aggregate (all equipment rows summed, one rate applied once), shown
      // on the fixed "TOTAL VALUE" row — cpm_total_value is a different,
      // per-row placeholder (see dynamicRows below). cpm_sum_insured comes
      // from cpmDetail's own snapshotted totalSumInsured (the same
      // calculateCpmStandalone() result basicPremium/grossPremium etc. were
      // derived from), not summed again from equipmentRows here, so Excel
      // can never disagree with the saved calculation.
      cpm_sum_insured: num(d.totalSumInsured),
      cpm_rate: num(d.cpmRate),
      cpm_basic_premium: num(d.basicPremium),
      cpm_pvt_loading_amount: d.pvtLoadingEnabled ? num(d.pvtLoadingAmount) : null,
      cpm_pvt_loading_rate: numOrNull(d.pvtLoadingRate),
      cpm_pvt_loading_premium: d.pvtLoadingEnabled ? num(d.pvtLoadingPremium) : null,
      cpm_gross_premium: num(d.grossPremium),
      cpm_phcf: num(d.phcfAmount),
      cpm_itl: num(d.itlAmount),
      cpm_stamp_duty: num(d.stampDutyAmount),
      cpm_total_premium: num(d.totalPremium),
    },
    // "Equipment Name" + exactly three spaces + "Quantity" — no tab, no
    // parentheses/dash/colon/"Qty" suffix. cpm_total_value is that row's
    // own quantity x unitValue (already snapshotted as totalValue at save
    // time), one equipment per row, in entry order.
    dynamicRows: d.equipmentRows.map((row) => ({
      cpm_equipment: `${row.equipmentName}   ${row.quantity}`,
      cpm_total_value: num(row.totalValue),
    })),
  };
}

function mapPublicLiability(section: Section): MappedSection | null {
  const d = section.publicLiabilityDetail;
  if (!d) return null;
  return {
    kind: "PUBLIC_LIABILITY",
    values: {
      pl_any_one_person: numOrNull(d.anyOnePersonLimit),
      pl_any_one_occurrence: numOrNull(d.anyOneOccurrenceLimit),
      pl_any_one_year: num(d.anyOneYearLimit),
      pl_rate: num(d.rate),
      pl_gross_premium: num(d.grossPremium),
      pl_phcf: num(d.phcfAmount),
      pl_itl: num(d.itlAmount),
      pl_stamp_duty: num(d.stampDutyAmount),
      pl_total_premium: num(d.totalPremium),
    },
  };
}

function mapFire(section: Section): MappedSection | null {
  const d = section.fireDetail;
  if (!d) return null;
  return {
    kind: "FIRE_AND_PERILS",
    values: {
      fire_property_value: num(d.propertyValue),
      fire_raw_material_value: num(d.rawMaterialValue),
      fire_goods_in_stock_value: num(d.goodsInStockValue),
      fire_total_sum_insured: num(d.totalSumInsured),
      fire_rate: num(d.rate),
      fire_basic_premium: num(d.basicPremium),
      // Earthquake/Flood Loading Rate are no longer placeholders in the
      // template (fixed business rates, not shown as an editable number) —
      // only the resulting amount is mapped, and only when enabled, same
      // null-when-off convention as fire_pvt_loading_amount below.
      fire_earthquake_loading_amount: d.earthquakeLoadingEnabled ? num(d.earthquakeLoadingAmount) : null,
      fire_flood_loading_amount: d.floodLoadingEnabled ? num(d.floodLoadingAmount) : null,
      fire_pvt_loading_amount: d.pvtLoadingEnabled ? num(d.pvtLoadingAmount) : null,
      fire_pvt_loading_rate: numOrNull(d.pvtLoadingRate),
      fire_pvt_loading_premium: d.pvtLoadingEnabled ? num(d.pvtLoadingPremium) : null,
      fire_gross_premium: num(d.grossPremium),
      fire_phcf: num(d.phcfAmount),
      fire_itl: num(d.itlAmount),
      fire_stamp_duty: num(d.stampDutyAmount),
      fire_total_premium: num(d.totalPremium),
    },
  };
}

function mapBurglary(section: Section): MappedSection | null {
  const d = section.burglaryDetail;
  if (!d) return null;
  return {
    kind: "BURGLARY",
    values: {
      burglary_equipment_value: num(d.equipmentValue),
      burglary_stock_value: num(d.stockValue),
      burglary_total_value: num(d.totalValue),
      burglary_rate: num(d.rate),
      burglary_first_loss_sum_insured: num(d.firstLossSumInsured),
      burglary_first_loss_percentage: num(d.firstLossPercentage),
      burglary_gross_premium: num(d.grossPremium),
      burglary_phcf: num(d.phcfAmount),
      burglary_itl: num(d.itlAmount),
      burglary_stamp_duty: num(d.stampDutyAmount),
      burglary_total_premium: num(d.totalPremium),
    },
  };
}

function mapGitSingle(section: Section): MappedSection | null {
  const d = section.gitSingleDetail;
  if (!d) return null;
  return {
    kind: "GIT_SINGLE",
    values: {
      git_cargo_description: d.cargoDescription,
      git_route: d.route ?? "",
      git_sum_insured: num(d.sumInsured),
      git_rate: num(d.rate),
      git_basic_premium: num(d.basicPremium),
      git_single_pvt_loading_amount: d.pvtLoadingEnabled ? num(d.pvtLoadingAmount) : null,
      git_single_pvt_loading_rate: numOrNull(d.pvtLoadingRate),
      git_single_pvt_loading_premium: d.pvtLoadingEnabled ? num(d.pvtLoadingPremium) : null,
      git_gross_premium: num(d.grossPremium),
      git_phcf: num(d.phcfAmount),
      git_itl: num(d.itlAmount),
      git_stamp_duty: num(d.stampDutyAmount),
      git_total_premium: num(d.totalPremium),
    },
  };
}

function mapGitAnnual(section: Section): MappedSection | null {
  const d = section.gitAnnualDetail;
  if (!d) return null;
  return {
    kind: "GIT_ANNUAL",
    values: {
      git_annual_cargo_description: d.cargoDescription,
      git_annual_single_limit: num(d.singleLimit),
      git_annual_single_rate: num(d.singleLimitRate),
      git_annual_single_premium: num(d.singlePremium),
      git_annual_year_limit: num(d.yearLimit),
      git_annual_year_rate: num(d.yearLimitRate),
      git_annual_year_premium: num(d.yearPremium),
      git_annual_total_limit: num(d.singleLimit) + num(d.yearLimit),
      git_annual_pvt_loading_amount: d.pvtLoadingEnabled ? num(d.pvtLoadingAmount) : null,
      git_annual_pvt_loading_rate: numOrNull(d.pvtLoadingRate),
      git_annual_pvt_loading_premium: d.pvtLoadingEnabled ? num(d.pvtLoadingPremium) : null,
      git_annual_gross_premium: num(d.grossPremium),
      git_annual_phcf: num(d.phcfAmount),
      git_annual_itl: num(d.itlAmount),
      git_annual_stamp_duty: num(d.stampDutyAmount),
      git_annual_total_premium: num(d.totalPremium),
    },
  };
}

function mapMarine(section: Section): MappedSection | null {
  const d = section.marineDetail;
  if (!d) return null;

  // Incidental Loading / Basic Sum Insured are not their own DB columns —
  // they are a pure deterministic function of each row's persisted
  // sumInsured (10% loading, see marine.ts's deriveMarine* helpers), so
  // re-deriving them here always agrees with what was computed at save
  // time, including for rows saved before this Excel mapping existed.
  // totalBasicSumInsured is summed from those same per-row values (the new
  // Total row's basis), never approximated from totalSumInsured.
  const totalBasicSumInsured = roundMoney(
    d.shipmentRows.reduce((acc, row) => acc.plus(deriveMarineBasicSumInsured(row.sumInsured)), toDecimal(0))
  );

  return {
    kind: "MARINE_COVER",
    values: {
      marine_cargo_description: d.cargoDescription ?? "",
      marine_origin: d.origin ?? "",
      marine_destination: d.destination ?? "",
      // Legacy compat value only — the current template has no live
      // {{marine_total_sum_insured}} placeholder (see config.ts's
      // MARINE_COVER notes), so this key is simply unused by
      // replaceVariables.ts, not written anywhere.
      marine_total_sum_insured: num(d.totalSumInsured),
      marine_total_basic_sum_insured: num(totalBasicSumInsured),
      marine_gross_premium: num(d.grossPremium),
      marine_phcf: num(d.phcfAmount),
      marine_itl: num(d.itlAmount),
      marine_stamp_duty: num(d.marineStampDutyAmount),
      marine_total_premium: num(d.totalPremium),
    },
    dynamicRows: d.shipmentRows.map((row) => ({
      marine_reference_no: row.referenceNo ?? "",
      marine_sum_insured: num(row.sumInsured),
      marine_incidental_loading: num(deriveMarineIncidentalLoading(row.sumInsured)),
      marine_basic_sum_insured: num(deriveMarineBasicSumInsured(row.sumInsured)),
      // App convention: 0.25 means 0.25%, but the dynamic-row write path
      // (fillDynamicRows.ts) does not apply the /100 "rate" conversion that
      // replaceVariables.ts does for static variables — divided here so the
      // %-formatted cell displays 0.25%, not 25%.
      marine_rate: num(row.rate) / 100,
      marine_line_premium: num(row.linePremium),
    })),
  };
}

function mapMotorComprehensive(
  kind: "MOTOR_COMP_PRIVATE" | "MOTOR_COMP_COMMERCIAL",
  section: Section,
  detail: Section["motorCompPrivateDetail"]
): MappedSection | null {
  if (!detail) return null;
  return {
    kind,
    values: {
      motor_plate_no: detail.plateNo,
      motor_vehicle_value: num(detail.vehicleValue),
      motor_rate: num(detail.rate),
      motor_gross_premium: num(detail.grossPremium),
      motor_excess_protector: detail.excessProtector ?? "",
      motor_pvt: detail.pvt ?? "",
      motor_period_from: formatDate(detail.periodFrom),
      motor_period_to: formatDate(detail.periodTo),
      motor_phcf: num(detail.phcfAmount),
      motor_itl: num(detail.itlAmount),
      motor_stamp_duty: num(detail.stampDutyAmount),
      motor_total_premium: num(detail.totalPremium),
    },
  };
}

function mapMotorTpo(
  kind: "MOTOR_TPO_PRIVATE" | "MOTOR_TPO_COMMERCIAL",
  detail: Section["motorTpoPrivateDetail"]
): MappedSection | null {
  if (!detail) return null;
  return {
    kind,
    values: {
      motor_plate_no: detail.plateNo,
      motor_loading_capacity: "loadingCapacity" in detail ? numOrNull((detail as { loadingCapacity: Prisma.Decimal }).loadingCapacity) : null,
      motor_tpo_base_premium: num(detail.basePremium),
      motor_gross_premium: num(detail.grossPremium),
      motor_period_from: formatDate(detail.periodFrom),
      motor_period_to: formatDate(detail.periodTo),
      motor_phcf: num(detail.phcfAmount),
      motor_itl: num(detail.itlAmount),
      motor_stamp_duty: num(detail.stampDutyAmount),
      motor_total_premium: num(detail.totalPremium),
    },
  };
}

function mapGpa(section: Section): MappedSection | null {
  const d = section.gpaDetail;
  if (!d) return null;
  return {
    kind: "GROUP_PERSONAL_ACCIDENT",
    values: {
      gpa_death_limit: num(d.deathLimit),
      gpa_death_rate: num(d.deathRate),
      gpa_death_premium: num(d.deathPremium),
      gpa_ptd_limit: num(d.ptdLimit),
      gpa_ptd_rate: num(d.ptdRate),
      gpa_ptd_premium: num(d.ptdPremium),
      gpa_ttd_limit: num(d.ttdLimit),
      gpa_ttd_rate: num(d.ttdRate),
      gpa_ttd_premium: num(d.ttdPremium),
      gpa_medical_limit: num(d.medicalLimit),
      gpa_medical_rate: num(d.medicalRate),
      gpa_medical_premium: num(d.medicalPremium),
      gpa_funeral_limit: num(d.funeralLimit),
      gpa_funeral_rate: num(d.funeralRate),
      gpa_funeral_premium: num(d.funeralPremium),
      gpa_per_person_premium: num(d.premiumPerPerson),
      gpa_number_of_people: d.numberOfPeople,
      gpa_total_basic_premium: num(d.grossPremium),
      gpa_gross_premium: num(d.grossPremium),
      gpa_phcf: num(d.phcfAmount),
      gpa_itl: num(d.itlAmount),
      gpa_stamp_duty: num(d.stampDutyAmount),
      gpa_total_premium: num(d.totalPremium),
    },
  };
}

const MEDICAL_SUFFIX: Record<string, string> = {
  M: "m",
  M_PLUS_1: "m1",
  M_PLUS_2: "m2",
  M_PLUS_3: "m3",
  M_PLUS_4: "m4",
  M_PLUS_5: "m5",
};

function mapMedical(section: Section): MappedSection | null {
  const d = section.medicalDetail;
  if (!d) return null;
  const values: PlaceholderValues = {
    medical_inpatient_limit: num(d.inpatientLimit),
    medical_outpatient_limit: num(d.outpatientLimit),
    medical_inpatient_premium: num(d.inpatientPremium),
    medical_outpatient_premium: num(d.outpatientPremium),
    medical_subtotal: num(d.subtotal),
    medical_gross_premium: num(d.grossPremium),
    medical_employee_count: d.employeeCount,
    medical_phcf: num(d.phcfAmount),
    medical_itl: num(d.itlAmount),
    medical_stamp_duty: num(d.stampDutyAmount),
    medical_total_premium: num(d.totalPremium),
  };
  for (const row of d.categoryRows) {
    const suffix = MEDICAL_SUFFIX[row.category];
    if (!suffix) continue;
    values[`medical_inpatient_${suffix}_rate`] = num(row.inpatientRate);
    values[`medical_outpatient_${suffix}_rate`] = num(row.outpatientRate);
    values[`medical_${suffix}_count`] = row.employeeCount;
  }
  return { kind: "GROUP_MEDICAL", values };
}

function mapTenderSecurity(section: Section): MappedSection | null {
  const d = section.tenderSecurityDetail;
  if (!d) return null;
  return {
    kind: "TENDER_SECURITY",
    values: {
      bond_project_name: d.projectName,
      bond_value: num(d.bondValue),
      bond_rate: num(d.rate),
      bond_premium: num(d.grossPremium),
      bond_gross_premium: num(d.grossPremium),
      bond_phcf: num(d.phcfAmount),
      bond_itl: num(d.itlAmount),
      bond_stamp_duty: num(d.stampDutyAmount),
      bond_total_premium: num(d.totalPremium),
    },
  };
}

function mapGuarantee(
  kind: "PERFORMANCE_BOND" | "ADVANCE_PAYMENT_GUARANTEE",
  detail: Section["performanceBondDetail"]
): MappedSection | null {
  if (!detail) return null;
  return {
    kind,
    values: {
      guarantee_project_name: detail.projectName,
      guarantee_bond_value: num(detail.bondValue),
      guarantee_rate: num(detail.rate),
      guarantee_premium: num(detail.grossPremium),
      guarantee_gross_premium: num(detail.grossPremium),
      guarantee_phcf: num(detail.phcfAmount),
      guarantee_itl: num(detail.itlAmount),
      guarantee_stamp_duty: num(detail.stampDutyAmount),
      guarantee_total_premium: num(detail.totalPremium),
    },
  };
}

function mapCustomsBond(section: Section): MappedSection | null {
  const d = section.customsBondDetail;
  if (!d) return null;
  return {
    kind: "CUSTOMS_BOND",
    values: {
      custom_bond_gross_premium: num(d.grossPremium),
      custom_bond_phcf: num(d.phcfAmount),
      custom_bond_itl: num(d.itlAmount),
      custom_bond_stamp_duty: num(d.stampDutyAmount),
      custom_bond_total_premium: num(d.totalPremium),
    },
    dynamicRows: d.itemRows.map((row) => ({
      custom_bond_type: row.bondType,
      custom_bond_value: num(row.bondValue),
      custom_bond_rate: num(row.rate),
      custom_bond_premium: num(row.premium),
    })),
  };
}

export function mapQuotationData(quotation: QuotationForExport): MappedQuotation {
  const sections: MappedSection[] = [];

  for (const section of quotation.sections) {
    let mapped: MappedSection | null = null;
    switch (section.sectionKind) {
      case "CAR_PACKAGE":
        mapped = mapCar(section);
        break;
      case "WIBA":
        mapped = mapWiba(section);
        break;
      case "EMPLOYERS_LIABILITY":
        mapped = mapEl(section);
        break;
      case "CPM_STANDALONE":
        mapped = mapCpm(section);
        break;
      case "PUBLIC_LIABILITY":
        mapped = mapPublicLiability(section);
        break;
      case "FIRE_AND_PERILS":
        mapped = mapFire(section);
        break;
      case "BURGLARY":
        mapped = mapBurglary(section);
        break;
      case "GIT_SINGLE":
        mapped = mapGitSingle(section);
        break;
      case "GIT_ANNUAL":
        mapped = mapGitAnnual(section);
        break;
      case "MARINE_COVER":
        mapped = mapMarine(section);
        break;
      case "MOTOR_COMP_PRIVATE":
        mapped = mapMotorComprehensive("MOTOR_COMP_PRIVATE", section, section.motorCompPrivateDetail);
        break;
      case "MOTOR_COMP_COMMERCIAL":
        mapped = mapMotorComprehensive("MOTOR_COMP_COMMERCIAL", section, section.motorCompCommercialDetail);
        break;
      case "MOTOR_TPO_PRIVATE":
        mapped = mapMotorTpo("MOTOR_TPO_PRIVATE", section.motorTpoPrivateDetail);
        break;
      case "MOTOR_TPO_COMMERCIAL":
        mapped = mapMotorTpo("MOTOR_TPO_COMMERCIAL", section.motorTpoCommercialDetail);
        break;
      case "GROUP_PERSONAL_ACCIDENT":
        mapped = mapGpa(section);
        break;
      case "GROUP_MEDICAL":
        mapped = mapMedical(section);
        break;
      case "TENDER_SECURITY":
        mapped = mapTenderSecurity(section);
        break;
      case "PERFORMANCE_BOND":
        mapped = mapGuarantee("PERFORMANCE_BOND", section.performanceBondDetail);
        break;
      case "ADVANCE_PAYMENT_GUARANTEE":
        mapped = mapGuarantee("ADVANCE_PAYMENT_GUARANTEE", section.advancePaymentGuaranteeDetail);
        break;
      case "CUSTOMS_BOND":
        mapped = mapCustomsBond(section);
        break;
      case "GENERIC":
        // Legacy generic sections have no dedicated template block in Phase 3A.
        mapped = null;
        break;
    }
    if (mapped) sections.push(mapped);
  }

  return {
    common: {
      CUSTOMER_NAME: quotation.customer.companyName,
    },
    sections,
    grandTotal: num(quotation.grandTotal),
  };
}
