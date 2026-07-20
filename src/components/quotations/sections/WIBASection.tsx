"use client";

import { useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { RateInput } from "@/components/ui/rate-input";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { previewWiba, resolveWibaRowAnnualWages } from "@/lib/insuranceCalculations/clientPreview";
import { WIBA_OCCUPATIONS } from "@/lib/insuranceCalculations/wibaOccupations";
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
          <RateInput
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
          {draft.payrollRows.map((row) => {
            const rowAnnualSalary = resolveWibaRowAnnualWages(row);
            return (
              <div key={row.key} className="rounded-control border border-zinc-100 bg-zinc-50/60 p-3">
                <div className="form-grid">
                  <FormField label={t.quotations.occupation}>
                    <Combobox
                      value={row.occupation}
                      onChange={(v) => updateRow(row.key, { occupation: v })}
                      options={WIBA_OCCUPATIONS}
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
                </div>
                <div className="mt-3 grid grid-cols-1 gap-field sm:grid-cols-3 sm:gap-x-4">
                  <FormField label={t.quotations.basicMonthlySalary}>
                    <MoneyInput
                      value={row.basicMonthlySalary}
                      onChange={(v) => updateRow(row.key, { basicMonthlySalary: v })}
                    />
                  </FormField>
                  <FormField label={t.quotations.monthlyAllowance}>
                    <MoneyInput
                      value={row.monthlyAllowance}
                      onChange={(v) => updateRow(row.key, { monthlyAllowance: v })}
                    />
                  </FormField>
                  <FormField label={t.quotations.annualWages}>
                    <Input readOnly disabled value={formatMoney(rowAnnualSalary)} />
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
            );
          })}
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
