// Centralized Phase 1 calculation constants. Rates follow the same
// convention as InsuranceType.defaultPHCFRate/defaultITLRate: a displayed
// rate of 0.25% is stored/used as the number 0.25, not the fraction 0.0025
// (see percentOf() in ../money.ts, which divides by 100).
//
// Do not inline 0.25 / 0.2 / 40 / 25 anywhere else — import from here.

export const PHCF_RATE = 0.25;
export const ITL_RATE = 0.2;
export const STAMP_DUTY = 40;

// Employer's Liability gross premium is a percentage of the linked WIBA
// section's gross premium (expressed in the same "percentage points"
// convention as the rates above, i.e. used via percentOf(wibaGross, 25)).
//
// EL_PERCENT_OF_WIBA is the default/legacy rate (Option 1). It is still
// exported so any EL row saved before the option tiers existed — which has
// elRatePercent defaulted to 25 in the DB — and any caller that has not yet
// been passed an explicit option resolves to exactly the original
// behaviour. New code should go through EL_OPTIONS / resolveElOption below.
export const EL_PERCENT_OF_WIBA = 25;

// Phase 10 — the four selectable Employer's Liability option tiers. This is
// the ONE authoritative table: the selected option number determines the
// rate AND all three liability limits automatically — the user never types
// a limit. Keep in sync with the {{el_*}} placeholders documented in
// quotationTemplateEngine/config.ts's EMPLOYERS_LIABILITY section.
export type ElOptionNumber = 1 | 2 | 3 | 4;

export type ElOption = {
  option: ElOptionNumber;
  /** Percentage points of WIBA gross premium, same convention as EL_PERCENT_OF_WIBA (25 means 25%). */
  ratePercent: number;
  anyOnePersonLimit: number;
  anyOneOccurrenceLimit: number;
  anyOneYearLimit: number;
};

export const EL_OPTIONS: Record<ElOptionNumber, ElOption> = {
  1: { option: 1, ratePercent: 25, anyOnePersonLimit: 2_000_000, anyOneOccurrenceLimit: 10_000_000, anyOneYearLimit: 20_000_000 },
  2: { option: 2, ratePercent: 30, anyOnePersonLimit: 4_000_000, anyOneOccurrenceLimit: 15_000_000, anyOneYearLimit: 30_000_000 },
  3: { option: 3, ratePercent: 35, anyOnePersonLimit: 6_000_000, anyOneOccurrenceLimit: 20_000_000, anyOneYearLimit: 40_000_000 },
  4: { option: 4, ratePercent: 40, anyOnePersonLimit: 8_000_000, anyOneOccurrenceLimit: 25_000_000, anyOneYearLimit: 50_000_000 },
};

export const EL_OPTION_NUMBERS: ElOptionNumber[] = [1, 2, 3, 4];

export const DEFAULT_EL_OPTION: ElOptionNumber = 1;

/**
 * Normalizes anything (a form string, a nullable DB value, undefined) into a
 * valid EL option tier. Unknown / missing → Option 1, matching the DB
 * default and the pre-Phase-10 fixed behaviour.
 */
export function resolveElOption(value: unknown): ElOption {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  if (n === 2 || n === 3 || n === 4) return EL_OPTIONS[n];
  return EL_OPTIONS[DEFAULT_EL_OPTION];
}

// Marine Cover is the only section kind that does not use the fixed
// KES 40 STAMP_DUTY above — its stamp duty is 0.05% of the total Basic Sum
// Insured (Sum Insured x 1.10), 0.05 meaning 0.05% (same convention as
// PHCF_RATE). Never the fixed KES 40, the rated premium, PHCF/ITL, or any
// downstream total — see calculateMarine() in ./marine.ts (the single
// authoritative version).
export const MARINE_STAMP_DUTY_RATE = 0.05;

// Phase 13B — Marine Insurance has a minimum chargeable Base Premium. When
// the rated premium (Sum Insured x Rate, summed over the shipment rows)
// falls below this, the quote is charged this floor instead, and PHCF / ITL
// / Total are all derived from the floored value. Marine only — every other
// product keeps its own base-premium rule unchanged.
export const MARINE_MINIMUM_BASE_PREMIUM = 5000;

// Marine's Incidental Loading is a fixed 10% of each shipment's Original Sum
// Insured (10 meaning 10%, same convention as every rate above), added on
// top of Sum Insured to form the Basic Sum Insured that Rate is actually
// applied to: Basic Sum Insured = Sum Insured x 1.1. See
// insuranceCalculations/marine.ts for the single authoritative
// implementation — never re-derive this elsewhere.
export const MARINE_INCIDENTAL_LOADING_RATE = 10;

// Fire & Perils' Earthquake/Flood Loading are fixed business rates, not
// user-entered — the page only offers Yes/No, and when Yes, this is the
// rate applied (0.025 meaning 0.025%, same convention as PHCF_RATE).
export const FIRE_EARTHQUAKE_LOADING_RATE = 0.025;
export const FIRE_FLOOD_LOADING_RATE = 0.01;
