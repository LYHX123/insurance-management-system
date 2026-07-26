"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { MotorOverviewTab } from "@/components/policy/motor/motor-overview-tab";
import { MotorFinancialTab } from "@/components/policy/motor/motor-financial-tab";
import { MotorDocumentsTab } from "@/components/policy/motor/motor-documents-tab";
import { MotorActivityTab } from "@/components/policy/motor/motor-activity-tab";
import type { MotorDetail, PolicyBusinessStatus, CustomerOption } from "@/components/policy/types";

const STATUS_TONE: Record<PolicyBusinessStatus, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  ACTIVE: "brand",
  EXPIRED: "warning",
  CANCELLED: "danger",
  RENEWED: "success",
};

type Tab = "overview" | "financial" | "documents" | "activity";
const VALID_TABS: Tab[] = ["overview", "financial", "documents", "activity"];

export function MotorDetailView({ detail, customers }: { detail: MotorDetail; customers: CustomerOption[] }) {
  const { t } = useLocale();
  // Allows deep-linking straight to a tab (e.g. Ledger's "Open Source" link
  // to a Policy's Financial tab, see src/lib/ledger/systemRecords.ts) via
  // ?tab=financial — read once on mount, not kept in sync afterward (the
  // tab buttons below manage state locally from here on, same as before).
  const searchParams = useSearchParams();
  const initialTab = VALID_TABS.includes(searchParams.get("tab") as Tab) ? (searchParams.get("tab") as Tab) : "overview";
  const [tab, setTab] = useState<Tab>(initialTab);

  const statusLabel: Record<PolicyBusinessStatus, string> = {
    DRAFT: t.policy.statusDraft,
    ACTIVE: t.policy.statusActive,
    EXPIRED: t.policy.statusExpired,
    CANCELLED: t.policy.statusCancelled,
    RENEWED: t.policy.statusRenewed,
  };

  const tabButton = (key: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`border-b-2 px-1 pb-2 text-sm font-medium transition-colors ${
        tab === key ? "border-emerald-700 text-emerald-800" : "border-transparent text-zinc-500 hover:text-zinc-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-section">
      <div>
        <Link href="/policy/motor" className="mb-2 inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline">
          <ArrowLeft size={14} />
          {t.policy.backToList}
        </Link>
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2">
              {detail.recordNumber}
              <Badge tone={STATUS_TONE[detail.businessStatus]}>{statusLabel[detail.businessStatus]}</Badge>
            </span>
          }
          description={`${detail.customerName}${detail.projectName ? " · " + detail.projectName : ""}`}
        />
      </div>

      <div className="flex gap-6 border-b border-zinc-200">
        {tabButton("overview", t.policy.overviewTab)}
        {tabButton("financial", t.policy.financialTab)}
        {tabButton("documents", t.policy.documentsTab)}
        {tabButton("activity", t.policy.activityTab)}
      </div>

      {tab === "overview" && <MotorOverviewTab detail={detail} customers={customers} />}
      {tab === "financial" && <MotorFinancialTab detail={detail} />}
      {tab === "documents" && <MotorDocumentsTab policyRecordId={detail.id} documents={detail.documents} />}
      {tab === "activity" && <MotorActivityTab activities={detail.activities} />}
    </div>
  );
}
