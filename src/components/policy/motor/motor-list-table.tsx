"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Eye, Plus, Upload, Download } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/select";
import { SearchBar } from "@/components/ui/search-bar";
import { Badge } from "@/components/ui/badge";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { PolicyDeleteSuccessBanner } from "@/components/policy/policy-delete-success-banner";
import { formatMoney } from "@/components/ui/money-input";
import {
  PolicyExpiryDateFilter,
  PolicyOutstandingBalanceCheckboxes,
  matchesOutstandingBalanceFilters,
} from "@/components/policy/policy-list-outstanding-filters";
import { useUrlListState } from "@/lib/navigation/useUrlListState";
import type { MotorListRow, PolicyBusinessStatus } from "@/components/policy/types";

const STATUS_TONE: Record<PolicyBusinessStatus, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  ACTIVE: "brand",
  EXPIRED: "warning",
  CANCELLED: "danger",
  RENEWED: "success",
};

const PAGE_SIZE = 25;

// customerId is server-filtered (see policy/motor/page.tsx), not client-side
// — tracked here purely so useUrlListState's own router.replace calls never
// silently drop it from the URL (Phase 8.1 Part 4). customerFilter (by
// customer NAME) is a separate, pre-existing client-side filter and is
// deliberately left as-is.
const MOTOR_LIST_DEFAULTS = {
  search: "",
  customer: "ALL",
  type: "ALL",
  insurer: "ALL",
  status: "ALL",
  expiryDate: "",
  outstandingClientOnly: "",
  outstandingInsurerOnly: "",
  page: "1",
  customerId: "",
};

