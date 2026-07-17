"use client";

import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { previewWiba } from "@/lib/insuranceCalculations/clientPreview";
import { emptyWibaPayrollRow, type WibaDraft } from "@/components/quotations/sectionDrafts";

export function WIBASection({
  draft,
  onChange,
}: {
  draft: WibaDraft;
  onChange: (patch: Partial<WibaDraft>) => void;
}) {
  const { t } = useLocale();

  const totals = useMemo(() => previewWiba(draft), [draft]);

  const updateRow = (key: string, patch: Partial<WibaDraft["payrollRows"][number]>) => {
    onChange({ payrollRows: draft.payrollRows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  };

  const removeRow = (key: string) => {
    onChange({ payrollRows: draft.payrollRows.filter((r) => r.key !== key) });
  };

  return (
    <div>
      <div className="form-grid">
        <FormField label={t.quotations.wibaRate}>
          <Input
            type="number"
            step="0.0001"
            min="0"
            value={draft.wibaRate}
            onChange={(e) => onChange({ wibaRate: e.target.value })}
            required
          />
        </FormField>
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="table-title">{t.quotations.wibaPayrollTable}</span>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onChange({ payrollRows: [...draft.payrollRows, emptyWibaPayrollRow()] })}
          >
            <Plus size={16} />
            {t.quotations.addRow}
          </Button>
        </div>

        <div className="flex flex-col gap-3">
          {draft.payrollRows.map((row) => (
            <div key={row.key} className="rounded-control border border-zinc-100 bg-zinc-50/60 p-3">
              <div className="form-grid">
                <FormField label={t.quotations.occupation}>
                  <Input
                    value={row.occupation}
                    onChange={(e) => updateRow(row.key, { occupation: e.target.value })}
                  />
                </FormField>
                <FormField label={t.quotations.employeeCount}>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={row.employeeCount}
                    onChange={(e) => updateRow(row.key, { employeeCount: e.target.value })}
                  />
                </FormField>
                <FormField label={t.quotations.annualWages}>
                  <MoneyInput
                    value={row.annualWages}
                    onChange={(v) => updateRow(row.key, { annualWages: v })}
                  />
                </FormField>
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  className="btn-icon text-red-500 hover:bg-red-50"
                  onClick={() => removeRow(row.key)}
                  disabled={draft.payrollRows.length <= 1}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-control bg-zinc-50 p-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-secondary">{t.quotations.employeeCount}</div>
          <div className="font-medium text-zinc-800">{totals.totalEmployeeCount}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.wibaTotalWages}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.totalAnnualWages)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.premium}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.grossPremium)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.sectionTotal}</div>
          <div className="font-semibold text-emerald-800">{formatMoney(totals.totalPremium)}</div>
        </div>
      </div>
    </div>
  );
}
