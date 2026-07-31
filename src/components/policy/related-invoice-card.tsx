"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Download, ExternalLink, FilePlus } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/components/ui/money-input";
import { buildReturnTo } from "@/lib/navigation/returnTo";
import type { RelatedInvoiceInfo, PolicyBusinessStatus } from "@/components/policy/types";

// Shared across every Policy category's Overview tab (Motor/Non-Motor/Bond/
// Work Permit) — one compact card that either shows the Policy's most
// relevant linked Invoice (see RelatedInvoiceInfo's doc comment for the
// ISSUED-over-CANCELLED precedence rule) or a "Create Invoice" call to
// action, per this phase's spec (Part D §10: "Recommended placement:
// Overview tab... in a compact Related Invoice card"; "Do not put the
// button in the Financial tab"). Eligibility here is display-only — every
// server action independently re-validates (see
// src/lib/invoice/eligibility.ts's checkPolicyInvoiceEligibility).
export function RelatedInvoiceCard({
  policyRecordId,
  businessStatus,
  hasPolicyNumber,
  relatedInvoice,
}: {
  policyRecordId: string;
  businessStatus: PolicyBusinessStatus;
  hasPolicyNumber: boolean;
  relatedInvoice: RelatedInvoiceInfo | null;
}) {
  const { t, locale } = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Phase 8.1 Part 9 — this Policy Detail page's own current URL (including
  // its own tab/returnTo), forwarded as the returnTo for Create Invoice so
  // the round trip (Cancel, or the new Invoice's own Back) lands back on
  // exactly this page instead of a bare category route that's lost track
  // of how to get back to whatever list this Policy was itself opened from.
  const createInvoiceHref = `/invoice/new?fromPolicyId=${policyRecordId}&returnTo=${encodeURIComponent(buildReturnTo(pathname, searchParams.toString()))}`;

  const hasActiveInvoice = relatedInvoice?.status === "ISSUED";
  const canCreateInvoice = businessStatus !== "CANCELLED" && !hasActiveInvoice;

  return (
    <Card>
      <h2 className="section-title mb-4">{t.invoice.relatedInvoiceTitle}</h2>

      {relatedInvoice ? (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-secondary">{t.invoice.invoiceNumber}</dt>
              <dd className="font-medium text-zinc-800">{relatedInvoice.invoiceNumber}</dd>
            </div>
            <div>
              <dt className="text-secondary">{t.invoice.invoiceDate}</dt>
              <dd className="font-medium text-zinc-800">{dateFormatter.format(new Date(relatedInvoice.invoiceDate))}</dd>
            </div>
            <div>
              <dt className="text-secondary">{t.common.status}</dt>
              <dd>
                <Badge tone={relatedInvoice.status === "ISSUED" ? "success" : "danger"}>
                  {relatedInvoice.status === "ISSUED" ? t.invoice.statusIssued : t.invoice.statusCancelled}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-secondary">{t.invoice.totalPremium}</dt>
              <dd className="font-medium text-zinc-800">{formatMoney(relatedInvoice.totalPremium)}</dd>
            </div>
          </dl>

          {relatedInvoice.status === "CANCELLED" && (
            <p className="text-sm text-amber-700">{t.invoice.invoiceCancelledNotice}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Link href={`/invoice/${relatedInvoice.id}`}>
              <Button variant="secondary">
                <ExternalLink size={16} />
                {t.invoice.openInvoice}
              </Button>
            </Link>
            <a href={`/api/invoice/${relatedInvoice.id}/download`}>
              <Button variant="secondary">
                <Download size={16} />
                {t.invoice.downloadExcel}
              </Button>
            </a>
            {canCreateInvoice && hasPolicyNumber && (
              <Link href={createInvoiceHref}>
                <Button>
                  <FilePlus size={16} />
                  {t.invoice.createInvoice}
                </Button>
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-secondary text-sm">{t.invoice.noLinkedInvoice}</p>
          {businessStatus !== "CANCELLED" && (
            <div>
              {hasPolicyNumber ? (
                <Link href={createInvoiceHref}>
                  <Button>
                    <FilePlus size={16} />
                    {t.invoice.createInvoice}
                  </Button>
                </Link>
              ) : (
                <div className="flex flex-col items-start gap-2">
                  <Button disabled title={t.invoice.createInvoiceBlockedMissingNumber}>
                    <FilePlus size={16} />
                    {t.invoice.createInvoice}
                  </Button>
                  <p className="text-sm text-amber-700">{t.invoice.createInvoiceBlockedMissingNumber}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
