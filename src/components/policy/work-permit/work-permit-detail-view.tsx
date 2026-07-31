"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { SmartBackLink } from "@/components/ui/smart-back-link";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { WorkPermitOverviewTab } from "@/components/policy/work-permit/work-permit-overview-tab";
import { WorkPermitFinancialTab } from "@/components/policy/work-permit/work-permit-financial-tab";
// Reused directly, unchanged — both are already category-agnostic (see
// their own source) — never duplicated into a Work-Permit-specific copy.
import { MotorDocumentsTab } from "@/components/policy/motor/motor-documents-tab";
import { MotorActivityTab } from "@/components/policy/motor/motor-activity-tab";
import { PolicyDropboxSection } from "@/components/policy/policy-dropbox-section";
import type { WorkPermitDetail, PolicyBusinessStatus, CustomerOption, PolicyDropboxSectionView } from "@/components/policy/types";

const STATUS_TONE: Record<PolicyBusinessStatus, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  ACTIVE: "brand",
  EXPIRED: "warning",
  CANCELLED: "danger",
  RENEWED: "success",
};

type Tab = "overview" | "financial" | "documents" | "activity";
const VALID_TABS: Tab[] = ["overview", "financial", "documents", "activity"];

export function WorkPermitDetailView({
  detail,
  customers,
  isAdmin,
  dropbox,
}: {
  detail: WorkPermitDetail;
  customers: CustomerOption[];
  isAdmin: boolean;
  dropbox: PolicyDropboxSectionView;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  // Allows deep-linking straight to a tab (e.g. Ledger's "Open Source" link
  // to a Policy's Financial tab, see src/lib/ledger/systemRecords.ts) via
  // ?tab=financial, now kept in sync afterward too (Phase 8 Part 6.5).
  const searchParams = useSearchParams();
  const initialTab = VALID_TABS.includes(searchParams.get("tab") as Tab) ? (searchParams.get("tab") as Tab) : "overview";
  const [tab, setTab] = useState<Tab>(initialTab);

  const handleTabChange = (key: Tab) => {
    setTab(key);
    const params = new URLSearchParams(searchParams.toString());
    if (key === "overview") params.delete("tab");
    else params.set("tab", key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

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
      onClick={() => handleTabChange(key)}
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
        <SmartBackLink fallbackHref="/policy/work-permit" label={t.policy.backToListWorkPermit} />
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

      {tab === "overview" && <WorkPermitOverviewTab detail={detail} customers={customers} isAdmin={isAdmin} />}
      {tab === "financial" && <WorkPermitFinancialTab detail={detail} />}
      {tab === "documents" && (
        <div className="flex flex-col gap-4">
          <PolicyDropboxSection policyRecordId={detail.id} dropbox={dropbox} isAdmin={isAdmin} />
          <MotorDocumentsTab policyRecordId={detail.id} documents={detail.documents} isAdmin={isAdmin} />
        </div>
      )}
      {tab === "activity" && <MotorActivityTab activities={detail.activities} />}
    </div>
  );
}
