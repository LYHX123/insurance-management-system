import { Prisma } from "@/generated/prisma/client";
import type { CalculationMethod } from "@/generated/prisma/enums";

export type DecimalInput = Prisma.Decimal | number | string | null | undefined;

export function toDecimal(value: DecimalInput): Prisma.Decimal {
  if (value === null || value === undefined || value === "") {
    return new Prisma.Decimal(0);
  }
  return new Prisma.Decimal(value as number | string | Prisma.Decimal);
}

// Rejects blank input and non-finite numeric input (NaN, Infinity,
// -Infinity) that a bare `Number(x) <= 0` / `< 0` comparison lets through
// unnoticed — see Production Readiness Audit V1, finding H5. Every
// server-side "is this a valid amount" check on a user-supplied financial
// input should route through this rather than re-deriving Number(x) inline.
// Returns the parsed finite number, or null if the input is blank or
// non-finite; callers still apply their own sign/zero business rule to the
// returned number.
export function toFiniteAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// All financial calculations round half-up to 2 decimal places — never use
// plain JS floating point arithmetic for money in this module.
export function roundMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function percentOf(base: DecimalInput, ratePercent: DecimalInput): Prisma.Decimal {
  return toDecimal(base).times(toDecimal(ratePercent)).dividedBy(100);
}

export function calculateCoverageItemPremium(item: {
  calculationMethod: CalculationMethod;
  sumInsured?: DecimalInput;
  rate?: DecimalInput;
  premium?: DecimalInput;
}): Prisma.Decimal {
  if (item.calculationMethod === "PERCENTAGE") {
    return roundMoney(percentOf(item.sumInsured, item.rate));
  }
  // FIXED_PREMIUM and MANUAL_PREMIUM both take the user-entered premium
  // as-is — the system never overrides a manually entered premium.
  return roundMoney(toDecimal(item.premium));
}

export type SectionTotals = {
  basePremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  sectionTotal: Prisma.Decimal;
};

export function calculateSectionTotals(section: {
  applyPHCF: boolean;
  phcfRate: DecimalInput;
  applyITL: boolean;
  itlRate: DecimalInput;
  applyStampDuty: boolean;
  stampDuty: DecimalInput;
  itemPremiums: DecimalInput[];
}): SectionTotals {
  const basePremium = roundMoney(
    section.itemPremiums.reduce<Prisma.Decimal>(
      (acc, premium) => acc.plus(toDecimal(premium)),
      toDecimal(0)
    )
  );
  const phcfAmount = section.applyPHCF
    ? roundMoney(percentOf(basePremium, section.phcfRate))
    : toDecimal(0);
  const itlAmount = section.applyITL
    ? roundMoney(percentOf(basePremium, section.itlRate))
    : toDecimal(0);
  const stampDutyAmount = section.applyStampDuty
    ? roundMoney(toDecimal(section.stampDuty))
    : toDecimal(0);
  const sectionTotal = roundMoney(
    basePremium.plus(phcfAmount).plus(itlAmount).plus(stampDutyAmount)
  );

  return { basePremium, phcfAmount, itlAmount, stampDutyAmount, sectionTotal };
}

export type QuotationTotals = {
  subtotalPremium: Prisma.Decimal;
  totalPHCF: Prisma.Decimal;
  totalITL: Prisma.Decimal;
  totalStampDuty: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
};

export function calculateQuotationTotals(sections: SectionTotals[]): QuotationTotals {
  const sum = (pick: (s: SectionTotals) => Prisma.Decimal) =>
    roundMoney(sections.reduce<Prisma.Decimal>((acc, s) => acc.plus(pick(s)), toDecimal(0)));

  const subtotalPremium = sum((s) => s.basePremium);
  const totalPHCF = sum((s) => s.phcfAmount);
  const totalITL = sum((s) => s.itlAmount);
  const totalStampDuty = sum((s) => s.stampDutyAmount);
  const grandTotal = roundMoney(
    subtotalPremium.plus(totalPHCF).plus(totalITL).plus(totalStampDuty)
  );

  return { subtotalPremium, totalPHCF, totalITL, totalStampDuty, grandTotal };
}
