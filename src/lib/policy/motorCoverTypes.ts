// The six clean, real "TYPE OF COVER" values found in the Phase 1A
// historical workbook inspection (BUSINESS RECORD(MOTOR), column C) — kept
// as an app-level known-values list rather than a Prisma enum so a future,
// previously-unseen cover type never needs a migration (see
// MotorPolicyDetail.insuranceType's schema comment). New/unrecognized values
// are still accepted (not rejected) — see normalizeCoverType.
export const MOTOR_COVER_TYPES = [
  "COMPREHENSIVE",
  "THIRD PARTY",
  "COMESA",
  "EXCESS",
  "EXCESS PROTECTOR",
  "VALUATION",
] as const;

export type MotorCoverType = (typeof MOTOR_COVER_TYPES)[number];

export function isKnownMotorCoverType(value: string): value is MotorCoverType {
  return (MOTOR_COVER_TYPES as readonly string[]).includes(value);
}

// THIRD PARTY and COMESA covers legitimately have no vehicle value in this
// business's historical data (592/594 THIRD PARTY rows and most COMESA rows
// are blank) — a blank vehicleValue for any other cover type is unusual
// enough to warrant a review warning during import.
export function coverTypeExpectsNoVehicleValue(coverType: string): boolean {
  const upper = coverType.trim().toUpperCase();
  return upper === "THIRD PARTY" || upper === "COMESA";
}
