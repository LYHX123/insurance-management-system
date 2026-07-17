// Draft (string-based form state) shapes for the Phase 1 structured
// insurance sections, shared between quotation-form.tsx and the individual
// section components. Mirrors the *SectionDetail Prisma models one-to-one.

export type CarDraft = {
  projectName: string;
  contractValue: string;
  carRate: string;
  constructionPeriodMonths: string;
  maintenancePeriodMonths: string;
  cpmValue: string;
  cpmRate: string;
  tplAnyOneClaim: string;
  tplAnyOneEvent: string;
  tplAnyOnePeriod: string;
  tplRate: string;
  tplComplimentary: boolean;
  pvtLoadingEnabled: boolean;
  pvtLoadingRate: string;
  pvtLoadingAmount: string;
};

export function emptyCarDraft(): CarDraft {
  return {
    projectName: "",
    contractValue: "",
    carRate: "",
    constructionPeriodMonths: "",
    maintenancePeriodMonths: "",
    cpmValue: "",
    cpmRate: "",
    tplAnyOneClaim: "",
    tplAnyOneEvent: "",
    tplAnyOnePeriod: "",
    tplRate: "",
    tplComplimentary: false,
    pvtLoadingEnabled: false,
    pvtLoadingRate: "",
    pvtLoadingAmount: "",
  };
}

export type WibaPayrollRowDraft = {
  key: string;
  occupation: string;
  employeeCount: string;
  annualWages: string;
};

export type WibaDraft = {
  wibaRate: string;
  payrollRows: WibaPayrollRowDraft[];
};

export function emptyWibaPayrollRow(): WibaPayrollRowDraft {
  return { key: crypto.randomUUID(), occupation: "", employeeCount: "", annualWages: "" };
}

export function emptyWibaDraft(): WibaDraft {
  return { wibaRate: "", payrollRows: [emptyWibaPayrollRow()] };
}

export type CpmEquipmentRowDraft = {
  key: string;
  equipmentName: string;
  quantity: string;
  unitValue: string;
};

export type CpmDraft = {
  cpmRate: string;
  pvtLoadingEnabled: boolean;
  pvtLoadingRate: string;
  pvtLoadingAmount: string;
  equipmentRows: CpmEquipmentRowDraft[];
};

export function emptyCpmEquipmentRow(): CpmEquipmentRowDraft {
  return { key: crypto.randomUUID(), equipmentName: "", quantity: "", unitValue: "" };
}

export function emptyCpmDraft(): CpmDraft {
  return { cpmRate: "", pvtLoadingEnabled: false, equipmentRows: [emptyCpmEquipmentRow()], pvtLoadingRate: "", pvtLoadingAmount: "" };
}

export type PublicLiabilityDraft = {
  anyOnePersonLimit: string;
  anyOneOccurrenceLimit: string;
  anyOneYearLimit: string;
  rate: string;
};

export function emptyPublicLiabilityDraft(): PublicLiabilityDraft {
  return { anyOnePersonLimit: "", anyOneOccurrenceLimit: "", anyOneYearLimit: "", rate: "" };
}

export type FireDraft = {
  propertyValue: string;
  rawMaterialValue: string;
  goodsInStockValue: string;
  rate: string;
  earthquakeLoadingRate: string;
  floodLoadingRate: string;
  pvtLoadingEnabled: boolean;
  pvtLoadingRate: string;
  pvtLoadingAmount: string;
};

export function emptyFireDraft(): FireDraft {
  return {
    propertyValue: "",
    rawMaterialValue: "",
    goodsInStockValue: "",
    rate: "",
    earthquakeLoadingRate: "",
    floodLoadingRate: "",
    pvtLoadingEnabled: false,
    pvtLoadingRate: "",
    pvtLoadingAmount: "",
  };
}

export type BurglaryDraft = {
  equipmentValue: string;
  stockValue: string;
  firstLossPercentage: string;
  rate: string;
};

export function emptyBurglaryDraft(): BurglaryDraft {
  return { equipmentValue: "", stockValue: "", firstLossPercentage: "", rate: "" };
}

export type GitSingleDraft = {
  cargoDescription: string;
  route: string;
  sumInsured: string;
  rate: string;
  pvtLoadingEnabled: boolean;
  pvtLoadingRate: string;
  pvtLoadingAmount: string;
};

export function emptyGitSingleDraft(): GitSingleDraft {
  return {
    cargoDescription: "",
    route: "",
    sumInsured: "",
    rate: "",
    pvtLoadingEnabled: false,
    pvtLoadingRate: "",
    pvtLoadingAmount: "",
  };
}

export type GitAnnualDraft = {
  cargoDescription: string;
  singleLimit: string;
  yearLimit: string;
  singleLimitRate: string;
  yearLimitRate: string;
  pvtLoadingEnabled: boolean;
  pvtLoadingRate: string;
  pvtLoadingAmount: string;
};

