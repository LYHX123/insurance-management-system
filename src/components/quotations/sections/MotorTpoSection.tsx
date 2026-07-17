"use client";

import { useMemo } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { previewMotorTpo } from "@/lib/insuranceCalculations/clientPreview";
import type { MotorTpoDraft } from "@/components/quotations/sectionDrafts";

// Shared by Motor TPO - Private and - Commercial. Private never shows
// Loading Capacity (Commercial-only field) — the draft still carries it so
// the same component/state-shape can serve both variants.
export function MotorTpoSection({
  draft,
  onChange,
  showLoadingCapacity,
}: {
  draft: MotorTpoDraft;
  onChange: (patch: Partial<MotorTpoDraft>) => void;
  showLoadingCapacity: boolean;
}) {
  const { t } = useLocale();

  const totals = useMemo(() => previewMotorTpo(draft), [draft]);

  return (
    <div>
      <div className="form-grid">
        <FormField label={t.quotations.motorPlateNo}>
          <Input value={draft.plateNo} onChange={(e) => onChange({ plateNo: e.target.value })} required />
        </FormField>
        {showLoadingCapacity && (
          <FormField label={t.quotations.motorLoadingCapacity}>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={draft.loadingCapacity}
              onChange={(e) => onChange({ loadingCapacity: e.target.value })}
            />
          </FormField>
        )}
        <FormField label={t.quotations.motorTpoBasePremium}>
          <MoneyInput value={draft.basePremium} onChange={(v) => onChange({ basePremium: v })} required />
        </FormField>
        <FormField label={t.quotations.motorPeriodFrom}>
          <Input
            type="date"
            value={draft.periodFrom}
            onChange={(e) => onChange({ periodFrom: e.target.value })}
            required
          />
        </FormField>
        <FormField label={t.quotations.motorPeriodTo}>
          <Input
            type="date"
            value={draft.periodTo}
            onChange={(e) => onChange({ periodTo: e.target.value })}
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
