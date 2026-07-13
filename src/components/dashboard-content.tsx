"use client";

import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";

export function DashboardContent({ fullName }: { fullName: string }) {
  const { t } = useLocale();

  return (
    <div className="flex flex-col gap-section">
      <PageHeader title={t.dashboard.title} description={t.dashboard.subtitle} />

      <Card>
        <p className="text-secondary">{t.dashboard.welcome}</p>
        <p className="mt-1 text-xl font-medium text-emerald-800">
          {fullName}
        </p>
      </Card>
    </div>
  );
}
