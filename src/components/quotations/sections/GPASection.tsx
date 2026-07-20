"use client";

import { useMemo } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Input } from "@/components/ui/input";
import { RateInput } from "@/components/ui/rate-input";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { previewGpa } from "@/lib/insuranceCalculations/clientPreview";
import type { GpaDraft } from "@/components/quotations/sectionDrafts";

export function GPASection({
  draft,
  onChange,
}: {
  draft: GpaDraft;
  onChange: (patch: Partial<GpaDraft>) => void;
}) {
  const { t } = useLocale();

  const totals = useMemo(() => previewGpa(draft), [draft]);

  return (
    <div>
      <div className="form-grid">
        <FormField label={t.quotations.deathLimit}>
          <MoneyInput value={draft.deathLimit} onChange={(v) => onChange({ deathLimit: v })} />
        </FormField>
        <FormField label={t.quotations.deathRate}>
          <RateInput value={draft.deathRate} onChange={(e) => onChange({ deathRate: e.target.value })} />
        </FormField>
        <FormField label={t.quotations.ptdLimit}>
          <MoneyInput value={draft.ptdLimit} onChange={(v) => onChange({ ptdLimit: v })} />
        </FormField>
        <FormField label={t.quotations.ptdRate}>
          <RateInput value={draft.ptdRate} onChange={(e) => onChange({ ptdRate: e.target.value })} />
        </FormField>
        <FormField label={t.quotations.ttdLimit}>
          <MoneyInput value={draft.ttdLimit} onChange={(v) => onChange({ ttdLimit: v })} />
        </FormField>
        <FormField label={t.quotations.ttdRate}>
          <RateInput value={draft.ttdRate} onChange={(e) => onChange({ ttdRate: e.target.value })} />
        </FormField>
        <FormField label={t.quotations.gpaMedicalLimit}>
          <MoneyInput value={draft.medicalLimit} onChange={(v) => onChange({ medicalLimit: v })} />
        </FormField>
        <FormField label={t.quotations.gpaMedicalRate}>
          <RateInput value={draft.medicalRate} onChange={(e) => onChange({ medicalRate: e.target.value })} />
        </FormField>
        <FormField label={t.quotations.funeralLimit}>
          <MoneyInput value={draft.funeralLimit} onChange={(v) => onChange({ funeralLimit: v })} />
        </FormField>
        <FormField label={t.quotations.funeralRate}>
          <RateInput value={draft.funeralRate} onChange={(e) => onChange({ funeralRate: e.target.value })} />
        </FormField>
        <FormField label={t.quotations.numberOfPeople}>
          <Input
            type="number"
            step="1"
            min="0"
            value={draft.numberOfPeople}
            onChange={(e) => onChange({ numberOfPeople: e.target.value })}
            required
          />
        </FormField>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-control bg-zinc-50 p-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-secondary">{t.quotations.deathPremium}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.deathPremium)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.ptdPremium}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.ptdPremium)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.ttdPremium}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.ttdPremium)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.gpaMedicalPremium}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.medicalPremium)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.funeralPremium}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.funeralPremium)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.premiumPerPerson}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.premiumPerPerson)}</div>
        </div>
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
          <div className="text-secondary">{t.quotations.stampDuty}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.stampDutyAmount)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.sectionTotal}</div>
          <div className="font-semibold text-emerald-800">{formatMoney(totals.totalPremium)}</div>
        </div>
      </div>
    </div>
  );
}
