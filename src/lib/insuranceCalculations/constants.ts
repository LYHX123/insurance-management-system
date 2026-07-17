// Centralized Phase 1 calculation constants. Rates follow the same
// convention as InsuranceType.defaultPHCFRate/defaultITLRate: a displayed
// rate of 0.25% is stored/used as the number 0.25, not the fraction 0.0025
// (see percentOf() in ../money.ts, which divides by 100).
//
// Do not inline 0.25 / 0.2 / 40 / 25 anywhere else — import from here.

export const PHCF_RATE = 0.25;
export const ITL_RATE = 0.2;
export const STAMP_DUTY = 40;

// Employer's Liability gross premium is a fixed 25% of the linked WIBA
// section's gross premium (expressed in the same "percentage points"
// convention as the rates above, i.e. used via percentOf(wibaGross, 25)).
export const EL_PERCENT_OF_WIBA = 25;

// Marine Cover is the only section kind that does not use the fixed
// KES 40 STAMP_DUTY above — its stamp duty is a percentage of the total
// sum insured instead (0.05 meaning 0.05%, same convention as PHCF_RATE).
export const MARINE_STAMP_DUTY_RATE = 0.05;
