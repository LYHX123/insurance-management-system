"use client";

import { useMemo } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { formatMoney } from "@/components/ui/money-input";
import { previewEl, previewWiba } from "@/lib/insuranceCalculations/clientPreview";
import type { WibaDraft } from "@/components/quotations/sectionDrafts";

// Employer's Liability has no independent inputs of its own — it is always
// derived from the WIBA section in the same quotation, read live rather than
// re-entered.
export function ELSection({ wibaDraft }: { wibaDraft: WibaDraft }) {
  const { t } = useLocale();

  const totals = useMemo(() => {
    const wiba = previewWiba(wibaDraft);
    return previewEl(wiba.grossPremium);
  }, [wibaDraft]);

  return (
    <div>
      <p className="text-secondary mb-3">{t.quotations.elDerivedNote}</p>

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
