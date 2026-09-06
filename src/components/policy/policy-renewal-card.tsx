"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RefreshCw, Ban, ExternalLink } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { setPolicyRenewalDecisionAction } from "@/app/(app)/policy/renewal/actions";
import { RENEWAL_CATEGORY_ROUTE, type RenewalChainMember } from "@/lib/policy/renewal";
import type { PolicyCategory, PolicyRenewalDecision } from "@/generated/prisma/enums";

export type PolicyRenewalView = {
  renewalIndex: number;
  renewalDecision: PolicyRenewalDecision | null;
  hasSuccessor: boolean;
  chain: RenewalChainMember[];
};

const DECISION_ERROR_KEY: Record<string, string> = {
  FORBIDDEN: "genericError",
  RECORD_NOT_FOUND: "recordNotFound",
  HAS_SUCCESSOR: "renewalHasSuccessorError",
  ALREADY_NOT_RENEWED: "renewalAlreadyNotRenewed",
  ALREADY_RENEWED: "renewalAlreadyRenewedError",
  NOT_REOPENABLE: "genericError",
  UPDATE_FAILED: "updateFailedError",
};

function periodLabel(t: ReturnType<typeof useLocale>["t"], renewalIndex: number): string {
  return renewalIndex <= 0 ? t.policy.renewalOriginal : t.policy.renewalNumbered.replace("{n}", String(renewalIndex));
}

const DECISION_TONE: Record<PolicyRenewalDecision, BadgeTone> = {
  PENDING: "warning",
  RENEWED: "success",
  NOT_RENEWED: "neutral",
};

export function PolicyRenewalCard({
  policyRecordId,
  category,
  canEdit,
  renewal,
}: {
  policyRecordId: string;
  category: PolicyCategory;
  canEdit: boolean;
  renewal: PolicyRenewalView;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });
  const route = RENEWAL_CATEGORY_ROUTE[category];

  const [confirm, setConfirm] = useState<null | "not_renew" | "reopen">(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decision = renewal.renewalDecision ?? "PENDING";
  const decisionLabel: Record<PolicyRenewalDecision, string> = {
    PENDING: t.policy.renewalPending,
    RENEWED: t.policy.renewalRenewed,
    NOT_RENEWED: t.policy.renewalNotRenewed,
  };

  // UI gates — the server action re-checks all of this.
  const canRenew = canEdit && !renewal.hasSuccessor && decision !== "NOT_RENEWED";
  const canNotRenew = canEdit && !renewal.hasSuccessor && decision === "PENDING";
  const canReopen = canEdit && !renewal.hasSuccessor && decision === "NOT_RENEWED";

  const submitDecision = async (next: "NOT_RENEWED" | "PENDING") => {
    setBusy(true);
    setError(null);
    const res = await setPolicyRenewalDecisionAction(policyRecordId, next, next === "NOT_RENEWED" ? note : null);
    setBusy(false);
    if (!res.success) {
      setError(t.policy[(DECISION_ERROR_KEY[res.error] ?? "genericError") as keyof typeof t.policy] as string);
      return;
    }
    setConfirm(null);
    setNote("");
    router.refresh();
  };

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">{t.policy.renewalHistoryTitle}</h2>
        <div className="flex items-center gap-2">
          <Badge tone="brand">{periodLabel(t, renewal.renewalIndex)}</Badge>
          <Badge tone={DECISION_TONE[decision]}>{decisionLabel[decision]}</Badge>
        </div>
      </div>

      {/* Chain — chronological, every period visible, View opens its detail page. */}
      <ol className="flex flex-col gap-2">
        {renewal.chain.map((m) => (
          <li
            key={m.id}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border px-3 py-2 text-sm ${
              m.isCurrent ? "border-emerald-200 bg-emerald-50" : "border-zinc-200"
            }`}
          >
            <span className="font-medium text-zinc-800">{periodLabel(t, m.renewalIndex)}</span>
            <span className="text-zinc-500">{m.recordNumber}</span>
            <span className="text-zinc-400">
              {dateFormatter.format(new Date(m.effectiveDate))} – {dateFormatter.format(new Date(m.expiryDate))}
            </span>
            <span className="text-zinc-500">{m.businessStatus}</span>
            {m.renewalDecision && <span className="text-zinc-400">· {decisionLabel[m.renewalDecision]}</span>}
            {!m.isCurrent && (
              <Link href={`${route}/${m.id}`} className="ml-auto inline-flex items-center gap-1 text-emerald-700 hover:underline">
                <ExternalLink size={13} />
                {t.policy.view}
              </Link>
            )}
          </li>
        ))}
      </ol>

      {(canRenew || canNotRenew || canReopen) && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {canReopen && (
            <Button variant="secondary" onClick={() => setConfirm("reopen")}>
              <RefreshCw size={16} />
              {t.policy.reopenRenewal}
            </Button>
          )}
          {canNotRenew && (
            <Button variant="secondary" onClick={() => setConfirm("not_renew")}>
              <Ban size={16} />
              {t.policy.doNotRenew}
            </Button>
          )}
          {canRenew && (
            <Link href={`${route}/${policyRecordId}/renew`}>
              <Button>
                <RefreshCw size={16} />
                {t.policy.renewPolicy}
              </Button>
            </Link>
          )}
        </div>
      )}

      {error && !confirm && (
        <p role="alert" className="form-error mt-3">
          {error}
        </p>
      )}

      {confirm === "not_renew" && (
        <Modal
          title={t.policy.doNotRenew}
          onClose={() => {
            setConfirm(null);
            setError(null);
          }}
        >
          <p className="text-body">{t.policy.doNotRenewConfirmMessage}</p>
          <div className="mt-3">
            <label className="mb-1 block text-sm font-medium text-zinc-700">{t.policy.renewalReasonOptional}</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={t.policy.renewalReasonPlaceholder}
            />
          </div>
          {error && (
            <p role="alert" className="form-error mt-2">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setConfirm(null);
                setError(null);
              }}
              disabled={busy}
            >
              {t.common.cancel}
            </Button>
            <Button variant="destructive" onClick={() => submitDecision("NOT_RENEWED")} disabled={busy}>
              {t.common.confirm}
            </Button>
          </div>
        </Modal>
      )}

      {confirm === "reopen" && (
        <ConfirmDialog
          title={t.policy.reopenRenewal}
          message={error ?? t.policy.reopenRenewalConfirmMessage}
          isSubmitting={busy}
          onConfirm={() => submitDecision("PENDING")}
          onClose={() => {
            setConfirm(null);
            setError(null);
          }}
        />
      )}
    </Card>
  );
}
