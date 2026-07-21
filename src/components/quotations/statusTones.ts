import type { QuotationStatus, RevisionStatus, QuotationCaseStatus } from "@/components/quotations/types";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger";

export const STATUS_TONE: Record<QuotationStatus, Tone> = {
  DRAFT: "neutral",
  ISSUED: "brand",
  ACCEPTED: "success",
  REJECTED: "danger",
  EXPIRED: "warning",
  CANCELLED: "danger",
};

export const REVISION_TONE: Record<RevisionStatus, Tone> = {
  DRAFT: "neutral",
  ISSUED: "brand",
  SUPERSEDED: "warning",
  ACCEPTED: "success",
  CANCELLED: "danger",
};

export const CASE_STATUS_TONE: Record<QuotationCaseStatus, Tone> = {
  DRAFT: "neutral",
  IN_PROGRESS: "brand",
  QUOTED: "brand",
  ACCEPTED: "success",
  DECLINED: "danger",
  EXPIRED: "warning",
  CONVERTED_TO_POLICY: "success",
};
