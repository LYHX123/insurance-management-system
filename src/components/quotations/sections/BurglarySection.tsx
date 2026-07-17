"use client";

import { useMemo } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { previewBurglary } from "@/lib/insuranceCalculations/clientPreview";
import type { BurglaryDraft } from "@/components/quotations/sectionDrafts";

export function BurglarySection({
  draft,
  onChange,
}: {
  draft: BurglaryDraft;
  onChange: (patch: Partial<BurglaryDraft>) => void;
}) {
  const { t } = useLocale();

  const totals = useMemo(() => previewBurglary(draft), [draft]);

  return (
    <div>
      <div className="form-grid">
        <FormField label={t.quotations.equipmentValue}>
          <MoneyInput value={draft.equipmentValue} onChange={(v) => onChange({ equipmentValue: v })} />
        </FormField>
        <FormField label={t.quotations.stockValue}>
          <MoneyInput value={draft.stockValue} onChange={(v) => onChange({ stockValue: v })} />
        </FormField>
        <FormField label={t.quotations.firstLossPercentage}>
          <Input
            type="number"
            step="0.0001"
            min="0"
            value={draft.firstLossPercentage}
            onChange={(e) => onChange({ firstLossPercentage: e.target.value })}
            required
          />
        </FormField>
        <FormField label={t.quotations.burglaryRate}>
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

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-control bg-zinc-50 p-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-secondary">{t.quotations.totalValue}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.totalValue)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.firstLossSumInsured}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.firstLossSumInsured)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.premium}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.grossPremium)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.sectionTotal}</div>
          <div className="font-semibold text-emerald-800">{formatMoney(totals.totalPremium)}</div>
        </div>
      </div>
    </div>
  );
}
