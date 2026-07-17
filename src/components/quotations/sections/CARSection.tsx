"use client";

import { useMemo } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { previewCarPackage } from "@/lib/insuranceCalculations/clientPreview";
import type { CarDraft } from "@/components/quotations/sectionDrafts";

export function CARSection({
  draft,
  onChange,
}: {
  draft: CarDraft;
  onChange: (patch: Partial<CarDraft>) => void;
}) {
  const { t } = useLocale();

  const totals = useMemo(() => previewCarPackage(draft), [draft]);

  return (
    <div>
      <p className="table-title mb-2">{t.quotations.carMainDetails}</p>
      <div className="form-grid">
        <FormField label={t.quotations.carProjectName}>
          <Input value={draft.projectName} onChange={(e) => onChange({ projectName: e.target.value })} />
        </FormField>
        <FormField label={t.quotations.contractValue}>
          <MoneyInput
            value={draft.contractValue}
            onChange={(v) => onChange({ contractValue: v })}
            required
          />
        </FormField>
        <FormField label={t.quotations.carRate}>
          <Input
            type="number"
            step="0.0001"
            min="0"
            value={draft.carRate}
            onChange={(e) => onChange({ carRate: e.target.value })}
            required
          />
        </FormField>
        <FormField label={t.quotations.constructionPeriodMonths}>
          <Input
            type="number"
            step="1"
            min="0"
            value={draft.constructionPeriodMonths}
            onChange={(e) => onChange({ constructionPeriodMonths: e.target.value })}
            required
          />
        </FormField>
        <FormField label={t.quotations.maintenancePeriodMonths}>
          <Input
            type="number"
            step="1"
            min="0"
            value={draft.maintenancePeriodMonths}
            onChange={(e) => onChange({ maintenancePeriodMonths: e.target.value })}
            required
          />
        </FormField>
      </div>

      <p className="table-title mt-4 mb-2">{t.quotations.cpmInsideCar}</p>
      <div className="form-grid">
        <FormField label={t.quotations.cpmValue}>
          <MoneyInput value={draft.cpmValue} onChange={(v) => onChange({ cpmValue: v })} />
        </FormField>
        <FormField label={t.quotations.cpmRate}>
          <Input
            type="number"
            step="0.0001"
            min="0"
            value={draft.cpmRate}
            onChange={(e) => onChange({ cpmRate: e.target.value })}
          />
        </FormField>
      </div>

      <p className="table-title mt-4 mb-2">{t.quotations.tplInsideCar}</p>
      <div className="form-grid">
        <FormField label={t.quotations.tplComplimentary}>
          <Select
            value={draft.tplComplimentary ? "yes" : "no"}
            onChange={(e) => onChange({ tplComplimentary: e.target.value === "yes" })}
          >
            <option value="no">{t.common.no}</option>
            <option value="yes">{t.common.yes}</option>
          </Select>
        </FormField>
        <FormField label={t.quotations.tplAnyOneClaim}>
          <MoneyInput
            value={draft.tplAnyOneClaim}
            onChange={(v) => onChange({ tplAnyOneClaim: v })}
          />
        </FormField>
        <FormField label={t.quotations.tplAnyOneEvent}>
          <MoneyInput
            value={draft.tplAnyOneEvent}
            onChange={(v) => onChange({ tplAnyOneEvent: v })}
          />
        </FormField>
        <FormField label={t.quotations.tplAnyOnePeriod}>
          <MoneyInput
            value={draft.tplAnyOnePeriod}
            onChange={(v) => onChange({ tplAnyOnePeriod: v })}
            required={!draft.tplComplimentary}
          />
        </FormField>
        <FormField label={t.quotations.tplRate}>
          <Input
            type="number"
            step="0.0001"
            min="0"
            value={draft.tplComplimentary ? "" : draft.tplRate}
            onChange={(e) => onChange({ tplRate: e.target.value })}
            disabled={draft.tplComplimentary}
            required={!draft.tplComplimentary}
          />
        </FormField>
      </div>
      {draft.tplComplimentary ? (
        <p className="mt-1 text-sm text-secondary">{t.quotations.tplComplimentaryNote}</p>
      ) : (
        <p className="mt-1 text-sm text-secondary">{t.quotations.tplBasisNote}</p>
      )}

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
          <div className="text-secondary">{t.quotations.carMainTotal}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.carMainTotal)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.tplTotalPremium}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.tplTotalPremium)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.stampDuty}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.stampDutyAmount)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.sectionTotal}</div>
          <div className="font-semibold text-emerald-800">{formatMoney(totals.sectionTotal)}</div>
        </div>
      </div>
    </div>
  );
}
