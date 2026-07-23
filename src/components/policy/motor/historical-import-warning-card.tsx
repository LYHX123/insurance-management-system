"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ResolveBalanceModal } from "@/components/policy/motor/resolve-balance-modal";
import type { MotorDetail, PolicyBalanceWarningReason } from "@/components/policy/types";

// Phase 1A.2: a single, compact, collapsed-by-default card — never inline
// amber banners inside the Customer/Insurer cards, never surfaced on the
// Motor list or Dashboard (see this phase's spec). Rendered only when at
// least one side is UNVERIFIED; a VERIFIED side never shows a warning at
// all, even inside this card once expanded.
export function HistoricalImportWarningCard({ detail, onResolved }: { detail: MotorDetail; onResolved: () => void }) {
  const { t, locale } = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });
  const [expanded, setExpanded] = useState(false);
  const [resolving, setResolving] = useState<"insurer" | "client" | null>(null);

  const insurerUnverified = detail.insurerBalanceVerification === "UNVERIFIED";
  const clientUnverified = detail.clientBalanceVerification === "UNVERIFIED";
  if (!insurerUnverified && !clientUnverified) return null;

  const reasonLabel: Record<PolicyBalanceWarningReason, string> = {
    BROKEN_SOURCE_FORMULA: t.policy.balanceReasonBrokenFormula,
    BLANK_SOURCE_BALANCE: t.policy.balanceReasonBlankBalance,
    OTHER_UNREADABLE_BALANCE: t.policy.balanceReasonOtherUnreadable,
  };

  const sideDetail = (
    side: "insurer" | "client",
    unverified: boolean,
    reason: PolicyBalanceWarningReason | null,
    raw: string | null,
    resolutionNote: string | null,
    resolvedAt: string | null,
    resolvedByName: string | null
  ) => (
    <div className="rounded-control border border-zinc-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-800">
          {side === "insurer" ? t.policy.insurerCardTitle : t.policy.customerCardTitle}
        </span>
        {unverified ? (
          <Badge tone="warning">{t.policy.unverifiedShort}</Badge>
        ) : (
          <Badge tone="success">{t.policy.verifiedShort}</Badge>
        )}
      </div>
      {unverified ? (
        <div className="flex flex-col gap-1 text-sm text-zinc-600">
          <div>
            <span className="text-secondary">{t.policy.balanceWarningReason}: </span>
            {reason ? reasonLabel[reason] : "—"}
          </div>
          <div>
            <span className="text-secondary">{t.policy.originalRawValue}: </span>
            {raw || "—"}
          </div>
          <div>
            <span className="text-secondary">{t.policy.sourceSheet}: </span>
            {detail.sourceSheet || "—"}
          </div>
          <div>
            <span className="text-secondary">{t.policy.originalRowNumber}: </span>
            {detail.originalRowNumber ?? "—"}
          </div>
          <Button variant="secondary" className="mt-2 self-start" onClick={() => setResolving(side)}>
            {t.policy.resolveBalance}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1 text-sm text-zinc-600">
          {resolutionNote && (
            <div>
              <span className="text-secondary">{t.policy.resolutionNote}: </span>
              {resolutionNote}
            </div>
          )}
          {resolvedAt && (
            <div>
              <span className="text-secondary">{t.policy.resolvedAt}: </span>
              {dateFormatter.format(new Date(resolvedAt))}
              {resolvedByName ? ` (${resolvedByName})` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Card className="border-amber-200">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium text-amber-800">
          <AlertTriangle size={16} />
          {t.policy.historicalImportWarningTitle}
        </span>
        {expanded ? <ChevronDown size={16} className="text-zinc-400" /> : <ChevronRight size={16} className="text-zinc-400" />}
      </button>
      {!expanded && (
        <p className="mt-1 text-xs text-secondary">
          {insurerUnverified && clientUnverified
            ? t.policy.historicalImportWarningBothSummary
            : insurerUnverified
              ? t.policy.historicalImportWarningInsurerSummary
              : t.policy.historicalImportWarningClientSummary}
        </p>
      )}
      {expanded && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-secondary">{t.policy.historicalImportWarningExplanation}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {sideDetail(
              "insurer",
              insurerUnverified,
              detail.insurerBalanceWarningReason,
              detail.insurerBalanceRaw,
              detail.insurerBalanceResolutionNote,
              detail.insurerBalanceResolvedAt,
              detail.insurerBalanceResolvedByName
            )}
            {sideDetail(
              "client",
              clientUnverified,
              detail.clientBalanceWarningReason,
              detail.clientBalanceRaw,
              detail.clientBalanceResolutionNote,
              detail.clientBalanceResolvedAt,
              detail.clientBalanceResolvedByName
            )}
          </div>
        </div>
      )}

      {resolving && (
        <ResolveBalanceModal
          policyRecordId={detail.id}
          side={resolving}
          currentAmount={resolving === "insurer" ? detail.insurerCost : detail.customerPremium}
          onClose={() => setResolving(null)}
          onSuccess={() => {
            setResolving(null);
            onResolved();
          }}
        />
      )}
    </Card>
  );
}