export function emptyGitAnnualDraft(): GitAnnualDraft {
  return {
    cargoDescription: "",
    singleLimit: "",
    yearLimit: "",
    singleLimitRate: "",
    yearLimitRate: "",
    pvtLoadingEnabled: false,
    pvtLoadingRate: "",
    pvtLoadingAmount: "",
  };
}

export type MarineShipmentRowDraft = {
  key: string;
  referenceNo: string;
  sumInsured: string;
  rate: string;
};

export type MarineDraft = {
  cargoDescription: string;
  origin: string;
  destination: string;
  shipmentRows: MarineShipmentRowDraft[];
};

export function emptyMarineShipmentRow(): MarineShipmentRowDraft {
  return { key: crypto.randomUUID(), referenceNo: "", sumInsured: "", rate: "" };
}

export function emptyMarineDraft(): MarineDraft {
  return { cargoDescription: "", origin: "", destination: "", shipmentRows: [emptyMarineShipmentRow()] };
}

// Shared by Motor Comprehensive - Private and - Commercial (identical fields).
export type MotorComprehensiveDraft = {
  plateNo: string;
  vehicleValue: string;
  periodFrom: string;
  periodTo: string;
  excessProtector: string;
  pvt: string;
  rate: string;
};

export function emptyMotorComprehensiveDraft(): MotorComprehensiveDraft {
  return { plateNo: "", vehicleValue: "", periodFrom: "", periodTo: "", excessProtector: "", pvt: "", rate: "" };
}

// Shared by Motor TPO - Private and - Commercial. loadingCapacity is only
// shown/used for the Commercial variant, but kept on one draft shape for
// component reuse — Private simply never renders that field.
export type MotorTpoDraft = {
  plateNo: string;
  loadingCapacity: string;
  basePremium: string;
  periodFrom: string;
  periodTo: string;
};

export function emptyMotorTpoDraft(): MotorTpoDraft {
  return { plateNo: "", loadingCapacity: "", basePremium: "", periodFrom: "", periodTo: "" };
}

export type GpaDraft = {
  deathLimit: string;
  ptdLimit: string;
  ttdLimit: string;
  medicalLimit: string;
  funeralLimit: string;
  deathRate: string;
  ptdRate: string;
  ttdRate: string;
  medicalRate: string;
  funeralRate: string;
  numberOfPeople: string;
};

export function emptyGpaDraft(): GpaDraft {
  return {
    deathLimit: "",
    ptdLimit: "",
    ttdLimit: "",
    medicalLimit: "",
    funeralLimit: "",
    deathRate: "",
    ptdRate: "",
    ttdRate: "",
    medicalRate: "",
    funeralRate: "",
    numberOfPeople: "",
  };
}

// The six family categories are fixed for Phase 2B — always exactly these
// six rows, in this order, never user-added/removed (contrast with the
// fully dynamic WIBA/CPM/Marine/CustomsBond row drafts above).
export const MEDICAL_CATEGORIES = ["M", "M_PLUS_1", "M_PLUS_2", "M_PLUS_3", "M_PLUS_4", "M_PLUS_5"] as const;
export type MedicalCategory = (typeof MEDICAL_CATEGORIES)[number];

export type MedicalCategoryRowDraft = {
  category: MedicalCategory;
  employeeCount: string;
  inpatientRate: string;
  outpatientRate: string;
};

export type MedicalDraft = {
  inpatientLimit: string;
  outpatientLimit: string;
  categoryRows: MedicalCategoryRowDraft[];
};

export function emptyMedicalCategoryRows(): MedicalCategoryRowDraft[] {
  return MEDICAL_CATEGORIES.map((category) => ({
    category,
    employeeCount: "",
    inpatientRate: "",
    outpatientRate: "",
  }));
}

export function emptyMedicalDraft(): MedicalDraft {
  return { inpatientLimit: "", outpatientLimit: "", categoryRows: emptyMedicalCategoryRows() };
}

// Shared by Tender Security, Performance Bond and Advance Payment Guarantee
// (identical fields) — each still gets its own state slice in the form so
// all three can be selected and saved simultaneously.
export type GuaranteeDraft = {
  projectName: string;
  bondValue: string;
  rate: string;
};

export function emptyGuaranteeDraft(): GuaranteeDraft {
  return { projectName: "", bondValue: "", rate: "" };
}

export type CustomsBondItemRowDraft = {
  key: string;
  bondType: string;
  bondValue: string;
  rate: string;
};

export type CustomsBondDraft = {
  itemRows: CustomsBondItemRowDraft[];
};

export function emptyCustomsBondItemRow(): CustomsBondItemRowDraft {
  return { key: crypto.randomUUID(), bondType: "", bondValue: "", rate: "" };
}

export function emptyCustomsBondDraft(): CustomsBondDraft {
  return { itemRows: [emptyCustomsBondItemRow()] };
}
