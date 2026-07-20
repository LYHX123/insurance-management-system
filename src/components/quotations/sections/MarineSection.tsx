"use client";

import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Input } from "@/components/ui/input";
import { RateInput } from "@/components/ui/rate-input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { previewMarine } from "@/lib/insuranceCalculations/clientPreview";
import { emptyMarineShipmentRow, type MarineDraft } from "@/components/quotations/sectionDrafts";

export function MarineSection({
  draft,
  onChange,
}: {
  draft: MarineDraft;
  onChange: (patch: Partial<MarineDraft>) => void;
}) {
  const { t } = useLocale();

  const totals = useMemo(() => previewMarine(draft), [draft]);

  const updateRow = (key: string, patch: Partial<MarineDraft["shipmentRows"][number]>) => {
    onChange({ shipmentRows: draft.shipmentRows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  };

  const removeRow = (key: string) => {
    onChange({ shipmentRows: draft.shipmentRows.filter((r) => r.key !== key) });
  };

  return (
    <div>
      <div className="form-grid">
        <FormField label={t.quotations.cargoDescription}>
          <Textarea value={draft.cargoDescription} onChange={(e) => onChange({ cargoDescription: e.target.value })} />
        </FormField>
        <FormField label={t.quotations.origin}>
          <Input value={draft.origin} onChange={(e) => onChange({ origin: e.target.value })} />
        </FormField>
        <FormField label={t.quotations.destination}>
          <Input value={draft.destination} onChange={(e) => onChange({ destination: e.target.value })} />
        </FormField>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="table-title">{t.quotations.marineShipmentTable}</span>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onChange({ shipmentRows: [...draft.shipmentRows, emptyMarineShipmentRow()] })}
          >
            <Plus size={16} />
            {t.quotations.addRow}
          </Button>
        </div>

        <div className="flex flex-col gap-3">
          {draft.shipmentRows.map((row, index) => {
            const rowTotals = totals.rows[index];
            return (
              <div key={row.key} className="rounded-control border border-zinc-100 bg-zinc-50/60 p-3">
                <div className="form-grid">
                  <FormField label={t.quotations.referenceNo}>
                    <Input
                      value={row.referenceNo}
                      onChange={(e) => updateRow(row.key, { referenceNo: e.target.value })}
                    />
                  </FormField>
                  <FormField label={t.quotations.sumInsured}>
                    <MoneyInput
                      value={row.sumInsured}
                      onChange={(v) => updateRow(row.key, { sumInsured: v })}
                    />
                  </FormField>
                  <FormField label={t.quotations.rate}>
                    <RateInput
                      value={row.rate}
                      onChange={(e) => updateRow(row.key, { rate: e.target.value })}
                    />
                  </FormField>
                  <FormField label={t.quotations.incidentalLoading}>
                    <Input type="text" value={formatMoney(rowTotals?.incidentalLoading ?? 0)} disabled />
                  </FormField>
                  <FormField label={t.quotations.basicSumInsured}>
                    <Input type="text" value={formatMoney(rowTotals?.basicSumInsured ?? 0)} disabled />
                  </FormField>
                  <FormField label={t.quotations.linePremium}>
                    <Input type="text" value={formatMoney(rowTotals?.linePremium ?? 0)} disabled />
                  </FormField>
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className="btn-icon text-red-500 hover:bg-red-50"
                    onClick={() => removeRow(row.key)}
                    disabled={draft.shipmentRows.length <= 1}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-control bg-zinc-50 p-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-secondary">{t.quotations.totalBasicSumInsured}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.totalBasicSumInsured)}</div>
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
          <div className="text-secondary">{t.quotations.marineStampDutyRate}</div>
          <div className="font-medium text-zinc-800">{totals.marineStampDutyRate}%</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.stampDuty}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.marineStampDutyAmount)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.sectionTotal}</div>
          <div className="font-semibold text-emerald-800">{formatMoney(totals.totalPremium)}</div>
        </div>
      </div>
    </div>
  );
}
