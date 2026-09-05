// Phase 12C — Motor COMPREHENSIVE vehicle-valuation workflow. Small
// app-level helpers, mirroring motorTaxClasses.ts's shape. The valuation
// workflow applies ONLY to Comprehensive cover (see the spec / the
// MotorValuationStatus enum's schema comment).

export const MOTOR_VALUATION_STATUSES = ["NOT_ARRANGED", "IN_PROGRESS", "COMPLETED"] as const;

export type MotorValuationStatus = (typeof MOTOR_VALUATION_STATUSES)[number];

// The default status a newly-created Comprehensive policy gets — the real
// business flow creates the policy (and its ~1-month initial cover) before
// the customer's contact details are even available to the valuer.
export const DEFAULT_MOTOR_VALUATION_STATUS: MotorValuationStatus = "NOT_ARRANGED";

export function isMotorValuationStatus(value: string | null | undefined): value is MotorValuationStatus {
  return typeof value === "string" && (MOTOR_VALUATION_STATUSES as readonly string[]).includes(value);
}

// The single definition of "does the valuation workflow apply to this Motor
// cover type". Case-insensitive exact match on "COMPREHENSIVE" — never a
// substring/prefix test, so "EXCESS PROTECTOR" etc. never match.
export function isComprehensiveMotorCover(insuranceType: string | null | undefined): boolean {
  return (insuranceType ?? "").trim().toUpperCase() === "COMPREHENSIVE";
}

// The valuation-pending reminder fires while a Comprehensive policy's
// valuation is explicitly being tracked but not finished. NULL (historical /
// non-Comprehensive) is deliberately NOT "pending" — those get only the
// normal expiry reminder, never a "temporary cover, valuation outstanding"
// one they were never part of.
export function isValuationPending(insuranceType: string | null | undefined, status: MotorValuationStatus | null | undefined): boolean {
  return isComprehensiveMotorCover(insuranceType) && (status === "NOT_ARRANGED" || status === "IN_PROGRESS");
}
