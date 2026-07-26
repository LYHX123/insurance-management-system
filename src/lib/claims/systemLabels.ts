import type { MotorClaimProgressValue, NonMotorClaimProgressValue } from "@/lib/claims/enums";

// English-only labels used exclusively to compose system-generated timeline
// sentences (see this phase's spec, Part H.26/32 — "Acceptable for this
// phase: ... one concise English system-generated entry, consistent with
// existing system activity logs", matching PolicyActivity.summary's
// existing convention of plain, always-English sentences). Deliberately
// separate from the i18n dictionary's translated `t.claims.progress*`
// labels, which are for UI chrome, not stored data.
export const MOTOR_PROGRESS_EN_LABEL: Record<MotorClaimProgressValue, string> = {
  PREPARE_CLAIM_DOCUMENT: "Prepare Claim Document",
  ASSESSMENT_PROCESS: "Assessment Process",
  APPROVAL_AND_REPAIR: "Approval and Repair",
  RE_INSPECTION_AND_RELEASE: "Re-inspection and Release",
  FINISH: "Finish",
};

export const NON_MOTOR_PROGRESS_EN_LABEL: Record<NonMotorClaimProgressValue, string> = {
  DOCUMENT_PREPARATION: "Document Preparation",
  LOSS_ASSESSMENT_INVESTIGATION: "Loss Assessment / Investigation",
  APPROVAL: "Approval",
  DV_ISSUED: "DV Issued",
  PAYMENT: "Payment",
  FINISH: "Finish",
};
