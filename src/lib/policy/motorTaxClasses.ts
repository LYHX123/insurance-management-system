// Backs the required MotorPolicyDetail.taxClass enum (see that field's
// schema comment) — unlike MOTOR_COVER_TYPES, this is a real closed set with
// no history of previously-unseen values, so it mirrors the Prisma enum
// exactly rather than being an open, app-validated string list.
export const MOTOR_TAX_CLASSES = ["PRIVATE", "COMMERCIAL", "SPV", "SPECIAL_USE"] as const;

export type MotorTaxClass = (typeof MOTOR_TAX_CLASSES)[number];

export function isMotorTaxClass(value: string): value is MotorTaxClass {
  return (MOTOR_TAX_CLASSES as readonly string[]).includes(value);
}
