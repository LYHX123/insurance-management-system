"use client";

import { useMemo } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Eye, Download } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { SearchBar } from "@/components/ui/search-bar";
import { Badge } from "@/components/ui/badge";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { formatMoney } from "@/components/ui/money-input";
import { useUrlListState } from "@/lib/navigation/useUrlListState";
import { buildReturnTo } from "@/lib/navigation/returnTo";
import type { InvoiceListRow, InvoiceStatus } from "@/components/invoice/types";

const STATUS_TONE: Record<InvoiceStatus, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  ISSUED: "success",
  CANCELLED: "danger",
};

const PAGE_SIZE = 25;

// customerId is server-filtered (see invoice/page.tsx), not client-side —
// tracked here purely so useUrlListState's own router.replace calls never
// silently drop it from the URL (Phase 8.1 Part 4).
const INVOICE_LIST_DEFAULTS = { search: "", customer: "ALL", status: "ALL", invoiceDate: "", page: "1", customerId: "" };

export function InvoiceListTable({ records }: { records: InvoiceListRow[] }) {
  const { t, locale } = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [listState, setListState] = useUrlListState(INVOICE_LIST_DEFAULTS);
  const { search, customer: customerFilter, status: statusFilter, invoiceDate: invoiceDateFilter, customerId } = listState;
  const page = Number(listState.page) || 1;
  const returnTo = buildReturnTo(pathname, searchParams.toString());

  const statusLabel: Record<InvoiceStatus, string> = {
    ISSUED: t.invoice.statusIssued,
    CANCELLED: t.invoice.statusCancelled,
  };

  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });

  const customerOptions = useMemo(
    () => Array.from(new Set(records.map((r) => r.customerName))).sort(),
    [records]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return records.filter((r) => {
      const matchesTerm =
        !term ||
        r.invoiceNumber.toLowerCase().includes(term) ||
        r.customerName.toLowerCase().includes(term) ||
        r.searchableItemText.toLowerCase().includes(term);
      const matchesCustomer = customerFilter === "ALL" || r.customerName === customerFilter;
      const matchesStatus = statusFilter === "ALL" || r.status === statusFilter;
      const matchesDate = !invoiceDateFilter || r.invoiceDate.slice(0, 10) === invoiceDateFilter;
      return matchesTerm && matchesCustomer && matchesStatus && matchesDate;
    });
  }, [records, search, customerFilter, statusFilter, invoiceDateFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-section">
      <PageHeader title={t.invoice.title} />

      {customerId && (
        <div className="flex items-center gap-2 text-sm text-zinc-600">
          <Badge tone="brand">{t.common.filteredByCustomer}</Badge>
          <button
            type="button"
            className="text-emerald-700 hover:underline"
            onClick={() => setListState({ customerId: "" }, { immediate: true })}
          >
            {t.common.clearFilter}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(value) => setListState({ search: value, page: "1" })}
          placeholder={t.invoice.searchPlaceholder}
          className="w-full max-w-sm"
        />
        <Select value={customerFilter} onChange={(e) => setListState({ customer: e.target.value, page: "1" }, { immediate: true })} className="w-auto max-w-[220px]">
          <option value="ALL">{t.invoice.allCustomers}</option>
          {customerOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => setListState({ status: e.target.value, page: "1" }, { immediate: true })}
          className="w-auto max-w-[160px]"
        >
          <option value="ALL">{t.invoice.allStatuses}</option>
          {(["ISSUED", "CANCELLED"] as InvoiceStatus[]).map((s) => (
            <option key={s} value={s}>{statusLabel[s]}</option>
          ))}
        </Select>
        <Input
          type="date"
          value={invoiceDateFilter}
          onChange={(e) => setListState({ invoiceDate: e.target.value, page: "1" }, { immediate: true })}
          className="w-auto"
          aria-label={t.invoice.invoiceDate}
        />
      </div>

      <TableWrap scroll>
        <Table className="min-w-[1000px]">
          <thead>
            <tr>
              <th>{t.invoice.invoiceNumber}</th>
              <th>{t.invoice.invoiceDate}</th>
              <th>{t.invoice.customer}</th>
              <th>{t.invoice.policyCount}</th>
              <th>{t.invoice.totalPremium}</th>
              <th>{t.common.status}</th>
              <th>{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && <TableEmpty colSpan={7}>{t.invoice.noRecords}</TableEmpty>}
            {pageRows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium text-zinc-800">
                  <Link href={`/invoice/${r.id}?returnTo=${encodeURIComponent(returnTo)}`} className="text-emerald-700 hover:underline">
                    {r.invoiceNumber}
                  </Link>
                </td>
                <td className="text-zinc-500">{dateFormatter.format(new Date(r.invoiceDate))}</td>
                <td>{r.customerName}</td>
                <td className="text-zinc-500">{r.policyCount}</td>
                <td className="text-zinc-500">{formatMoney(r.totalPremium)}</td>
                <td>
                  <Badge tone={STATUS_TONE[r.status]}>{statusLabel[r.status]}</Badge>
                </td>
                <td>
                  <div className="flex items-center justify-end gap-1.5">
                    <Link href={`/invoice/${r.id}?returnTo=${encodeURIComponent(returnTo)}`}>
                      <IconButton title={t.invoice.view}>
                        <Eye size={16} />
                      </IconButton>
                    </Link>
                    <a href={`/api/invoice/${r.id}/download`}>
                      <IconButton title={t.invoice.downloadExcel}>
                        <Download size={16} />
                      </IconButton>
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <Pagination page={currentPage} totalPages={totalPages} onPageChange={(p) => setListState({ page: String(p) }, { immediate: true })} />
    </div>
  );
}
