"use client";

import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { previewCustomsBond } from "@/lib/insuranceCalculations/clientPreview";
import { emptyCustomsBondItemRow, type CustomsBondDraft } from "@/components/quotations/sectionDrafts";

export function CustomsBondSection({
  draft,
  onChange,
}: {
  draft: CustomsBondDraft;
  onChange: (patch: Partial<CustomsBondDraft>) => void;
}) {
  const { t } = useLocale();

  const totals = useMemo(() => previewCustomsBond({ rows: draft.itemRows }), [draft]);

  const updateRow = (key: string, patch: Partial<CustomsBondDraft["itemRows"][number]>) => {
    onChange({ itemRows: draft.itemRows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  };

  const removeRow = (key: string) => {
    onChange({ itemRows: draft.itemRows.filter((r) => r.key !== key) });
  };

  const rowPremium = (row: CustomsBondDraft["itemRows"][number]) =>
    ((Number(row.bondValue) || 0) * (Number(row.rate) || 0)) / 100;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="table-title">{t.quotations.customsBondTable}</span>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange({ itemRows: [...draft.itemRows, emptyCustomsBondItemRow()] })}
        >
          <Plus size={16} />
          {t.quotations.addRow}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {draft.itemRows.map((row) => (
          <div key={row.key} className="rounded-control border border-zinc-100 bg-zinc-50/60 p-3">
            <div className="form-grid">
              <FormField label={t.quotations.bondType}>
                <Input value={row.bondType} onChange={(e) => updateRow(row.key, { bondType: e.target.value })} />
              </FormField>
              <FormField label={t.quotations.bondValue}>
                <MoneyInput value={row.bondValue} onChange={(v) => updateRow(row.key, { bondValue: v })} />
              </FormField>
              <FormField label={t.quotations.bondRate}>
                <Input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={row.rate}
                  onChange={(e) => updateRow(row.key, { rate: e.target.value })}
                />
              </FormField>
              <FormField label={t.quotations.bondPremium}>
                <Input type="text" value={formatMoney(rowPremium(row))} disabled />
              </FormField>
            </div>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                className="btn-icon text-red-500 hover:bg-red-50"
                onClick={() => removeRow(row.key)}
                disabled={draft.itemRows.length <= 1}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
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
          <div className="text-secondary">{t.quotations.stampDuty}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.stampDutyAmount)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.sectionTotal}</div>
          <div className="font-semibold text-emerald-800">{formatMoney(totals.totalPremium)}</div>
        </div>
      </div>
      <p className="mt-1 text-sm text-secondary">{t.quotations.customsBondStampDutyNote}</p>
    </div>
  );
}
