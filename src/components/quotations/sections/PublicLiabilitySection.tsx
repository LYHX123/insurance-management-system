"use client";

import { useMemo } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { previewPublicLiability } from "@/lib/insuranceCalculations/clientPreview";
import type { PublicLiabilityDraft } from "@/components/quotations/sectionDrafts";

export function PublicLiabilitySection({
  draft,
  onChange,
}: {
  draft: PublicLiabilityDraft;
  onChange: (patch: Partial<PublicLiabilityDraft>) => void;
}) {
  const { t } = useLocale();

  const totals = useMemo(() => previewPublicLiability(draft), [draft]);

  return (
    <div>
      <div className="form-grid">
        <FormField label={t.quotations.anyOnePersonLimit}>
          <MoneyInput
            value={draft.anyOnePersonLimit}
            onChange={(v) => onChange({ anyOnePersonLimit: v })}
          />
        </FormField>
        <FormField label={t.quotations.anyOneOccurrenceLimit}>
          <MoneyInput
            value={draft.anyOneOccurrenceLimit}
            onChange={(v) => onChange({ anyOneOccurrenceLimit: v })}
          />
        </FormField>
        <FormField label={t.quotations.anyOneYearLimit}>
          <MoneyInput
            value={draft.anyOneYearLimit}
            onChange={(v) => onChange({ anyOneYearLimit: v })}
            required
          />
        </FormField>
        <FormField label={t.quotations.plRate}>
          <Input
            type="number"
            step="0.0001"
            min="0"
            value={draft.rate}
            onChange={(e) => onChange({ rate: e.target.value })}
            required
          />
        </FormField>
      </div>
      <p className="mt-1 text-sm text-secondary">{t.quotations.plBasisNote}</p>

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
