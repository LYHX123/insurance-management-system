"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, Pencil, Trash2, Settings, Plus } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { SearchBar } from "@/components/ui/search-bar";
import { Badge } from "@/components/ui/badge";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatMoney } from "@/components/ui/money-input";
import { deleteQuotationAction } from "@/app/(app)/quotation/actions";
import type { QuotationListRow, QuotationStatus } from "@/components/quotations/types";

const STATUSES: QuotationStatus[] = [
  "DRAFT",
  "ISSUED",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
];

const STATUS_TONE: Record<QuotationStatus, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  ISSUED: "brand",
  ACCEPTED: "success",
  REJECTED: "danger",
  EXPIRED: "warning",
  CANCELLED: "danger",
};

export function QuotationsTable({ quotations }: { quotations: QuotationListRow[] }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | QuotationStatus>("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<QuotationListRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    const result = await deleteQuotationAction(deleteTarget.id);
    setIsDeleting(false);
    if (!result.success) {
      setDeleteError(t.quotations.deleteQuotationFailed);
      return;
    }
    setDeleteTarget(null);
    router.refresh();
  };

  const statusLabel: Record<QuotationStatus, string> = {
    DRAFT: t.quotations.statusDraft,
    ISSUED: t.quotations.statusIssued,
    ACCEPTED: t.quotations.statusAccepted,
    REJECTED: t.quotations.statusRejected,
    EXPIRED: t.quotations.statusExpired,
    CANCELLED: t.quotations.statusCancelled,
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
      const matchesStatus = statusFilter === "ALL" || q.status === statusFilter;
      const quotationDate = q.quotationDate.slice(0, 10);
      const matchesFrom = !dateFrom || quotationDate >= dateFrom;
      const matchesTo = !dateTo || quotationDate <= dateTo;
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
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel[s]}
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
        <Table className="min-w-[1100px]">
          <thead>
            <tr>
              <th>{t.quotations.quotationNumber}</th>
              <th>{t.quotations.customer}</th>
              <th>{t.quotations.project}</th>
              <th>{t.quotations.insuranceTypesUsed}</th>
              <th>{t.quotations.premium}</th>
              <th>{t.quotations.levies}</th>
              <th>{t.quotations.grandTotal}</th>
              <th>{t.common.status}</th>
              <th>{t.quotations.quotationDate}</th>
              <th>{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <TableEmpty colSpan={10}>{t.quotations.noQuotations}</TableEmpty>}
            {filtered.map((q) => (
              <tr key={q.id}>
                <td className="font-medium text-zinc-800">
                  <Link href={`/quotation/${q.id}`} className="text-emerald-700 hover:underline">
                    {q.quotationNumber}
                  </Link>
                </td>
                <td>{q.customerName}</td>
                <td className="text-zinc-500">{q.projectName || "—"}</td>
                <td>
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
                </td>
                <td className="text-zinc-500">{formatMoney(q.subtotalPremium)}</td>
                <td className="text-zinc-500">{formatMoney(q.totalLevies)}</td>
                <td className="font-medium text-zinc-800">{formatMoney(q.grandTotal)}</td>
                <td>
                  <Badge tone={STATUS_TONE[q.status]}>{statusLabel[q.status]}</Badge>
                </td>
                <td className="text-zinc-500">{dateFormatter.format(new Date(q.quotationDate))}</td>
                <td>
                  <div className="flex items-center justify-end gap-1.5">
                    <Link href={`/quotation/${q.id}`}>
                      <IconButton title={t.quotations.view}>
                        <Eye size={16} />
                      </IconButton>
                    </Link>
                    <Link href={`/quotation/${q.id}/edit`}>
                      <IconButton title={t.common.edit}>
                        <Pencil size={16} />
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

      {deleteTarget && (
        <ConfirmDialog
          title={t.quotations.confirmDeleteQuotation}
          message={
            deleteError ??
            t.quotations.confirmDeleteQuotationMessage.replace("{number}", deleteTarget.quotationNumber)
          }
          isSubmitting={isDeleting}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
