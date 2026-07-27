"use client";

import Link from "next/link";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/components/ui/money-input";
import type { MetricRow } from "@/lib/dashboard/types";

function RowList({ rows, currency }: { rows: MetricRow[]; currency: string }) {
  const { t } = useLocale();
  if (rows.length === 0) {
    return <p className="py-4 text-center text-sm text-zinc-500">{t.dashboard.noData}</p>;
  }
  return (
    <ul className="divide-y divide-zinc-100">
      {rows.map((row) => (
        <li key={row.key}>
          <Link href={row.targetUrl} className="flex items-center justify-between py-2 text-sm hover:text-emerald-700">
            <span className="text-zinc-600">{t.dashboard.metricRows[row.key]}</span>
            <span className="font-semibold text-zinc-800">
              {row.isMoney ? `${currency} ${formatMoney(row.value)}` : row.value.toLocaleString()}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function TodayThisWeekSection({
  currency,
  todayRows,
  thisWeekRows,
}: {
  currency: string;
  todayRows: MetricRow[];
  thisWeekRows: MetricRow[];
}) {
  const { t } = useLocale();

  if (todayRows.length === 0 && thisWeekRows.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <p className="section-title mb-1">{t.dashboard.today}</p>
          <RowList rows={todayRows} currency={currency} />
        </Card>
        <Card>
          <p className="section-title mb-1">{t.dashboard.thisWeek}</p>
          <RowList rows={thisWeekRows} currency={currency} />
        </Card>
      </div>
    </section>
  );
}
