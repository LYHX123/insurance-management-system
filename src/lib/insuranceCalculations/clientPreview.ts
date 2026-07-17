// Plain-number mirrors of the Decimal-based calculators in car.ts / wiba.ts /
// el.ts / cpm.ts, for live client-side totals only (this project's house
// convention keeps Prisma.Decimal server-side — see quotation-form.tsx's
// existing round2/computeSectionTotals helpers for the same pattern applied
// to the generic section model). The server re-derives and validates every
// amount from scratch on submit; nothing computed here is trusted as-is.

import { EL_PERCENT_OF_WIBA, ITL_RATE, MARINE_STAMP_DUTY_RATE, PHCF_RATE, STAMP_DUTY } from "./constants";

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function previewCarPackage(input: {
  contractValue: string;
  carRate: string;
  cpmValue: string;
  cpmRate: string;
  pvtLoadingEnabled: boolean;
  pvtLoadingAmount: string;
  tplComplimentary: boolean;
  tplAnyOnePeriod: string;
  tplRate: string;
}) {
  const carBasicPremium = round2((num(input.contractValue) * num(input.carRate)) / 100);
  const carCpmPremium =
    input.cpmValue !== "" && input.cpmRate !== ""
      ? round2((num(input.cpmValue) * num(input.cpmRate)) / 100)
      : 0;
  const carPvtLoadingAmount = input.pvtLoadingEnabled ? round2(num(input.pvtLoadingAmount)) : 0;

  const carMainGrossPremium = round2(carBasicPremium + carCpmPremium + carPvtLoadingAmount);
  const carMainPhcf = round2((carMainGrossPremium * PHCF_RATE) / 100);
  const carMainItl = round2((carMainGrossPremium * ITL_RATE) / 100);
  const carMainStampDuty = STAMP_DUTY;
  const carMainTotal = round2(carMainGrossPremium + carMainPhcf + carMainItl + carMainStampDuty);

  let tplGrossPremium = 0;
  let tplPhcf = 0;
  let tplItl = 0;
  let tplStampDuty = 0;
  let tplTotalPremium = 0;

  if (!input.tplComplimentary) {
    tplGrossPremium = round2((num(input.tplAnyOnePeriod) * num(input.tplRate)) / 100);
    tplPhcf = round2((tplGrossPremium * PHCF_RATE) / 100);
    tplItl = round2((tplGrossPremium * ITL_RATE) / 100);
    tplStampDuty = STAMP_DUTY;
    tplTotalPremium = round2(tplGrossPremium + tplPhcf + tplItl + tplStampDuty);
  }

  return {
    carBasicPremium,
    carCpmPremium,
    carPvtLoadingAmount,
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

export function previewWiba(input: {
  payrollRows: { employeeCount: string; annualWages: string }[];
  wibaRate: string;
}) {
  const totalEmployeeCount = input.payrollRows.reduce((sum, row) => sum + (parseInt(row.employeeCount, 10) || 0), 0);
  const totalAnnualWages = round2(input.payrollRows.reduce((acc, row) => acc + num(row.annualWages), 0));
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
  pvtLoadingAmount: string;
}) {
  const totalSumInsured = round2(
    input.equipmentRows.reduce((acc, row) => acc + (parseInt(row.quantity, 10) || 0) * num(row.unitValue), 0)
  );
  const basicPremium = round2((totalSumInsured * num(input.cpmRate)) / 100);
  const pvtLoadingAmount = input.pvtLoadingEnabled ? round2(num(input.pvtLoadingAmount)) : 0;
  const grossPremium = round2(basicPremium + pvtLoadingAmount);
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return { totalSumInsured, basicPremium, pvtLoadingAmount, grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
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
  earthquakeLoadingRate: string;
  floodLoadingRate: string;
  pvtLoadingEnabled: boolean;
  pvtLoadingAmount: string;
}) {
  const totalSumInsured = round2(
    num(input.propertyValue) + num(input.rawMaterialValue) + num(input.goodsInStockValue)
  );
  const basicPremium = round2((totalSumInsured * num(input.rate)) / 100);
  const earthquakeLoadingAmount = round2((totalSumInsured * num(input.earthquakeLoadingRate)) / 100);
  const floodLoadingAmount = round2((totalSumInsured * num(input.floodLoadingRate)) / 100);
  const pvtLoadingAmount = input.pvtLoadingEnabled ? round2(num(input.pvtLoadingAmount)) : 0;
  const grossPremium = round2(
    basicPremium + earthquakeLoadingAmount + floodLoadingAmount + pvtLoadingAmount
  );
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return {
    totalSumInsured,
    basicPremium,
    earthquakeLoadingAmount,
    floodLoadingAmount,
    pvtLoadingAmount,
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
}) {
  const basicPremium = round2((num(input.sumInsured) * num(input.rate)) / 100);
  const pvtLoadingAmount = input.pvtLoadingEnabled ? round2(num(input.pvtLoadingAmount)) : 0;
  const grossPremium = round2(basicPremium + pvtLoadingAmount);
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return { basicPremium, pvtLoadingAmount, grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
}

export function previewGitAnnual(input: {
  singleLimit: string;
  yearLimit: string;
  singleLimitRate: string;
  yearLimitRate: string;
  pvtLoadingEnabled: boolean;
  pvtLoadingAmount: string;
}) {
  const singlePremium = round2((num(input.singleLimit) * num(input.singleLimitRate)) / 100);
  const yearPremium = round2((num(input.yearLimit) * num(input.yearLimitRate)) / 100);
  const pvtLoadingAmount = input.pvtLoadingEnabled ? round2(num(input.pvtLoadingAmount)) : 0;
  const grossPremium = round2(singlePremium + yearPremium + pvtLoadingAmount);
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const stampDutyAmount = STAMP_DUTY;
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + stampDutyAmount);

  return { singlePremium, yearPremium, pvtLoadingAmount, grossPremium, phcfAmount, itlAmount, stampDutyAmount, totalPremium };
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

export function previewMarine(input: { shipmentRows: { sumInsured: string; rate: string }[] }) {
  const rows = input.shipmentRows.map((row) => ({
    sumInsured: num(row.sumInsured),
    rate: num(row.rate),
    linePremium: round2((num(row.sumInsured) * num(row.rate)) / 100),
  }));
  const totalSumInsured = round2(rows.reduce((acc, row) => acc + row.sumInsured, 0));
  const grossPremium = round2(rows.reduce((acc, row) => acc + row.linePremium, 0));
  const phcfAmount = round2((grossPremium * PHCF_RATE) / 100);
  const itlAmount = round2((grossPremium * ITL_RATE) / 100);
  const marineStampDutyAmount = round2((totalSumInsured * MARINE_STAMP_DUTY_RATE) / 100);
  const totalPremium = round2(grossPremium + phcfAmount + itlAmount + marineStampDutyAmount);

  return {
    rows,
    totalSumInsured,
    grossPremium,
    phcfAmount,
    itlAmount,
    marineStampDutyRate: MARINE_STAMP_DUTY_RATE,
    marineStampDutyAmount,
    totalPremium,
  };
}
