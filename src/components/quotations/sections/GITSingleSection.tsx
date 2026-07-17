"use client";

import { useMemo } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { previewGitSingle } from "@/lib/insuranceCalculations/clientPreview";
import type { GitSingleDraft } from "@/components/quotations/sectionDrafts";

export function GITSingleSection({
  draft,
  onChange,
}: {
  draft: GitSingleDraft;
  onChange: (patch: Partial<GitSingleDraft>) => void;
}) {
  const { t } = useLocale();

  const totals = useMemo(() => previewGitSingle(draft), [draft]);

  return (
    <div>
      <div className="form-grid">
        <FormField label={t.quotations.cargoDescription}>
          <Textarea
            value={draft.cargoDescription}
            onChange={(e) => onChange({ cargoDescription: e.target.value })}
            required
          />
        </FormField>
        <FormField label={t.quotations.route}>
          <Textarea value={draft.route} onChange={(e) => onChange({ route: e.target.value })} />
        </FormField>
      </div>
      <div className="form-grid mt-field">
        <FormField label={t.quotations.sumInsured}>
          <MoneyInput value={draft.sumInsured} onChange={(v) => onChange({ sumInsured: v })} required />
        </FormField>
        <FormField label={t.quotations.rate}>
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
            <FormField label={t.quotations.pvtLoadingRate}>
              <Input
                type="number"
                step="0.0001"
                min="0"
                value={draft.pvtLoadingRate}
                onChange={(e) => onChange({ pvtLoadingRate: e.target.value })}
              />
            </FormField>
            <FormField label={t.quotations.pvtLoadingAmount}>
              <MoneyInput
                value={draft.pvtLoadingAmount}
                onChange={(v) => onChange({ pvtLoadingAmount: v })}
                required
              />
            </FormField>
          </>
        )}
      </div>
      {draft.pvtLoadingEnabled && (
        <p className="mt-1 text-sm text-secondary">{t.quotations.pvtManualAmountNote}</p>
      )}

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
