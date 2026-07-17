"use client";

import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/components/ui/money-input";

export type QuotationSummaryLine = {
  key: string;
  label: string;
  total: number;
};

// Grand total = sum of selected insurance section total premiums, per the
// Phase 1 spec. Only selected sections appear here — the caller is
// responsible for filtering to what's actually selected.
export function QuotationSummary({
  lines,
  currency,
}: {
  lines: QuotationSummaryLine[];
  currency: string;
}) {
  const { t } = useLocale();
  const grandTotal = lines.reduce((sum, line) => sum + line.total, 0);

  return (
    <Card>
      <h2 className="section-title mb-4">{t.quotations.quotationSummary}</h2>
      {lines.length === 0 ? (
        <p className="text-secondary">{t.quotations.noSectionsYet}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {lines.map((line) => (
            <div key={line.key} className="flex items-center justify-between text-sm">
              <span className="text-secondary">{line.label}</span>
              <span className="font-medium text-zinc-800">
                {currency} {formatMoney(line.total)}
              </span>
            </div>
          ))}
          <div className="mt-2 flex items-center justify-between border-t border-zinc-200 pt-2">
            <span className="table-title">{t.quotations.grandTotal}</span>
            <span className="text-lg font-semibold text-emerald-800">
              {currency} {formatMoney(grandTotal)}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
