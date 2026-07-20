"use client";

import { useMemo } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Input } from "@/components/ui/input";
import { RateInput } from "@/components/ui/rate-input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { previewGitAnnual } from "@/lib/insuranceCalculations/clientPreview";
import type { GitAnnualDraft } from "@/components/quotations/sectionDrafts";

export function GITAnnualSection({
  draft,
  onChange,
}: {
  draft: GitAnnualDraft;
  onChange: (patch: Partial<GitAnnualDraft>) => void;
}) {
  const { t } = useLocale();

  const totals = useMemo(() => previewGitAnnual(draft), [draft]);

  return (
    <div>
      <FormField label={t.quotations.cargoDescription}>
        <Textarea
          value={draft.cargoDescription}
          onChange={(e) => onChange({ cargoDescription: e.target.value })}
          required
        />
      </FormField>

      <div className="form-grid mt-field">
        <FormField label={t.quotations.anyOneConsignmentLimit}>
          <MoneyInput value={draft.singleLimit} onChange={(v) => onChange({ singleLimit: v })} required />
        </FormField>
        <FormField label={t.quotations.anyOneConsignmentRate}>
          <RateInput
            value={draft.singleLimitRate}
            onChange={(e) => onChange({ singleLimitRate: e.target.value })}
            required
          />
        </FormField>
        <FormField label={t.quotations.gitAnyOneYearLimit}>
          <MoneyInput value={draft.yearLimit} onChange={(v) => onChange({ yearLimit: v })} required />
        </FormField>
        <FormField label={t.quotations.gitAnyOneYearRate}>
          <RateInput
            value={draft.yearLimitRate}
            onChange={(e) => onChange({ yearLimitRate: e.target.value })}
            required
          />
        </FormField>
      </div>
      <p className="mt-1 text-sm text-secondary">{t.quotations.gitAnnualBasisNote}</p>

      <p className="table-title mt-4 mb-2">{t.quotations.pvtLoading}</p>
      <div className="form-grid">
        <FormField label={t.quotations.pvtLoadingEnabled}>
          <Select
            value={draft.pvtLoadingEnabled ? "yes" : "no"}
            onChange={(e) => onChange({ pvtLoadingEnabled: e.target.value === "yes" })}
          >
            <option value="no">{t.common.no}</option>
            <option value="yes">{t.common.yes}</option>
          </Select>
        </FormField>
        {draft.pvtLoadingEnabled && (
          <>
            <FormField label={t.quotations.pvtLoadingAmount}>
              <MoneyInput
                value={draft.pvtLoadingAmount}
                onChange={(v) => onChange({ pvtLoadingAmount: v })}
                required
              />
            </FormField>
            <FormField label={t.quotations.pvtLoadingRate}>
              <RateInput
                value={draft.pvtLoadingRate}
                onChange={(e) => onChange({ pvtLoadingRate: e.target.value })}
              />
            </FormField>
            <FormField label={t.quotations.pvtLoadingPremium}>
              <Input type="text" value={formatMoney(totals.pvtLoadingPremium)} disabled />
            </FormField>
          </>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-control bg-zinc-50 p-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-secondary">{t.quotations.singlePremium}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.singlePremium)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.annualPremium}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.yearPremium)}</div>
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
