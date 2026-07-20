// Plain-number mirrors of the Decimal-based calculators in car.ts / wiba.ts /
// el.ts / cpm.ts, for live client-side totals only (this project's house
// convention keeps Prisma.Decimal server-side — see quotation-form.tsx's
// existing round2/computeSectionTotals helpers for the same pattern applied
// to the generic section model). The server re-derives and validates every
// amount from scratch on submit; nothing computed here is trusted as-is.

import {
  EL_PERCENT_OF_WIBA,
  FIRE_EARTHQUAKE_LOADING_RATE,
  FIRE_FLOOD_LOADING_RATE,
  ITL_RATE,
  MARINE_INCIDENTAL_LOADING_RATE,
  MARINE_STAMP_DUTY_RATE,
  PHCF_RATE,
  STAMP_DUTY,
} from "./constants";

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function previewPvtLoading(enabled: boolean, amount: string, rate: string) {
  if (!enabled) return { amount: 0, rate: 0, premium: 0 };
  const a = round2(num(amount));
  const r = num(rate);
  const premium = round2((a * r) / 100);
  return { amount: a, rate: r, premium };
}

export function previewCarPackage(input: {
  contractValue: string;
  carRate: string;
  cpmValue: string;
  cpmRate: string;
  pvtLoadingEnabled: boolean;
  pvtLoadingAmount: string;
  pvtLoadingRate: string;
  tplComplimentary: boolean;
  tplAnyOnePeriod: string;
  tplRate: string;
}) {
  const carBasicPremium = round2((num(input.contractValue) * num(input.carRate)) / 100);
  const carCpmPremium =
    input.cpmValue !== "" && input.cpmRate !== ""
      ? round2((num(input.cpmValue) * num(input.cpmRate)) / 100)
      : 0;
  const carPvt = previewPvtLoading(input.pvtLoadingEnabled, input.pvtLoadingAmount, input.pvtLoadingRate);
  const carPvtLoadingAmount = carPvt.amount;
  const carPvtLoadingRate = carPvt.rate;
  const carPvtLoadingPremium = carPvt.premium;

  const carMainGrossPremium = round2(carBasicPremium + carCpmPremium + carPvtLoadingPremium);
  const carMainPhcf = round2((carMainGrossPremium * PHCF_RATE) / 100);
  const carMainItl = round2((carMainGrossPremium * ITL_RATE) / 100);
  const carMainStampDuty = STAMP_DUTY;
  const carMainTotal = round2(carMainGrossPremium + carMainPhcf + carMainItl + carMainStampDuty);

  let tplGrossPremium = 0;
  let tplPhcf = 0;
  let tplItl = 0;
  // TPL is part of the same CAR policy as Main CAR/CPM/PVT Loading — only one
  // stamp duty is charged per policy, already counted in carMainStampDuty
  // above, so TPL's own share stays 0 rather than adding a second KES 40.
  const tplStampDuty = 0;
  let tplTotalPremium = 0;

  if (!input.tplComplimentary) {
    tplGrossPremium = round2((num(input.tplAnyOnePeriod) * num(input.tplRate)) / 100);
    tplPhcf = round2((tplGrossPremium * PHCF_RATE) / 100);
    tplItl = round2((tplGrossPremium * ITL_RATE) / 100);
    tplTotalPremium = round2(tplGrossPremium + tplPhcf + tplItl + tplStampDuty);
  }

  return {
    carBasicPremium,
    carCpmPremium,
    carPvtLoadingAmount,
    carPvtLoadingRate,
    carPvtLoadingPremium,
    carMainGrossPremium,
    carMainPhcf,
    carMainItl,
    carMainStampDuty,
    carMainTotal,
    tplGrossPremium,
    tplPhcf,
    tplItl,
    tplStampDuty,
    tplTotalPremium,
    basePremium: round2(carMainGrossPremium + tplGrossPremium),
    phcfAmount: round2(carMainPhcf + tplPhcf),
    itlAmount: round2(carMainItl + tplItl),
    stampDutyAmount: round2(carMainStampDuty + tplStampDuty),
    sectionTotal: round2(carMainTotal + tplTotalPremium),
  };
}

