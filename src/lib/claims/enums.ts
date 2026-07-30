import type { BadgeTone } from "@/components/ui/badge";

// Mirrors the Prisma MotorClaimNature/MotorClaimProgress/NonMotorClaimProgress
// enums exactly (see schema.prisma), same pattern as
// src/lib/policy/nonMotorCoverTypes.ts — the array doubles as both the
// server-side validation source and the UI's option-list source, so there
// is exactly one place that can ever drift from the Prisma enum.

export const MOTOR_CLAIM_NATURES = ["OWN_DAMAGE", "THIRD_PARTY_CLAIM", "WINDSCREEN", "ACCIDENT"] as const;
export type MotorClaimNatureValue = (typeof MOTOR_CLAIM_NATURES)[number];
export function isMotorClaimNature(value: string): value is MotorClaimNatureValue {
  return (MOTOR_CLAIM_NATURES as readonly string[]).includes(value);
}

// Fixed business order (see this phase's spec, Part C.10) — never re-sorted.
export const MOTOR_CLAIM_PROGRESS_VALUES = [
  "PREPARE_CLAIM_DOCUMENT",
  "ASSESSMENT_PROCESS",
  "APPROVAL_AND_REPAIR",
  "RE_INSPECTION_AND_RELEASE",
  "FINISH",
] as const;
export type MotorClaimProgressValue = (typeof MOTOR_CLAIM_PROGRESS_VALUES)[number];
export function isMotorClaimProgress(value: string): value is MotorClaimProgressValue {
  return (MOTOR_CLAIM_PROGRESS_VALUES as readonly string[]).includes(value);
}

// Fixed business order (see this phase's spec, Part F.29).
export const NON_MOTOR_CLAIM_PROGRESS_VALUES = [
  "DOCUMENT_PREPARATION",
  "LOSS_ASSESSMENT_INVESTIGATION",
  "APPROVAL",
  "DV_ISSUED",
  "PAYMENT",
  "FINISH",
] as const;
export type NonMotorClaimProgressValue = (typeof NON_MOTOR_CLAIM_PROGRESS_VALUES)[number];
export function isNonMotorClaimProgress(value: string): value is NonMotorClaimProgressValue {
  return (NON_MOTOR_CLAIM_PROGRESS_VALUES as readonly string[]).includes(value);
}

export const CLAIM_STATUS_VALUES = ["OPEN", "CLOSED"] as const;
export type ClaimStatusValue = (typeof CLAIM_STATUS_VALUES)[number];

// Semantic color mapping for Progress badges (see this phase's spec, Part
// E.16/17) — deliberately a plain color tone per stage, independent of
// Badge component's tone semantics elsewhere in the app; only the 6
// existing tones plus 2 additive ones (purple, teal — see
// src/components/ui/badge.tsx) are used, never a hard-coded illegible
// foreground/background combination.
export const MOTOR_CLAIM_PROGRESS_TONE: Record<MotorClaimProgressValue, BadgeTone> = {
  PREPARE_CLAIM_DOCUMENT: "neutral",
  ASSESSMENT_PROCESS: "warning",
  APPROVAL_AND_REPAIR: "info",
  RE_INSPECTION_AND_RELEASE: "purple",
  FINISH: "success",
};

export const NON_MOTOR_CLAIM_PROGRESS_TONE: Record<NonMotorClaimProgressValue, BadgeTone> = {
  DOCUMENT_PREPARATION: "neutral",
  LOSS_ASSESSMENT_INVESTIGATION: "warning",
  APPROVAL: "info",
  DV_ISSUED: "purple",
  PAYMENT: "teal",
  FINISH: "success",
};

// Dropbox Integration Phase 7 — mirrors the Prisma MotorClaimDocumentType/
// NonMotorClaimDocumentType enums exactly, same reasoning as the arrays
// above.
export const MOTOR_CLAIM_DOCUMENT_TYPES = [
  "CLAIM_FORM",
  "POLICE_ABSTRACT",
  "DRIVER_LICENSE",
  "LOGBOOK",
  "INSURANCE_CERTIFICATE",
  "ASSESSMENT_REPORT",
  "REPAIR_ESTIMATE",
  "REPAIR_INVOICE",
  "REINSPECTION_REPORT",
  "DISCHARGE_VOUCHER",
  "RELEASE_LETTER",
  "PHOTOS",
  "OTHER",
] as const;
export type MotorClaimDocumentTypeValue = (typeof MOTOR_CLAIM_DOCUMENT_TYPES)[number];

export const NON_MOTOR_CLAIM_DOCUMENT_TYPES = [
  "CLAIM_FORM",
  "INCIDENT_REPORT",
  "SURVEY_REPORT",
  "ASSESSMENT_REPORT",
  "SUPPORTING_DOCUMENT",
  "REPAIR_ESTIMATE",
  "REPAIR_INVOICE",
  "SETTLEMENT_OFFER",
  "DISCHARGE_VOUCHER",
  "SETTLEMENT_LETTER",
  "PHOTOS",
  "OTHER",
] as const;
export type NonMotorClaimDocumentTypeValue = (typeof NON_MOTOR_CLAIM_DOCUMENT_TYPES)[number];
