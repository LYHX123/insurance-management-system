import { Prisma } from "@/generated/prisma/client";
import { percentOf, roundMoney, toDecimal, type DecimalInput } from "@/lib/money";
import {
  DEFAULT_EL_OPTION,
  EL_OPTIONS,
  ITL_RATE,
  PHCF_RATE,
  STAMP_DUTY,
  resolveElOption,
  type ElOptionNumber,
} from "./constants";

export type ElResult = {
  /** The tier the user selected (1-4). */
  elOption: ElOptionNumber;
  /** Percentage points of WIBA gross premium applied (25 / 30 / 35 / 40). */
  elRatePercent: number;
  /** Liability limits the selected tier resolves to — never user-entered. */
  anyOnePersonLimit: Prisma.Decimal;
  anyOneOccurrenceLimit: Prisma.Decimal;
  anyOneYearLimit: Prisma.Decimal;

  linkedWibaGrossPremium: Prisma.Decimal;
  grossPremium: Prisma.Decimal;
  phcfAmount: Prisma.Decimal;
  itlAmount: Prisma.Decimal;
  stampDutyAmount: Prisma.Decimal;
  totalPremium: Prisma.Decimal;
};

// Employer's Liability is always derived from the WIBA section in the same
// quotation — the caller passes that section's already-computed gross
// premium plus the selected option tier (1-4). The tier alone fixes the
// rate and all three liability limits (see EL_OPTIONS in constants.ts);
// there are no free-form EL inputs. An unrecognised / missing option
// resolves to Option 1, which is exactly the pre-Phase-10 fixed 25%
// behaviour, so historical callers and rows are unaffected.
export function calculateEl(
  wibaGrossPremium: DecimalInput,
  option: unknown = DEFAULT_EL_OPTION
): ElResult {
  const tier = resolveElOption(option);

  const linkedWibaGrossPremium = toDecimal(wibaGrossPremium);
  const grossPremium = roundMoney(percentOf(linkedWibaGrossPremium, tier.ratePercent));
  const phcfAmount = roundMoney(percentOf(grossPremium, PHCF_RATE));
  const itlAmount = roundMoney(percentOf(grossPremium, ITL_RATE));
  const stampDutyAmount = toDecimal(STAMP_DUTY);
  const totalPremium = roundMoney(
    grossPremium.plus(phcfAmount).plus(itlAmount).plus(stampDutyAmount)
  );

  return {
    elOption: tier.option,
    elRatePercent: tier.ratePercent,
    anyOnePersonLimit: toDecimal(tier.anyOnePersonLimit),
    anyOneOccurrenceLimit: toDecimal(tier.anyOneOccurrenceLimit),
    anyOneYearLimit: toDecimal(tier.anyOneYearLimit),
    linkedWibaGrossPremium,
    grossPremium,
    phcfAmount,
    itlAmount,
    stampDutyAmount,
    totalPremium,
  };
}

// Re-exported for callers that only need the tier metadata (e.g. mapping a
// stored elOption straight to its limits without recomputing premium).
export { EL_OPTIONS };