type WibaPayrollRowPreviewInput = {
  employeeCount: string;
  annualWages: string;
  basicMonthlySalary?: string;
  monthlyAllowance?: string;
};

// Number mirror of resolveWibaRowAnnualWages in insuranceCalculations/wiba.ts
// — same fallback rule: a row with neither basicMonthlySalary nor
// monthlyAllowance filled in keeps its existing (legacy or already-computed)
// annualWages value untouched instead of resolving to 0.
export function resolveWibaRowAnnualWages(row: WibaPayrollRowPreviewInput): number {
  const hasSalaryInputs = !!row.basicMonthlySalary || !!row.monthlyAllowance;
  if (!hasSalaryInputs) return num(row.annualWages);

  const basic = num(row.basicMonthlySalary);
  const allowance = num(row.monthlyAllowance);
  const employeeCount = parseInt(row.employeeCount, 10) || 0;
  return round2((basic + allowance) * employeeCount * 12);
}

export function previewWiba(input: {
  payrollRows: WibaPayrollRowPreviewInput[];
  wibaRate: string;
}) {
  const totalEmployeeCount = input.payrollRows.reduce((sum, row) => sum + (parseInt(row.employeeCount, 10) || 0), 0);
  const totalAnnualWages = round2(
    input.payrollRows.reduce((acc, row) => acc + resolveWibaRowAnnualWages(row), 0)
  );
  const grossPremium = round2((totalAnnualWages * num(input.wibaRate)) / 100);
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return { totalEmployeeCount, totalAnnualWages, grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}

export function previewEl(wibaGrossPremium: number) {
  const grossPremium = round2((wibaGrossPremium * EL_PERCENT_OF_WIBA) / 100);
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return { grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}

export function previewCpmStandalone(input: {
  equipmentRows: { quantity: string; unitValue: string }[];
  cpmRate: string;
  pvtLoadingEnabled: boolean;
  pvtLoadingRate: string;
}) {
  const totalSumInsured = round2(
    input.equipmentRows.reduce((acc, row) => acc + (parseInt(row.quantity, 10) || 0) * num(row.unitValue), 0)
  );
  const basicPremium = round2((totalSumInsured * num(input.cpmRate)) / 100);
  // PVT Loading Amount is not a manual input for CPM — it always equals
  // this section's own CPM Base Premium.
  const pvt = previewPvtLoading(input.pvtLoadingEnabled, String(basicPremium), input.pvtLoadingRate);
  const grossPremium = round2(basicPremium + pvt.premium);
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return {
    totalSumInsured,
    basicPremium,
    pvtLoadingAmount: pvt.amount,
    pvtLoadingRate: pvt.rate,
    pvtLoadingPremium: pvt.premium,
    grossPremium,
    phcfAmount,
    itlAmount,
    stampDutyAmount,
    totalPremium,
  };
}

export function previewPublicLiability(input: { anyOneYearLimit: string; rate: string }) {
  const grossPremium = round2((num(input.anyOneYearLimit) * num(input.rate)) / 100);
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return { grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}

export function previewFire(input: {
  propertyValue: string;
  rawMaterialValue: string;
  goodsInStockValue: string;
  rate: string;
  earthquakeLoadingEnabled: boolean;
  floodLoadingEnabled: boolean;
  pvtLoadingEnabled: boolean;
  pvtLoadingAmount: string;
  pvtLoadingRate: string;
}) {
  const totalSumInsured = round2(
    num(input.propertyValue) + num(input.rawMaterialValue) + num(input.goodsInStockValue)
  );
  const basicPremium = round2((totalSumInsured * num(input.rate)) / 100);
  // Earthquake/Flood Loading are fixed business rates, not user input — see
  // FIRE_EARTHQUAKE_LOADING_RATE/FIRE_FLOOD_LOADING_RATE's doc comment.
  const earthquakeLoadingRate = input.earthquakeLoadingEnabled ? FIRE_EARTHQUAKE_LOADING_RATE : 0;
  const floodLoadingRate = input.floodLoadingEnabled ? FIRE_FLOOD_LOADING_RATE : 0;
  const earthquakeLoadingAmount = round2((totalSumInsured * earthquakeLoadingRate) / 100);
  const floodLoadingAmount = round2((totalSumInsured * floodLoadingRate) / 100);
  const pvt = previewPvtLoading(input.pvtLoadingEnabled, input.pvtLoadingAmount, input.pvtLoadingRate);
  const grossPremium = round2(
    basicPremium + earthquakeLoadingAmount + floodLoadingAmount + pvt.premium
  );
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return {
    totalSumInsured,
    basicPremium,
    earthquakeLoadingRate,
    earthquakeLoadingAmount,
    floodLoadingRate,
    floodLoadingAmount,
    pvtLoadingAmount: pvt.amount,
    pvtLoadingRate: pvt.rate,
    pvtLoadingPremium: pvt.premium,
    grossPremium,
    phcfAmount,
    itlAmount,
    stampDutyAmount,
    totalPremium,
  };
}

export function previewBurglary(input: {
  equipmentValue: string;
  stockValue: string;
  firstLossPercentage: string;
  rate: string;
}) {
  const totalValue = round2(num(input.equipmentValue) + num(input.stockValue));
  const firstLossSumInsured = round2((totalValue * num(input.firstLossPercentage)) / 100);
  const grossPremium = round2((firstLossSumInsured * num(input.rate)) / 100);
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return { totalValue, firstLossSumInsured, grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}

export function previewGitSingle(input: {
  sumInsured: string;
  rate: string;
  pvtLoadingEnabled: boolean;
  pvtLoadingAmount: string;
  pvtLoadingRate: string;
}) {
  const basicPremium = round2((num(input.sumInsured) * num(input.rate)) / 100);
  const pvt = previewPvtLoading(input.pvtLoadingEnabled, input.pvtLoadingAmount, input.pvtLoadingRate);
  const grossPremium = round2(basicPremium + pvt.premium);
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return {
    basicPremium,
    pvtLoadingAmount: pvt.amount,
    pvtLoadingRate: pvt.rate,
    pvtLoadingPremium: pvt.premium,
    grossPremium,
    phcfAmount,
    itlAmount,
    stampDutyAmount,
    totalPremium,
  };
}

export function previewGitAnnual(input: {
  singleLimit: string;
  yearLimit: string;
  singleLimitRate: string;
  yearLimitRate: string;
  pvtLoadingEnabled: boolean;
  pvtLoadingAmount: string;
  pvtLoadingRate: string;
}) {
  const singlePremium = round2((num(input.singleLimit) * num(input.singleLimitRate)) / 100);
  const yearPremium = round2((num(input.yearLimit) * num(input.yearLimitRate)) / 100);
  const pvt = previewPvtLoading(input.pvtLoadingEnabled, input.pvtLoadingAmount, input.pvtLoadingRate);
  const grossPremium = round2(singlePremium + yearPremium + pvt.premium);
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return {
    singlePremium,
    yearPremium,
    pvtLoadingAmount: pvt.amount,
    pvtLoadingRate: pvt.rate,
    pvtLoadingPremium: pvt.premium,
    grossPremium,
    phcfAmount,
    itlAmount,
    stampDutyAmount,
    totalPremium,
  };
}

export function previewMotorComprehensive(input: { vehicleValue: string; rate: string }) {
  const grossPremium = round2((num(input.vehicleValue) * num(input.rate)) / 100);
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return { grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}

export function previewMotorTpo(input: { basePremium: string }) {
  const grossPremium = round2(num(input.basePremium));
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return { grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}

export function previewGpa(input: {
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
}) {
  const deathPremium = round2((num(input.deathLimit) * num(input.deathRate)) / 100);
  const ptdPremium = round2((num(input.ptdLimit) * num(input.ptdRate)) / 100);
  const ttdPremium = round2((num(input.ttdLimit) * num(input.ttdRate)) / 100);
  const medicalPremium = round2((num(input.medicalLimit) * num(input.medicalRate)) / 100);
  const funeralPremium = round2((num(input.funeralLimit) * num(input.funeralRate)) / 100);
  const premiumPerPerson = round2(deathPremium + ptdPremium + ttdPremium + medicalPremium + funeralPremium);
  const numberOfPeople = parseInt(input.numberOfPeople, 10) || 0;
  const grossPremium = round2(premiumPerPerson * numberOfPeople);
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return {
    deathPremium,
    ptdPremium,
    ttdPremium,
    medicalPremium,
    funeralPremium,
    premiumPerPerson,
    numberOfPeople,
    grossPremium,
    phcfAmount,
    itlAmount,
    stampDutyAmount,
    totalPremium,
  };
}

export function previewMedical(input: {
  categoryRows: { employeeCount: string; inpatientRate: string; outpatientRate: string }[];
}) {
  const rows = input.categoryRows.map((row) => {
    const employeeCount = parseInt(row.employeeCount, 10) || 0;
    return {
      employeeCount,
      inpatientAmount: round2(employeeCount * num(row.inpatientRate)),
      outpatientAmount: round2(employeeCount * num(row.outpatientRate)),
    };
  });
  const employeeCount = rows.reduce((sum, row) => sum + row.employeeCount, 0);
  const inpatientPremium = round2(rows.reduce((acc, row) => acc + row.inpatientAmount, 0));
  const outpatientPremium = round2(rows.reduce((acc, row) => acc + row.outpatientAmount, 0));
  const subtotal = round2(inpatientPremium + outpatientPremium);
  const grossPremium = subtotal;
  const phcfAmount = 0;
  const itlAmount = 0;
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + stampDutyAmount);

  return { rows, employeeCount, inpatientPremium, outpatientPremium, subtotal, grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}

export function previewGuarantee(input: { bondValue: string; rate: string }) {
  const grossPremium = round2((num(input.bondValue) * num(input.rate)) / 100);
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return { grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}

export function previewCustomsBond(input: { rows: { bondValue: string; rate: string }[] }) {
  const rows = input.rows.map((row) => ({
    bondValue: num(row.bondValue),
    rate: num(row.rate),
    premium: round2((num(row.bondValue) * num(row.rate)) / 100),
  }));
  const grossPremium = round2(rows.reduce((acc, row) => acc + row.premium, 0));
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return { rows, grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}

// Incidental Loading is a fixed 10% of each shipment's raw Sum Insured;
// Rate is then applied to Basic Sum Insured (Sum Insured x 1.1), not to the
// raw Sum Insured — mirrors calculateMarine() in insuranceCalculations/marine.ts
// (the backend authoritative version), see that file for the full rationale.
export function previewMarine(input: { shipmentRows: { sumInsured: string; rate: string }[] }) {
  const rows = input.shipmentRows.map((row) => {
    const sumInsured = num(row.sumInsured);
    const rate = num(row.rate);
    const incidentalLoading = round2((sumInsured * MARINE_INCIDENTAL_LOADING_RATE) / 100);
    const basicSumInsured = round2(sumInsured + incidentalLoading);
    const linePremium = round2((basicSumInsured * rate) / 100);
    return { sumInsured, rate, incidentalLoading, basicSumInsured, linePremium };
  });
  const totalSumInsured = round2(rows.reduce((acc, row) => acc + row.sumInsured, 0));
  const totalBasicSumInsured = round2(rows.reduce((acc, row) => acc + row.basicSumInsured, 0));
  const grossPremium = round2(rows.reduce((acc, row) => acc + row.linePremium, 0));
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  // Stamp Duty's base is Total Basic Sum Insured (post-Incidental-Loading),
  // not the raw totalSumInsured — mirrors calculateMarine()'s corrected rule.
  const marineStampDutyAmount = round2((totalBasicSumInsured * MARINE_STAMP_DUTY_RATE) / 100);
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + marineStampDutyAmount);

  return {
    rows,
    totalSumInsured,
    totalBasicSumInsured,
    grossPremium,
    phcfAmount,
    itlAmount,
    marineStampDutyRate: MARINE_STAMP_DUTY_RATE,
    marineStampDutyAmount,
    totalPremium,
  };
}
