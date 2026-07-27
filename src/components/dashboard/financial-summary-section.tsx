"use client";

import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/components/ui/money-input";
import type { FinancialSummary, ManualLedgerSummary } from "@/lib/dashboard/types";

function Row({ label, value, currency, tone }: { label: string; value: number; currency: string; tone?: "success" | "danger" }) {
  const toneClass = tone === "success" ? "text-emerald-700" : tone === "danger" ? "text-red-600" : "text-zinc-800";
  return (
    <div className="flex items-center justify-between py-2">
      <p className="text-sm text-zinc-600">{label}</p>
      <p className={`text-sm font-semibold ${toneClass}`}>
        {currency} {formatMoney(value)}
      </p>
    </div>
  );
}

export function FinancialSummarySection({
  currency,
  financialSummary,
  manualLedgerSummary,
}: {
  currency: string;
  financialSummary: FinancialSummary | null;
  manualLedgerSummary: ManualLedgerSummary | null;
}) {
  const { t } = useLocale();

  if (!financialSummary && !manualLedgerSummary) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="section-title">{t.dashboard.financialSummary}</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {financialSummary && (
          <Card>
            <p className="text-secondary mb-1 text-xs font-medium">{t.dashboard.currentMonth}</p>
            <div className="divide-y divide-zinc-100">
              <Row label={t.dashboard.clientPremiumDue} value={financialSummary.clientPremiumDue ?? 0} currency={currency} />
              <Row
                label={t.dashboard.clientPremiumReceived}
                value={financialSummary.clientPremiumReceived ?? 0}
                currency={currency}
                tone="success"
              />
              <Row
                label={t.dashboard.statCards.clientPremiumOutstanding}
                value={financialSummary.clientPremiumOutstanding ?? 0}
                currency={currency}
                tone="danger"
              />
              {financialSummary.insurerCostDue !== null && (
                <Row label={t.dashboard.insurerCostDue} value={financialSummary.insurerCostDue} currency={currency} />
              )}
              {financialSummary.insurerPaymentsMade !== null && (
                <Row label={t.dashboard.insurerPaymentsMade} value={financialSummary.insurerPaymentsMade} currency={currency} />
              )}
              {financialSummary.insurerPaymentOutstanding !== null && (
                <Row
                  label={t.dashboard.statCards.insurerPaymentOutstanding}
                  value={financialSummary.insurerPaymentOutstanding}
                  currency={currency}
                  tone="danger"
                />
              )}
              {financialSummary.commissionReceived !== null && (
                <Row label={t.dashboard.commissionReceived} value={financialSummary.commissionReceived} currency={currency} tone="success" />
              )}
            </div>
          </Card>
        )}

        {manualLedgerSummary && (
          <Card>
            <p className="text-secondary mb-1 text-xs font-medium">
              {t.dashboard.manualLedgerSummary} · {t.dashboard.currentMonth}
            </p>
            <div className="divide-y divide-zinc-100">
              <Row label={t.dashboard.manualIncome} value={manualLedgerSummary.income} currency={manualLedgerSummary.currency} tone="success" />
              <Row label={t.dashboard.manualExpense} value={manualLedgerSummary.expense} currency={manualLedgerSummary.currency} tone="danger" />
              <Row
                label={t.dashboard.netCashFlow}
                value={manualLedgerSummary.net}
                currency={manualLedgerSummary.currency}
                tone={manualLedgerSummary.net >= 0 ? "success" : "danger"}
              />
            </div>
          </Card>
        )}
      </div>
    </section>
  );
}
