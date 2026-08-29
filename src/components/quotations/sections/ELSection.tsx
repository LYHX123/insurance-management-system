"use client";

import { useMemo } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { formatMoney } from "@/components/ui/money-input";
import { previewEl, previewWiba } from "@/lib/insuranceCalculations/clientPreview";
import { EL_OPTION_NUMBERS, EL_OPTIONS } from "@/lib/insuranceCalculations/constants";
import type { WibaDraft } from "@/components/quotations/sectionDrafts";

// Employer's Liability has no free-form inputs — it is derived from the WIBA
// section in the same quotation, and the user only picks one of four option
// tiers. The chosen tier fixes the EL rate and all three liability limits
// automatically (see EL_OPTIONS); nothing here is typed by hand.
export function ELSection({
  wibaDraft,
  elOption,
  onOptionChange,
}: {
  wibaDraft: WibaDraft;
  elOption: number;
  onOptionChange: (option: number) => void;
}) {
  const { t } = useLocale();

  const totals = useMemo(() => {
    const wiba = previewWiba(wibaDraft);
    return previewEl(wiba.grossPremium, elOption);
  }, [wibaDraft, elOption]);

  return (
    <div className="space-y-3">
      <p className="text-secondary">{t.quotations.elDerivedNote}</p>

      <div>
        <div className="mb-1 text-sm font-medium text-zinc-800">{t.quotations.elOptionLabel}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {EL_OPTION_NUMBERS.map((n) => {
            const opt = EL_OPTIONS[n];
            const selected = elOption === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => onOptionChange(n)}
                aria-pressed={selected}
                className={`rounded-control border px-3 py-2 text-sm transition ${
                  selected
                    ? "border-emerald-600 bg-emerald-50 font-semibold text-emerald-800"
                    : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400"
                }`}
              >
                {opt.ratePercent}% {t.quotations.elOptionOf}
              </button>
            );
          })}
        </div>
        <p className="text-secondary mt-1 text-xs">{t.quotations.elOptionHint}</p>
      </div>

      <div className="grid grid-cols-1 gap-2 rounded-control bg-zinc-50 p-3 text-sm sm:grid-cols-3">
        <div>
          <div className="text-secondary">{t.quotations.anyOnePersonLimit}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.anyOnePersonLimit)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.anyOneOccurrenceLimit}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.anyOneOccurrenceLimit)}</div>
        </div>
        <div>
          <div className="text-secondary">{t.quotations.anyOneYearLimit}</div>
          <div className="font-medium text-zinc-800">{formatMoney(totals.anyOneYearLimit)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-control bg-zinc-50 p-3 text-sm sm:grid-cols-4">
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