export function MotorListTable({ records }: { records: MotorListRow[] }) {
  const { t, locale } = useLocale();
  const [listState, setListState] = useUrlListState(MOTOR_LIST_DEFAULTS);
  const {
    search,
    customer: customerFilter,
    type: typeFilter,
    insurer: insurerFilter,
    status: statusFilter,
    expiryDate,
    customerId,
  } = listState;
  const outstandingClientOnly = listState.outstandingClientOnly === "1";
  const outstandingInsurerOnly = listState.outstandingInsurerOnly === "1";
  const page = Math.max(1, Number(listState.page) || 1);

  const statusLabel: Record<PolicyBusinessStatus, string> = {
    DRAFT: t.policy.statusDraft,
    ACTIVE: t.policy.statusActive,
    EXPIRED: t.policy.statusExpired,
    CANCELLED: t.policy.statusCancelled,
    RENEWED: t.policy.statusRenewed,
  };

  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });

  const customerOptions = useMemo(
    () => Array.from(new Set(records.map((r) => r.customerName))).sort(),
    [records]
  );
  const typeOptions = useMemo(
    () => Array.from(new Set(records.map((r) => r.insuranceType))).sort(),
    [records]
  );
  const insurerOptions = useMemo(
    () => Array.from(new Set(records.map((r) => r.insurerName).filter((n): n is string => !!n))).sort(),
    [records]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return records.filter((r) => {
      const matchesTerm =
        !term ||
        r.recordNumber.toLowerCase().includes(term) ||
        r.customerName.toLowerCase().includes(term) ||
        r.registrationNumber.toLowerCase().includes(term) ||
        (r.insurerName?.toLowerCase().includes(term) ?? false);
      const matchesCustomer = customerFilter === "ALL" || r.customerName === customerFilter;
      const matchesType = typeFilter === "ALL" || r.insuranceType === typeFilter;
      const matchesInsurer = insurerFilter === "ALL" || r.insurerName === insurerFilter;
      const matchesStatus = statusFilter === "ALL" || r.businessStatus === statusFilter;
      const matchesExpiryDate = !expiryDate || r.expiryDate.slice(0, 10) === expiryDate;
      const matchesOutstanding = matchesOutstandingBalanceFilters({
        clientBalance: Number(r.clientBalance),
        insurerBalance: Number(r.insurerBalance),
        outstandingClientOnly,
        outstandingInsurerOnly,
      });
      return (
        matchesTerm &&
        matchesCustomer &&
        matchesType &&
        matchesInsurer &&
        matchesStatus &&
        matchesExpiryDate &&
        matchesOutstanding
      );
    });
  }, [
    records,
    search,
    customerFilter,
    typeFilter,
    insurerFilter,
    statusFilter,
    expiryDate,
    outstandingClientOnly,
    outstandingInsurerOnly,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-section">
      <PolicyDeleteSuccessBanner listPath="/policy/motor" />
      <PageHeader
        title={t.policy.tabMotor}
        actions={
          <>
            <Link href="/policy/motor/import">
              <Button variant="secondary">
                <Upload size={16} />
                {t.policy.importHistorical}
              </Button>
            </Link>
            <IconButton title={t.comingSoon.title} disabled>
              <Download size={16} />
            </IconButton>
            <Link href="/policy/motor/new">
              <Button>
                <Plus size={16} />
                {t.policy.addMotorRecord}
              </Button>
            </Link>
          </>
        }
      />

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
          placeholder={t.policy.searchPlaceholder}
          className="w-full max-w-sm"
        />
        <Select
          value={customerFilter}
          onChange={(e) => setListState({ customer: e.target.value, page: "1" }, { immediate: true })}
          className="w-auto max-w-[220px]"
        >
          <option value="ALL">{t.policy.allCustomers}</option>
          {customerOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <Select
          value={typeFilter}
          onChange={(e) => setListState({ type: e.target.value, page: "1" }, { immediate: true })}
          className="w-auto max-w-[180px]"
        >
          <option value="ALL">{t.policy.allTypesOfCover}</option>
          {typeOptions.map((tOpt) => (
            <option key={tOpt} value={tOpt}>{tOpt}</option>
          ))}
        </Select>
        <Select
          value={insurerFilter}
          onChange={(e) => setListState({ insurer: e.target.value, page: "1" }, { immediate: true })}
          className="w-auto max-w-[180px]"
        >
          <option value="ALL">{t.policy.allInsurers}</option>
          {insurerOptions.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => setListState({ status: e.target.value, page: "1" }, { immediate: true })}
          className="w-auto max-w-[160px]"
        >
          <option value="ALL">{t.policy.allStatuses}</option>
          {(["DRAFT", "ACTIVE", "EXPIRED", "CANCELLED", "RENEWED"] as PolicyBusinessStatus[]).map((s) => (
            <option key={s} value={s}>{statusLabel[s]}</option>
          ))}
        </Select>
        <PolicyExpiryDateFilter
          value={expiryDate}
          onChange={(value) => setListState({ expiryDate: value, page: "1" }, { immediate: true })}
        />
      </div>

      <PolicyOutstandingBalanceCheckboxes
        outstandingClientOnly={outstandingClientOnly}
        onOutstandingClientOnlyChange={(value) =>
          setListState({ outstandingClientOnly: value ? "1" : "", page: "1" }, { immediate: true })
        }
        outstandingInsurerOnly={outstandingInsurerOnly}
        onOutstandingInsurerOnlyChange={(value) =>
          setListState({ outstandingInsurerOnly: value ? "1" : "", page: "1" }, { immediate: true })
        }
      />

      <TableWrap scroll>
        <Table className="min-w-[1200px]">
          <thead>
            <tr>
              <th>{t.policy.recordNumber}</th>
              <th>{t.policy.processingDate}</th>
              <th>{t.policy.customer}</th>
              <th>{t.policy.typeOfCover}</th>
              <th>{t.policy.registrationNumber}</th>
              <th>{t.policy.insurer}</th>
              <th>{t.policy.expiryDate}</th>
              <th>{t.policy.clientPremium}</th>
              <th>{t.policy.clientBalance}</th>
              <th>{t.common.status}</th>
              <th>{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && <TableEmpty colSpan={11}>{t.policy.noRecords}</TableEmpty>}
            {pageRows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium text-zinc-800">
                  <Link href={`/policy/motor/${r.id}`} className="text-emerald-700 hover:underline">
                    {r.recordNumber}
                  </Link>
                </td>
                <td className="text-zinc-500">{dateFormatter.format(new Date(r.processingDate))}</td>
                <td>{r.customerName}</td>
                <td className="text-zinc-500">{r.insuranceType}</td>
                <td className="text-zinc-500">{r.registrationNumber}</td>
                <td className="text-zinc-500">{r.insurerName || "—"}</td>
                <td className="text-zinc-500">{dateFormatter.format(new Date(r.expiryDate))}</td>
                <td className="text-zinc-500">{formatMoney(r.clientPremium)}</td>
                <td className={Number(r.clientBalance) > 0 ? "font-medium text-amber-700" : "text-zinc-500"}>
                  {formatMoney(r.clientBalance)}
                </td>
                <td>
                  <Badge tone={STATUS_TONE[r.businessStatus]}>{statusLabel[r.businessStatus]}</Badge>
                </td>
                <td>
                  <div className="flex items-center justify-end gap-1.5">
                    <Link href={`/policy/motor/${r.id}`}>
                      <IconButton title={t.policy.view}>
                        <Eye size={16} />
                      </IconButton>
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <Pagination
        page={currentPage}
        totalPages={totalPages}
        onPageChange={(p) => setListState({ page: String(p) }, { immediate: true })}
      />
    </div>
  );
}
