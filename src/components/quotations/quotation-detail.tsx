"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Download, Trash2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TableWrap, Table } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatMoney } from "@/components/ui/money-input";
import { deleteQuotationAction } from "@/app/(app)/quotation/actions";
import type { QuotationDetail, QuotationStatus } from "@/components/quotations/types";

const STATUS_TONE: Record<QuotationStatus, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  ISSUED: "brand",
  ACCEPTED: "success",
  REJECTED: "danger",
  EXPIRED: "warning",
  CANCELLED: "danger",
};

export function QuotationDetailView({ quotation }: { quotation: QuotationDetail }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    const result = await deleteQuotationAction(quotation.id);
    setIsDeleting(false);
    if (!result.success) {
      setDeleteError(t.quotations.deleteQuotationFailed);
      return;
    }
    router.push("/quotation");
  };

  const statusLabel: Record<QuotationStatus, string> = {
    DRAFT: t.quotations.statusDraft,
    ISSUED: t.quotations.statusIssued,
    ACCEPTED: t.quotations.statusAccepted,
    REJECTED: t.quotations.statusRejected,
    EXPIRED: t.quotations.statusExpired,
    CANCELLED: t.quotations.statusCancelled,
  };

  const calculationMethodLabel: Record<string, string> = {
    PERCENTAGE: t.quotations.percentage,
    FIXED_PREMIUM: t.quotations.fixedPremium,
    MANUAL_PREMIUM: t.quotations.manualPremium,
  };

  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });
  const dateTimeFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const money = formatMoney;

  return (
    <div className="flex flex-col gap-section">
      <div>
        <Link
          href="/quotation"
          className="mb-2 inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline"
        >
          <ArrowLeft size={14} />
          {t.quotations.backToList}
        </Link>
        <PageHeader
          title={quotation.quotationNumber}
          description={quotation.customerName}
          actions={
            <>
              <a href={`/api/quotation/${quotation.id}/excel`}>
                <Button variant="secondary">
                  <Download size={16} />
                  {t.quotations.downloadExcel}
                </Button>
              </a>
              <Link href={`/quotation/${quotation.id}/edit`}>
                <Button variant="secondary">
                  <Pencil size={16} />
                  {t.common.edit}
                </Button>
              </Link>
              <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>
                <Trash2 size={16} />
                {t.common.delete}
              </Button>
            </>
          }
        />
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title={t.quotations.confirmDeleteQuotation}
          message={
            deleteError ??
            t.quotations.confirmDeleteQuotationMessage.replace("{number}", quotation.quotationNumber)
          }
          isSubmitting={isDeleting}
          onConfirm={handleDelete}
          onClose={() => setConfirmingDelete(false)}
        />
      )}

      <Card>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-secondary">{t.quotations.customer}</dt>
            <dd className="text-body font-medium">{quotation.customerName}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.quotations.project}</dt>
            <dd className="text-body">{quotation.projectName || "—"}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.common.status}</dt>
            <dd>
              <Badge tone={STATUS_TONE[quotation.status]}>{statusLabel[quotation.status]}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-secondary">{t.quotations.quotationDate}</dt>
            <dd className="text-body">{dateFormatter.format(new Date(quotation.quotationDate))}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.quotations.validUntil}</dt>
            <dd className="text-body">
              {quotation.validUntil ? dateFormatter.format(new Date(quotation.validUntil)) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-secondary">{t.quotations.currency}</dt>
            <dd className="text-body">{quotation.currency}</dd>
          </div>
          {quotation.internalNotes && (
            <div className="sm:col-span-3">
              <dt className="text-secondary">{t.quotations.internalNotes}</dt>
              <dd className="text-body whitespace-pre-wrap">{quotation.internalNotes}</dd>
            </div>
          )}
        </dl>
      </Card>

      <div className="flex flex-col gap-4">
        {quotation.sections.map((section) => (
          <Card key={section.id}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-title">{section.insuranceTypeNameSnapshot}</h2>
            </div>
            {section.description && <p className="text-secondary mb-3">{section.description}</p>}

            <TableWrap scroll>
              <Table className="min-w-[720px]">
                <thead>
                  <tr>
                    <th>{t.quotations.insuredContent}</th>
                    <th>{t.quotations.calculationMethod}</th>
                    <th>{t.quotations.sumInsured}</th>
                    <th>{t.quotations.rate}</th>
                    <th>{t.quotations.premium}</th>
                    <th>{t.quotations.notes}</th>
                  </tr>
                </thead>
                <tbody>
                  {section.items.map((item) => (
                    <tr key={item.id}>
                      <td className="font-medium text-zinc-800">{item.insuredContent}</td>
                      <td className="text-zinc-500">{calculationMethodLabel[item.calculationMethod]}</td>
                      <td className="text-zinc-500">{item.sumInsured ? money(item.sumInsured) : "—"}</td>
                      <td className="text-zinc-500">{item.rate ?? "—"}</td>
                      <td className="text-zinc-800">{money(item.premium)}</td>
                      <td className="text-zinc-500">{item.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>

            <div className="mt-4 grid grid-cols-2 gap-2 rounded-control bg-zinc-50 p-3 text-sm sm:grid-cols-4">
              <div>
                <div className="text-secondary">{t.quotations.premium}</div>
                <div className="font-medium text-zinc-800">{money(section.basePremium)}</div>
              </div>
              <div>
                <div className="text-secondary">{t.quotations.phcf}</div>
                <div className="font-medium text-zinc-800">{money(section.phcfAmount)}</div>
              </div>
              <div>
                <div className="text-secondary">{t.quotations.itl}</div>
                <div className="font-medium text-zinc-800">{money(section.itlAmount)}</div>
              </div>
              <div>
                <div className="text-secondary">{t.quotations.sectionTotal}</div>
                <div className="font-semibold text-emerald-800">{money(section.sectionTotal)}</div>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-secondary">{t.quotations.clauses}</dt>
                <dd className="text-body whitespace-pre-wrap">{section.clausesSnapshot || "—"}</dd>
              </div>
              <div>
                <dt className="text-secondary">{t.quotations.exclusions}</dt>
                <dd className="text-body whitespace-pre-wrap">{section.exclusionsSnapshot || "—"}</dd>
              </div>
              <div>
                <dt className="text-secondary">{t.quotations.conditions}</dt>
                <dd className="text-body whitespace-pre-wrap">{section.conditionsSnapshot || "—"}</dd>
              </div>
            </dl>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="section-title mb-4">{t.quotations.financialSummary}</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <div>
            <div className="text-secondary">{t.quotations.subtotalPremium}</div>
            <div className="text-body font-medium">{money(quotation.subtotalPremium)}</div>
          </div>
          <div>
            <div className="text-secondary">{t.quotations.totalPHCF}</div>
            <div className="text-body font-medium">{money(quotation.totalPHCF)}</div>
          </div>
          <div>
            <div className="text-secondary">{t.quotations.totalITL}</div>
            <div className="text-body font-medium">{money(quotation.totalITL)}</div>
          </div>
          <div>
            <div className="text-secondary">{t.quotations.totalStampDuty}</div>
            <div className="text-body font-medium">{money(quotation.totalStampDuty)}</div>
          </div>
          <div>
            <div className="text-secondary">{t.quotations.grandTotal}</div>
            <div className="text-lg font-semibold text-emerald-800">
              {quotation.currency} {money(quotation.grandTotal)}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-secondary">{t.quotations.createdBy}</dt>
            <dd className="text-body">{quotation.createdByName}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.quotations.updatedAt}</dt>
            <dd className="text-body">{dateTimeFormatter.format(new Date(quotation.updatedAt))}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
