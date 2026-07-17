"use client";

import { useMemo } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { previewMotorComprehensive } from "@/lib/insuranceCalculations/clientPreview";
import type { MotorComprehensiveDraft } from "@/components/quotations/sectionDrafts";

// Shared by Motor Comprehensive - Private and - Commercial (identical
// fields/calculation) — the two are kept as separate section kinds/models,
// this component is just rendered twice with different draft state.
export function MotorComprehensiveSection({
  draft,
  onChange,
  datalistId,
}: {
  draft: MotorComprehensiveDraft;
  onChange: (patch: Partial<MotorComprehensiveDraft>) => void;
  datalistId: string;
}) {
  const { t } = useLocale();

  const totals = useMemo(() => previewMotorComprehensive(draft), [draft]);

  return (
    <div>
      <datalist id={datalistId}>
        <option value={t.quotations.motorTextInclusive} />
        <option value={t.quotations.motorTextExcluded} />
        <option value={t.quotations.motorTextOptional} />
      </datalist>
      <div className="form-grid">
        <FormField label={t.quotations.motorPlateNo}>
          <Input value={draft.plateNo} onChange={(e) => onChange({ plateNo: e.target.value })} required />
        </FormField>
        <FormField label={t.quotations.motorVehicleValue}>
          <MoneyInput value={draft.vehicleValue} onChange={(v) => onChange({ vehicleValue: v })} required />
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
        <FormField label={t.quotations.motorExcessProtector}>
          <Input
            list={datalistId}
            value={draft.excessProtector}
            onChange={(e) => onChange({ excessProtector: e.target.value })}
          />
        </FormField>
        <FormField label={t.quotations.motorPvt}>
          <Input list={datalistId} value={draft.pvt} onChange={(e) => onChange({ pvt: e.target.value })} />
        </FormField>
        <FormField label={t.quotations.motorRate}>
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
