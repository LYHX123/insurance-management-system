"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, FileUp } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Input } from "@/components/ui/input";
import { RateInput } from "@/components/ui/rate-input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { previewCpmStandalone } from "@/lib/insuranceCalculations/clientPreview";
import { emptyCpmEquipmentRow, type CpmDraft, type CpmEquipmentRowDraft } from "@/components/quotations/sectionDrafts";
import { ScheduleImportModal } from "@/components/quotations/schedule-import-modal";
import type { CpmScheduleRow } from "@/lib/quotationScheduleImport/types";

// See WIBASection.tsx's identical hasNonEmptyWibaRows for the rationale —
// a fresh/untouched draft (still exactly one emptyCpmEquipmentRow()) never
// triggers the re-import replace warning.
function hasNonEmptyCpmRows(rows: CpmEquipmentRowDraft[]): boolean {
  return rows.some((r) => r.equipmentName.trim() || r.chassisOrPlate.trim() || r.quantity || r.unitValue);
}

export function CPMSection({
  draft,
  onChange,
}: {
  draft: CpmDraft;
  onChange: (patch: Partial<CpmDraft>) => void;
}) {
  const { t } = useLocale();
  const [showImport, setShowImport] = useState(false);

  const totals = useMemo(() => previewCpmStandalone(draft), [draft]);

  const updateRow = (key: string, patch: Partial<CpmDraft["equipmentRows"][number]>) => {
    onChange({ equipmentRows: draft.equipmentRows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  };

  const removeRow = (key: string) => {
    onChange({ equipmentRows: draft.equipmentRows.filter((r) => r.key !== key) });
  };

  // See WIBASection.tsx's identical handleImport — imported rows become
  // normal, fully editable draft rows, persisted through the same Save
  // Quotation flow as manual entry.
  const handleImport = (rows: CpmScheduleRow[]) => {
    onChange({
      equipmentRows: rows.map((r) => ({
        key: crypto.randomUUID(),
        equipmentName: r.equipmentName,
        quantity: r.quantity,
        unitValue: r.unitValue,
        chassisOrPlate: r.chassisOrPlate,
      })),
    });
  };

  const rowTotal = (row: CpmDraft["equipmentRows"][number]) =>
    (parseInt(row.quantity, 10) || 0) * (Number(row.unitValue) || 0);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="table-title">{t.quotations.cpmEquipmentTable}</span>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setShowImport(true)}>
            <FileUp size={16} />
            {t.quotations.importSchedule}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onChange({ equipmentRows: [...draft.equipmentRows, emptyCpmEquipmentRow()] })}
          >
            <Plus size={16} />
            {t.quotations.addRow}
          </Button>
        </div>
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
              <FormField label={t.quotations.chassisOrPlate}>
                <Input
                  value={row.chassisOrPlate}
                  onChange={(e) => updateRow(row.key, { chassisOrPlate: e.target.value })}
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
          <RateInput
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
            <FormField label={t.quotations.pvtLoadingAmount}>
              <Input type="text" value={formatMoney(totals.pvtLoadingAmount)} disabled />
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

      {showImport && (
        <ScheduleImportModal
          kind="CPM"
          hasExistingRows={hasNonEmptyCpmRows(draft.equipmentRows)}
          onClose={() => setShowImport(false)}
          onImport={handleImport}
        />
      )}
    </div>
  );
}
