"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Download, ExternalLink } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { SmartBackLink } from "@/components/ui/smart-back-link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatMoney } from "@/components/ui/money-input";
import { cancelInvoiceAction } from "@/app/(app)/invoice/actions";
import { InvoiceDropboxSection } from "@/components/invoice/invoice-dropbox-section";
import type { InvoiceDetail, InvoiceDropboxSectionView, InvoiceStatus } from "@/components/invoice/types";

const STATUS_TONE: Record<InvoiceStatus, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  ISSUED: "success",
  CANCELLED: "danger",
};

const POLICY_CATEGORY_ROUTE: Record<InvoiceDetail["items"][number]["policyCategory"], string> = {
  MOTOR: "/policy/motor",
  NON_MOTOR: "/policy/non-motor",
  BOND: "/policy/bond",
  WORK_PERMIT: "/policy/work-permit",
};

const ERROR_KEY: Record<string, string> = {
  FORBIDDEN: "genericError",
  INVOICE_NOT_FOUND: "invoiceNotFound",
  ALREADY_CANCELLED: "alreadyCancelled",
};

export function InvoiceDetailView({
  detail,
  dropbox,
  isAdmin,
  canEdit,
}: {
  detail: InvoiceDetail;
  dropbox: InvoiceDropboxSectionView;
  isAdmin: boolean;
  canEdit: boolean;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });
  const dateTimeFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  const statusLabel: Record<InvoiceStatus, string> = {
    ISSUED: t.invoice.statusIssued,
    CANCELLED: t.invoice.statusCancelled,
  };

  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCancel = async () => {
    setError(null);
    setIsCancelling(true);
    const result = await cancelInvoiceAction(detail.id);
    setIsCancelling(false);
    if (!result.success) {
      setError(t.invoice[(ERROR_KEY[result.error] ?? "genericError") as keyof typeof t.invoice]);
      return;
    }
    setShowCancelConfirm(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-section">
      <div>
        <SmartBackLink fallbackHref="/invoice" label={t.invoice.backToList} />
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2">
              {detail.invoiceNumber}
              <Badge tone={STATUS_TONE[detail.status]}>{statusLabel[detail.status]}</Badge>
            </span>
          }
          description={detail.customerName}
          actions={
            <>
              <a href={`/api/invoice/${detail.id}/download`}>
                <Button variant="secondary">
                  <Download size={16} />
                  {t.invoice.downloadExcel}
                </Button>
              </a>
              {canEdit && detail.status === "ISSUED" && (
                <Button variant="destructive" onClick={() => setShowCancelConfirm(true)}>
                  {t.invoice.cancelInvoice}
                </Button>
              )}
            </>
          }
        />
      </div>

      <Card>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-secondary">{t.invoice.invoiceDate}</dt>
            <dd className="font-medium text-zinc-800">{dateFormatter.format(new Date(detail.invoiceDate))}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.invoice.customer}</dt>
            <dd className="font-medium text-zinc-800">{detail.customerName}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.invoice.customerPin}</dt>
            <dd className="font-medium text-zinc-800">{detail.customerPin}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.invoice.policyCount}</dt>
            <dd className="font-medium text-zinc-800">{detail.items.length}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.invoice.totalPremium}</dt>
            <dd className="font-medium text-zinc-800">{formatMoney(detail.totalPremium)}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.invoice.createdBy}</dt>
            <dd className="font-medium text-zinc-800">{detail.createdByName}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.invoice.createdAt}</dt>
            <dd className="font-medium text-zinc-800">{dateTimeFormatter.format(new Date(detail.createdAt))}</dd>
          </div>
          {detail.status === "CANCELLED" && detail.cancelledAt && (
            <div>
              <dt className="text-secondary">{t.invoice.cancelInvoice}</dt>
              <dd className="font-medium text-zinc-800">
                {dateTimeFormatter.format(new Date(detail.cancelledAt))}
                {detail.cancelledByName ? ` — ${detail.cancelledByName}` : ""}
              </dd>
            </div>
          )}
        </dl>
      </Card>

      <Card>
        <h2 className="section-title mb-4">{t.invoice.itemsTitle}</h2>
        <TableWrap scroll>
          <Table className="min-w-[900px]">
            <thead>
              <tr>
                <th>{t.invoice.colItemNo}</th>
                <th>{t.invoice.colPolicyRecordNumber}</th>
                <th>{t.invoice.colPolicyClass}</th>
                <th>{t.invoice.colPolicyNumber}</th>
                <th>{t.invoice.colPremium}</th>
                <th>{t.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.length === 0 && <TableEmpty colSpan={6}>{t.invoice.noRecords}</TableEmpty>}
              {detail.items.map((item) => (
                <tr key={item.id}>
                  <td className="text-zinc-500">{item.itemNumber}</td>
                  <td className="font-medium text-zinc-800">{item.policyRecordNumber}</td>
                  <td className="text-zinc-500">{item.policyClassSnapshot}</td>
                  <td className="text-zinc-500">{item.policyNumberSnapshot}</td>
                  <td className="text-zinc-500">{formatMoney(item.premiumSnapshot)}</td>
                  <td>
                    <Link
                      href={`${POLICY_CATEGORY_ROUTE[item.policyCategory]}/${item.policyRecordId}`}
                      className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
                    >
                      <ExternalLink size={14} />
                      {t.invoice.openPolicy}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      <InvoiceDropboxSection invoiceId={detail.id} dropbox={dropbox} isAdmin={isAdmin} />

      {showCancelConfirm && (
        <ConfirmDialog
          title={t.invoice.cancelInvoiceConfirmTitle}
          message={
            error ?? (dropbox.invoiceFile.state === "synced" ? `${t.invoice.cancelInvoiceConfirmMessage} ${t.invoice.dropboxRetentionNote}` : t.invoice.cancelInvoiceConfirmMessage)
          }
          isSubmitting={isCancelling}
          onConfirm={handleCancel}
          onClose={() => {
            setShowCancelConfirm(false);
            setError(null);
          }}
        />
      )}
    </div>
  );
}
