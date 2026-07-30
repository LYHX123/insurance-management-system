"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Settings, Plus, Paperclip, Trash2, X } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { SearchBar } from "@/components/ui/search-bar";
import { Badge } from "@/components/ui/badge";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { TypedConfirmDialog } from "@/components/ui/typed-confirm-dialog";
import { formatMoney } from "@/components/ui/money-input";
import { deleteQuotationCaseAction } from "@/app/(app)/quotation/actions";
import type { QuotationListRow, QuotationCaseStatus } from "@/components/quotations/types";

const CASE_STATUSES: QuotationCaseStatus[] = [
  "DRAFT",
  "IN_PROGRESS",
  "QUOTED",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
  "CONVERTED_TO_POLICY",
];

const CASE_STATUS_TONE: Record<QuotationCaseStatus, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  IN_PROGRESS: "brand",
  QUOTED: "brand",
  ACCEPTED: "success",
  DECLINED: "danger",
  EXPIRED: "warning",
  CONVERTED_TO_POLICY: "success",
};

export function QuotationsTable({ quotations }: { quotations: QuotationListRow[] }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | QuotationCaseStatus>("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<QuotationListRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleDelete = async (typedQuotationNumber: string) => {
    if (!deleteTarget) return;
    setDeleteError(null);
    setIsDeleting(true);
    const result = await deleteQuotationCaseAction(deleteTarget.caseId, typedQuotationNumber);
    setIsDeleting(false);
    if (!result.success) {
      if (result.error === "QUOTATION_HAS_LINKED_POLICIES") {
        setDeleteError(t.quotations.deleteQuotationListBlockedByPolicy);
      } else if (result.error === "FORBIDDEN") {
        setDeleteError(t.quotations.deleteQuotationListForbidden);
      } else if (result.error === "CASE_NOT_FOUND") {
        setDeleteError(t.quotations.deleteQuotationListNotFound);
      } else if (result.error === "CONFIRMATION_MISMATCH") {
        setDeleteError(t.quotations.deleteQuotationListConfirmationMismatch);
      } else {
        setDeleteError(t.quotations.deleteQuotationListDeleteFailed);
      }
      return;
    }
    setDeleteTarget(null);
    setSuccessMessage(t.quotations.deleteQuotationListSuccess.replace("{number}", result.quotationNumber));
    router.refresh();
  };

  const caseStatusLabel: Record<QuotationCaseStatus, string> = {
    DRAFT: t.quotations.caseStatusDraft,
    IN_PROGRESS: t.quotations.caseStatusInProgress,
    QUOTED: t.quotations.caseStatusQuoted,
    ACCEPTED: t.quotations.caseStatusAccepted,
    DECLINED: t.quotations.caseStatusDeclined,
    EXPIRED: t.quotations.caseStatusExpired,
    CONVERTED_TO_POLICY: t.quotations.caseStatusConvertedToPolicy,
  };

  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return quotations.filter((q) => {
      const matchesTerm =
        !term ||
        q.quotationNumber.toLowerCase().includes(term) ||
        q.customerName.toLowerCase().includes(term) ||
        (q.projectName?.toLowerCase().includes(term) ?? false) ||
        q.insuranceTypeNames.some((name) => name.toLowerCase().includes(term));
      const matchesStatus = statusFilter === "ALL" || q.caseStatus === statusFilter;
      // Before R01 exists there's no quotationDate yet — fall back to
      // enquiryDate so a case in "Preparing Documents" can still be found
      // by the date filter instead of silently disappearing from every
      // range.
      const referenceDate = (q.quotationDate ?? q.enquiryDate)?.slice(0, 10);
      const matchesFrom = !dateFrom || (!!referenceDate && referenceDate >= dateFrom);
      const matchesTo = !dateTo || (!!referenceDate && referenceDate <= dateTo);
      return matchesTerm && matchesStatus && matchesFrom && matchesTo;
    });
  }, [quotations, search, statusFilter, dateFrom, dateTo]);

  return (
    <div className="flex flex-col gap-section">
      <PageHeader
        title={t.quotations.title}
        actions={
          <>
            <Link href="/quotation/insurance-types">
              <Button variant="secondary">
                <Settings size={16} />
                {t.quotations.manageInsuranceTypes}
              </Button>
            </Link>
            <Link href="/quotation/new">
              <Button>
                <Plus size={16} />
                {t.quotations.addQuotation}
              </Button>
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder={t.quotations.searchPlaceholder}
          className="w-full max-w-sm"
        />
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="w-auto max-w-[200px]"
        >
          <option value="ALL">{t.quotations.allStatuses}</option>
          {CASE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {caseStatusLabel[s]}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-auto"
          aria-label={t.quotations.dateFrom}
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-auto"
          aria-label={t.quotations.dateTo}
        />
      </div>

      <TableWrap scroll>
        <Table className="min-w-[1150px]">
          <thead>
            <tr>
              <th>{t.quotations.quotationNumber}</th>
              <th>{t.quotations.customer}</th>
              <th>{t.quotations.project}</th>
              <th>{t.quotations.insuranceTypesUsed}</th>
              <th>{t.quotations.currentRevision}</th>
              <th>{t.quotations.premium}</th>
              <th>{t.quotations.grandTotal}</th>
              <th>{t.common.status}</th>
              <th>{t.quotations.updatedAt}</th>
              <th>{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <TableEmpty colSpan={10}>{t.quotations.noQuotations}</TableEmpty>}
            {filtered.map((q) => (
              <tr key={q.caseId}>
                <td className="font-medium text-zinc-800">
                  <Link href={`/quotation/case/${q.caseId}`} className="text-emerald-700 hover:underline">
                    {q.quotationNumber}
                  </Link>
                  {q.documentCount > 0 && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-zinc-400" title={t.quotations.totalDocuments}>
                      <Paperclip size={11} />
                      {q.documentCount}
                    </span>
                  )}
                </td>
                <td>{q.customerName}</td>
                <td className="text-zinc-500">{q.projectName || "—"}</td>
                <td>
                  {q.revisionCode ? (
                    <div className="flex flex-wrap gap-1">
                      {q.insuranceTypeNames.slice(0, 2).map((name, idx) => (
                        <Badge key={`${name}-${idx}`} tone="brand">
                          {name}
                        </Badge>
                      ))}
                      {q.insuranceTypeNames.length > 2 && (
                        <Badge tone="neutral">+{q.insuranceTypeNames.length - 2}</Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-zinc-400">{t.quotations.notYetSelected}</span>
                  )}
                </td>
                <td>{q.revisionCode ? <Badge tone="neutral">{q.revisionCode}</Badge> : <span className="text-zinc-400">—</span>}</td>
                <td className="text-zinc-500">{q.subtotalPremium !== null ? formatMoney(q.subtotalPremium) : "—"}</td>
                <td className="font-medium text-zinc-800">{q.grandTotal !== null ? formatMoney(q.grandTotal) : "—"}</td>
                <td>
                  <Badge tone={CASE_STATUS_TONE[q.caseStatus]}>{caseStatusLabel[q.caseStatus]}</Badge>
                </td>
                <td className="text-zinc-500">{dateFormatter.format(new Date(q.updatedAt))}</td>
                <td>
                  <div className="flex items-center justify-end gap-1.5">
                    <Link href={`/quotation/case/${q.caseId}`}>
                      <IconButton title={t.quotations.view}>
                        <Eye size={16} />
                      </IconButton>
                    </Link>
                    <IconButton
                      tone="danger"
                      title={t.common.delete}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(q);
                      }}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      {successMessage && (
        <div className="flex items-center justify-between rounded-surface border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <span>{successMessage}</span>
          <button type="button" className="text-emerald-600 hover:text-emerald-800" onClick={() => setSuccessMessage(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      {deleteTarget && (
        <TypedConfirmDialog
          title={t.quotations.confirmDeleteQuotation}
          message={`${deleteError ?? t.quotations.deleteQuotationListConfirmMessage} ${t.quotations.deleteQuotationListConfirmInstruction.replace("{number}", deleteTarget.quotationNumber)}`}
          confirmLabel={t.quotations.deleteQuotationListConfirmButton}
          confirmValue={deleteTarget.quotationNumber}
          isSubmitting={isDeleting}
          onConfirm={handleDelete}
          onClose={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
        />
      )}
    </div>
  );
}
