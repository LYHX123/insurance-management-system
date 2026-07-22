"use client";

import Link from "next/link";
import { GitBranch } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { QuotationCaseStatus } from "@/components/quotations/types";
import { CASE_STATUS_TONE } from "@/components/quotations/statusTones";

export function QuotationCaseOverviewTab({
  quotationCaseId,
  quotationNumber,
  customerName,
  projectName,
  insuranceTypeNames,
  enquiryDate,
  createdAt,
  caseStatus,
  caseStatusLabel,
  currentRevisionCode,
}: {
  quotationCaseId: string;
  quotationNumber: string;
  customerName: string;
  projectName: string | null;
  insuranceTypeNames: string[];
  enquiryDate: string | null;
  createdAt: string;
  caseStatus: QuotationCaseStatus;
  caseStatusLabel: string;
  currentRevisionCode: string | null;
}) {
  const { t, locale } = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });

  const field = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-secondary">{label}</dt>
      <dd className="font-medium text-zinc-800">{value}</dd>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {field(t.quotations.quotationNumber, quotationNumber)}
          {field(t.quotations.customer, customerName)}
          {field(t.quotations.project, projectName || "—")}
          {field(
            t.quotations.insuranceTypesUsed,
            !currentRevisionCode ? (
              <span className="text-zinc-400">{t.quotations.notYetSelected}</span>
            ) : insuranceTypeNames.length ? (
              <div className="flex flex-wrap gap-1">
                {insuranceTypeNames.map((name, idx) => (
                  <Badge key={`${name}-${idx}`} tone="brand">
                    {name}
                  </Badge>
                ))}
              </div>
            ) : (
              "—"
            )
          )}
          {field(t.quotations.enquiryDate, enquiryDate ? dateFormatter.format(new Date(enquiryDate)) : "—")}
          {field(t.common.status, <Badge tone={CASE_STATUS_TONE[caseStatus]}>{caseStatusLabel}</Badge>)}
          {field(t.quotations.currentRevision, currentRevisionCode ?? "—")}
          {field(t.quotations.createdDate, dateFormatter.format(new Date(createdAt)))}
        </dl>
      </Card>

      {!currentRevisionCode && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="section-title">{t.quotations.startFirstQuotationTitle}</h2>
              <p className="text-secondary">{t.quotations.startFirstQuotationHint}</p>
            </div>
            <Link href={`/quotation/case/${quotationCaseId}/start`}>
              <Button>
                <GitBranch size={16} />
                {t.quotations.startFirstQuotation}
              </Button>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
