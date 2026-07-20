"use client";

import { useMemo } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Input } from "@/components/ui/input";
import { RateInput } from "@/components/ui/rate-input";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { previewGuarantee } from "@/lib/insuranceCalculations/clientPreview";
import type { GuaranteeDraft } from "@/components/quotations/sectionDrafts";

// Shared by Tender Security, Performance Bond and Advance Payment Guarantee
// — identical fields/formula. Each is rendered as its own CollapsibleCard
// with its own draft state, so all three can be selected together.
export function GuaranteeSection({
  draft,
  onChange,
}: {
  draft: GuaranteeDraft;
  onChange: (patch: Partial<GuaranteeDraft>) => void;
}) {
  const { t } = useLocale();

  const totals = useMemo(() => previewGuarantee(draft), [draft]);

  return (
    <div>
      <div className="form-grid">
        <FormField label={t.quotations.guaranteeProjectName}>
          <Input value={draft.projectName} onChange={(e) => onChange({ projectName: e.target.value })} required />
        </FormField>
        <FormField label={t.quotations.bondValue}>
          <MoneyInput value={draft.bondValue} onChange={(v) => onChange({ bondValue: v })} required />
        </FormField>
        <FormField label={t.quotations.bondRate}>
          <RateInput
            value={draft.rate}
            onChange={(e) => onChange({ rate: e.target.value })}
            required
          />
        </FormField>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-control bg-zinc-50 p-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-secondary">{t.quotations.premium}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.grossPremium)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.phcf}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.phcfAmount)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.itl}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.itlAmount)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.sectionTotal}</div>
          <div className="font-semibold text-emerald-800">{formatMoney(totals.totalPremium)}</div>
        </div>
      </div>
    </div>
  );
}
