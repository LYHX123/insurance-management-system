"use client";

import { useLocale } from "@/i18n/locale-provider";
import { Badge } from "@/components/ui/badge";
import type { PolicyRenewalDecision } from "@/generated/prisma/enums";

// Phase 12D — the compact Period / Renewal indicator shown next to the
// record number in every policy list. Deliberately not a whole column
// (spec §11): a renewal shows "Renewal N"; an original shows a small badge
// only once a decision has been recorded.
export function RenewalBadge({
  renewalIndex,
  renewalDecision,
}: {
  renewalIndex: number;
  renewalDecision: PolicyRenewalDecision | null;
}) {
  const { t } = useLocale();

  if (renewalIndex >= 1) {
    return <Badge tone="brand">{t.policy.renewalNumbered.replace("{n}", String(renewalIndex))}</Badge>;
  }
  if (renewalDecision === "RENEWED") return <Badge tone="success">{t.policy.renewalRenewed}</Badge>;
  if (renewalDecision === "NOT_RENEWED") return <Badge tone="neutral">{t.policy.renewalNotRenewed}</Badge>;
  return null;
}
