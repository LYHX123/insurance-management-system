"use client";

import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { previewCpmStandalone } from "@/lib/insuranceCalculations/clientPreview";
import { emptyCpmEquipmentRow, type CpmDraft } from "@/components/quotations/sectionDrafts";

export function CPMSection({
  draft,
  onChange,
}: {
  draft: CpmDraft;
  onChange: (patch: Partial<CpmDraft>) => void;
}) {
  const { t } = useLocale();

  const totals = useMemo(() => previewCpmStandalone(draft), [draft]);

  const updateRow = (key: string, patch: Partial<CpmDraft["equipmentRows"][number]>) => {
    onChange({ equipmentRows: draft.equipmentRows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  };

  const removeRow = (key: string) => {
    onChange({ equipmentRows: draft.equipmentRows.filter((r) => r.key !== key) });
  };

  const rowTotal = (row: CpmDraft["equipmentRows"][number]) =>
    (parseInt(row.quantity, 10) || 0) * (Number(row.unitValue) || 0);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="table-title">{t.quotations.cpmEquipmentTable}</span>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange({ equipmentRows: [...draft.equipmentRows, emptyCpmEquipmentRow()] })}
        >
          <Plus size={16} />
          {t.quotations.addRow}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {draft.equipmentRows.map((row) => (
          <div key={row.key} className="rounded-control border border-zinc-100 bg-zinc-50/60 p-3">
            <div className="form-grid">
              <FormField label={t.quotations.equipmentName}>
                <Input
                  value={row.equipmentName}
                  onChange={(e) => updateRow(row.key, { equipmentName: e.target.value })}
                />
              </FormField>
              <FormField label={t.quotations.quantity}>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={row.quantity}
                  onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                />
              </FormField>
              <FormField label={t.quotations.unitValue}>
                <MoneyInput
                  value={row.unitValue}
                  onChange={(v) => updateRow(row.key, { unitValue: v })}
                />
              </FormField>
              <FormField label={t.quotations.totalValue}>
                <Input type="text" value={formatMoney(rowTotal(row))} disabled />
              </FormField>
            </div>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                className="btn-icon text-red-500 hover:bg-red-50"
                onClick={() => removeRow(row.key)}
                disabled={draft.equipmentRows.length <= 1}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="form-grid mt-4">
        <FormField label={t.quotations.cpmRate}>
          <Input
            type="number"
            step="0.0001"
            min="0"
            value={draft.cpmRate}
            onChange={(e) => onChange({ cpmRate: e.target.value })}
            required
          />
        </FormField>
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
          <div className="text-secondary">{t.quotations.cpmTotalSumInsured}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.totalSumInsured)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.premium}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.grossPremium)}</div>
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
