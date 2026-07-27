"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { getDashboardDataAction } from "@/lib/dashboard/actions";
import type { DashboardData } from "@/lib/dashboard/types";
import { StatCardGrid } from "./stat-card-grid";
import { AttentionRequiredSection } from "./attention-required-section";
import { FinancialSummarySection } from "./financial-summary-section";
import { TodayThisWeekSection } from "./today-this-week-section";
import { RecentActivitySection } from "./recent-activity-section";

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; data: DashboardData };

export function DashboardContent({ fullName }: { fullName: string }) {
  const { t } = useLocale();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    getDashboardDataAction().then((data) => {
      if (cancelled) return;
      setState(data ? { kind: "ready", data } : { kind: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-section">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">
          {t.dashboard.welcome}, {fullName}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">{t.dashboard.subtitle}</p>
      </div>

      {state.kind === "loading" && (
        <p className="py-8 text-center text-sm text-zinc-500">{t.dashboard.loading}</p>
      )}

      {state.kind === "error" && (
        <p className="py-8 text-center text-sm text-red-600">{t.dashboard.failedToLoad}</p>
      )}

      {state.kind === "ready" && !state.data.hasAnyModulePermission && (
        <p className="py-8 text-center text-sm text-zinc-500">{t.dashboard.noPermission}</p>
      )}

      {state.kind === "ready" && state.data.hasAnyModulePermission && (
        <>
          <StatCardGrid currency={state.data.currency} cards={state.data.statCards} />
          <AttentionRequiredSection items={state.data.attentionItems} totalCount={state.data.attentionTotalCount} />
          <FinancialSummarySection
            currency={state.data.currency}
            financialSummary={state.data.financialSummary}
            manualLedgerSummary={state.data.manualLedgerSummary}
          />
          <TodayThisWeekSection
            currency={state.data.currency}
            todayRows={state.data.todayRows}
            thisWeekRows={state.data.thisWeekRows}
          />
          <RecentActivitySection items={state.data.recentActivity} />
        </>
      )}
    </div>
  );
}
