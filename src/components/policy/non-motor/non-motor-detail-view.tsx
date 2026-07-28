"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { NonMotorOverviewTab } from "@/components/policy/non-motor/non-motor-overview-tab";
import { NonMotorFinancialTab } from "@/components/policy/non-motor/non-motor-financial-tab";
// Phase 3A: reused directly, unchanged — both are already category-agnostic
// (policyRecordId/documents and activities props only, see their own
// source) — never duplicated into a Non-Motor-specific copy.
import { MotorDocumentsTab } from "@/components/policy/motor/motor-documents-tab";
import { MotorActivityTab } from "@/components/policy/motor/motor-activity-tab";
import type { NonMotorDetail, PolicyBusinessStatus, CustomerOption } from "@/components/policy/types";

const STATUS_TONE: Record<PolicyBusinessStatus, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  ACTIVE: "brand",
  EXPIRED: "warning",
  CANCELLED: "danger",
  RENEWED: "success",
};

type Tab = "overview" | "financial" | "documents" | "activity";
const VALID_TABS: Tab[] = ["overview", "financial", "documents", "activity"];

export function NonMotorDetailView({
  detail,
  customers,
  isAdmin,
}: {
  detail: NonMotorDetail;
  customers: CustomerOption[];
  isAdmin: boolean;
}) {
  const { t } = useLocale();
  // Allows deep-linking straight to a tab (e.g. Ledger's "Open Source" link
  // to a Policy's Financial tab, see src/lib/ledger/systemRecords.ts) via
  // ?tab=financial — read once on mount.
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
        <Link href="/policy/non-motor" className="mb-2 inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline">
          <ArrowLeft size={14} />
          {t.policy.backToListNonMotor}
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

      {tab === "overview" && <NonMotorOverviewTab detail={detail} customers={customers} isAdmin={isAdmin} />}
      {tab === "financial" && <NonMotorFinancialTab detail={detail} />}
      {tab === "documents" && <MotorDocumentsTab policyRecordId={detail.id} documents={detail.documents} />}
      {tab === "activity" && <MotorActivityTab activities={detail.activities} />}
    </div>
  );
}
