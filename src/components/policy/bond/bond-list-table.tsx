"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Eye, Plus } from "lucide-react";
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
import type { BondListRow, BondType, PolicyBusinessStatus } from "@/components/policy/types";

const STATUS_TONE: Record<PolicyBusinessStatus, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  ACTIVE: "brand",
  EXPIRED: "warning",
  CANCELLED: "danger",
  RENEWED: "success",
};

const BOND_TYPES: BondType[] = ["TENDER_BOND", "PERFORMANCE_BOND", "ADVANCE_PAYMENT_GUARANTEE", "CUSTOM_BOND"];

const PAGE_SIZE = 25;

export function BondListTable({ records }: { records: BondListRow[] }) {
  const { t, locale } = useLocale();
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [insurerFilter, setInsurerFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | PolicyBusinessStatus>("ALL");
  const [expiryDate, setExpiryDate] = useState("");
  const [outstandingClientOnly, setOutstandingClientOnly] = useState(false);
  const [outstandingInsurerOnly, setOutstandingInsurerOnly] = useState(false);
  const [page, setPage] = useState(1);

  const statusLabel: Record<PolicyBusinessStatus, string> = {
    DRAFT: t.policy.statusDraft,
    ACTIVE: t.policy.statusActive,
    EXPIRED: t.policy.statusExpired,
    CANCELLED: t.policy.statusCancelled,
    RENEWED: t.policy.statusRenewed,
  };

  const bondTypeLabel: Record<BondType, string> = {
    TENDER_BOND: t.policy.bondTenderBond,
    PERFORMANCE_BOND: t.policy.bondPerformanceBond,
    ADVANCE_PAYMENT_GUARANTEE: t.policy.bondAdvancePaymentGuarantee,
    CUSTOM_BOND: t.policy.bondCustomBond,
  };

  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });

  const customerOptions = useMemo(
    () => Array.from(new Set(records.map((r) => r.customerName))).sort(),
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
        (r.insurerName?.toLowerCase().includes(term) ?? false) ||
        (r.policyNumber?.toLowerCase().includes(term) ?? false) ||
        (r.customBondType?.toLowerCase().includes(term) ?? false);
      const matchesCustomer = customerFilter === "ALL" || r.customerName === customerFilter;
      const matchesType = typeFilter === "ALL" || r.bondType === typeFilter;
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

  const resetToFirstPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-section">
      <PolicyDeleteSuccessBanner listPath="/policy/bond" />
      <PageHeader
        title={t.policy.tabBond}
        actions={
          <>
            <Link href="/policy/bond/new">
              <Button>
                <Plus size={16} />
                {t.policy.addBondRecord}
              </Button>
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={resetToFirstPage(setSearch)}
          placeholder={t.policy.searchPlaceholderBond}
          className="w-full max-w-sm"
        />
        <Select value={customerFilter} onChange={(e) => resetToFirstPage(setCustomerFilter)(e.target.value)} className="w-auto max-w-[220px]">
          <option value="ALL">{t.policy.allCustomers}</option>
          {customerOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <Select value={typeFilter} onChange={(e) => resetToFirstPage(setTypeFilter)(e.target.value)} className="w-auto max-w-[200px]">
          <option value="ALL">{t.policy.allTypesOfCover}</option>
          {BOND_TYPES.map((bt) => (
            <option key={bt} value={bt}>{bondTypeLabel[bt]}</option>
          ))}
        </Select>
        <Select value={insurerFilter} onChange={(e) => resetToFirstPage(setInsurerFilter)(e.target.value)} className="w-auto max-w-[180px]">
          <option value="ALL">{t.policy.allInsurers}</option>
          {insurerOptions.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => resetToFirstPage(setStatusFilter)(e.target.value as typeof statusFilter)}
          className="w-auto max-w-[160px]"
        >
          <option value="ALL">{t.policy.allStatuses}</option>
          {(["DRAFT", "ACTIVE", "EXPIRED", "CANCELLED", "RENEWED"] as PolicyBusinessStatus[]).map((s) => (
            <option key={s} value={s}>{statusLabel[s]}</option>
          ))}
        </Select>
        <PolicyExpiryDateFilter value={expiryDate} onChange={resetToFirstPage(setExpiryDate)} />
      </div>

      <PolicyOutstandingBalanceCheckboxes
        outstandingClientOnly={outstandingClientOnly}
        onOutstandingClientOnlyChange={resetToFirstPage(setOutstandingClientOnly)}
        outstandingInsurerOnly={outstandingInsurerOnly}
        onOutstandingInsurerOnlyChange={resetToFirstPage(setOutstandingInsurerOnly)}
      />

      <TableWrap scroll>
        <Table className="min-w-[1200px]">
          <thead>
            <tr>
              <th>{t.policy.recordNumber}</th>
              <th>{t.policy.processingDate}</th>
              <th>{t.policy.customer}</th>
              <th>{t.policy.typeOfBond}</th>
              <th>{t.policy.insurer}</th>
              <th>{t.policy.expiryDate}</th>
              <th>{t.policy.clientPremium}</th>
              <th>{t.policy.clientBalance}</th>
              <th>{t.common.status}</th>
              <th>{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && <TableEmpty colSpan={10}>{t.policy.noRecordsBond}</TableEmpty>}
            {pageRows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium text-zinc-800">
                  <Link href={`/policy/bond/${r.id}`} className="text-emerald-700 hover:underline">
                    {r.recordNumber}
                  </Link>
                </td>
                <td className="text-zinc-500">{dateFormatter.format(new Date(r.processingDate))}</td>
                <td>{r.customerName}</td>
                <td className="text-zinc-500">
                  {r.bondType === "CUSTOM_BOND" && r.customBondType ? r.customBondType : bondTypeLabel[r.bondType]}
                </td>
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
                    <Link href={`/policy/bond/${r.id}`}>
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

      <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
