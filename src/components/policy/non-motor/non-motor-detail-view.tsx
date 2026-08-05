"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { SmartBackLink } from "@/components/ui/smart-back-link";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { NonMotorOverviewTab } from "@/components/policy/non-motor/non-motor-overview-tab";
import { NonMotorFinancialTab } from "@/components/policy/non-motor/non-motor-financial-tab";
// Phase 3A: reused directly, unchanged — both are already category-agnostic
// (policyRecordId/documents and activities props only, see their own
// source) — never duplicated into a Non-Motor-specific copy.
import { MotorDocumentsTab } from "@/components/policy/motor/motor-documents-tab";
import { MotorActivityTab } from "@/components/policy/motor/motor-activity-tab";
import { PolicyDropboxSection } from "@/components/policy/policy-dropbox-section";
import type { NonMotorDetail, PolicyBusinessStatus, CustomerOption, PolicyDropboxSectionView } from "@/components/policy/types";

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
  canEdit,
  dropbox,
}: {
  detail: NonMotorDetail;
  customers: CustomerOption[];
  isAdmin: boolean;
  canEdit: boolean;
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
        <SmartBackLink fallbackHref="/policy/non-motor" label={t.policy.backToListNonMotor} />
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

      {tab === "overview" && <NonMotorOverviewTab detail={detail} customers={customers} isAdmin={isAdmin} canEdit={canEdit} />}
      {tab === "financial" && <NonMotorFinancialTab detail={detail} canEdit={canEdit} />}
      {tab === "documents" && (
        <div className="flex flex-col gap-4">
          <PolicyDropboxSection policyRecordId={detail.id} dropbox={dropbox} isAdmin={isAdmin} />
          <MotorDocumentsTab policyRecordId={detail.id} documents={detail.documents} isAdmin={isAdmin} canEdit={canEdit} />
        </div>
      )}
      {tab === "activity" && <MotorActivityTab activities={detail.activities} />}
    </div>
  );
}
