"use client";

import { useMemo } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { TableWrap, Table } from "@/components/ui/table";
import { MoneyInput, formatMoney } from "@/components/ui/money-input";
import { previewMedical } from "@/lib/insuranceCalculations/clientPreview";
import type { MedicalDraft, MedicalCategory } from "@/components/quotations/sectionDrafts";

const CATEGORY_LABEL: Record<MedicalCategory, string> = {
  M: "M",
  M_PLUS_1: "M+1",
  M_PLUS_2: "M+2",
  M_PLUS_3: "M+3",
  M_PLUS_4: "M+4",
  M_PLUS_5: "M+5",
};

export function MedicalSection({
  draft,
  onChange,
}: {
  draft: MedicalDraft;
  onChange: (patch: Partial<MedicalDraft>) => void;
}) {
  const { t } = useLocale();

  const totals = useMemo(() => previewMedical(draft), [draft]);

  const updateRow = (category: MedicalCategory, patch: Partial<MedicalDraft["categoryRows"][number]>) => {
    onChange({
      categoryRows: draft.categoryRows.map((r) => (r.category === category ? { ...r, ...patch } : r)),
    });
  };

  return (
    <div>
      <div className="form-grid">
        <FormField label={t.quotations.inpatientLimit}>
          <MoneyInput value={draft.inpatientLimit} onChange={(v) => onChange({ inpatientLimit: v })} />
        </FormField>
        <FormField label={t.quotations.outpatientLimit}>
          <MoneyInput value={draft.outpatientLimit} onChange={(v) => onChange({ outpatientLimit: v })} />
        </FormField>
      </div>

      <div className="mt-4">
        <p className="table-title mb-2">{t.quotations.medicalCategoryTable}</p>
        <TableWrap scroll>
          <Table className="min-w-[720px]">
            <thead>
              <tr>
                <th>{t.quotations.familyCategory}</th>
                <th>{t.quotations.employeeCount}</th>
                <th>{t.quotations.inpatientRate}</th>
                <th>{t.quotations.outpatientRate}</th>
                <th>{t.quotations.inpatientAmount}</th>
                <th>{t.quotations.outpatientAmount}</th>
              </tr>
            </thead>
            <tbody>
              {draft.categoryRows.map((row, index) => {
                const rowPreview = totals.rows[index];
                return (
                  <tr key={row.category}>
                    <td className="font-medium text-zinc-800">{CATEGORY_LABEL[row.category]}</td>
                    <td className="min-w-[110px]">
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        value={row.employeeCount}
                        onChange={(e) => updateRow(row.category, { employeeCount: e.target.value })}
                      />
                    </td>
                    <td className="min-w-[130px]">
                      <MoneyInput
                        value={row.inpatientRate}
                        onChange={(v) => updateRow(row.category, { inpatientRate: v })}
                      />
                    </td>
                    <td className="min-w-[130px]">
                      <MoneyInput
                        value={row.outpatientRate}
                        onChange={(v) => updateRow(row.category, { outpatientRate: v })}
                      />
                    </td>
                    <td className="text-zinc-500">{formatMoney(rowPreview?.inpatientAmount ?? 0)}</td>
                    <td className="text-zinc-500">{formatMoney(rowPreview?.outpatientAmount ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-control bg-zinc-50 p-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-secondary">{t.quotations.employeeCount}</div>
          <div className="font-medium text-zinc-800">{totals.employeeCount}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.medicalInpatientPremium}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.inpatientPremium)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.medicalOutpatientPremium}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.outpatientPremium)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.subtotal}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.subtotal)}</div>
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
      <p className="mt-1 text-sm text-secondary">{t.quotations.medicalTaxNote}</p>
    </div>
  );
}
