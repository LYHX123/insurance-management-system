"use client";

import { useLocale } from "@/i18n/locale-provider";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { MotorValuationStatus } from "@/lib/policy/motorValuation";

// Phase 12C — the one place the valuation-status -> badge tone/label mapping
// lives, reused by the Motor list column and the Motor detail Overview. This
// is NOT the policy Status badge (see STATUS_TONE in motor-list-table.tsx) —
// the two are independent concepts.
const VALUATION_TONE: Record<MotorValuationStatus, BadgeTone> = {
  NOT_ARRANGED: "warning",
  IN_PROGRESS: "brand",
  COMPLETED: "success",
};

export function MotorValuationBadge({ status }: { status: MotorValuationStatus }) {
  const { t } = useLocale();
  const label: Record<MotorValuationStatus, string> = {
    NOT_ARRANGED: t.policy.valuationBadgeNotArranged,
    IN_PROGRESS: t.policy.valuationBadgeInProgress,
    COMPLETED: t.policy.valuationBadgeCompleted,
  };
  return <Badge tone={VALUATION_TONE[status]}>{label[status]}</Badge>;
}
