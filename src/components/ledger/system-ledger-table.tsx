"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Download } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { SearchBar } from "@/components/ui/search-bar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { formatMoney } from "@/components/ui/money-input";
import type { SystemLedgerRow, SystemLedgerSourceType } from "@/components/ledger/types";

type PolicyCategoryValue = SystemLedgerRow["policyCategory"];

const DIRECTION_TONE: Record<"INCOME" | "EXPENSE", "success" | "danger"> = {
  INCOME: "success",
  EXPENSE: "danger",
};

const PAGE_SIZE = 25;

function SummaryStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "success" | "danger" | "brand" }) {
  const toneClass: Record<string, string> = {
    neutral: "text-zinc-800",
    success: "text-emerald-700",
    danger: "text-red-600",
    brand: "text-emerald-700",
  };
  return (
    <Card>
      <p className="text-secondary text-sm">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${toneClass[tone]}`}>{value}</p>
    </Card>
  );
}

export function SystemLedgerTable({ records }: { records: SystemLedgerRow[] }) {
  const { t, locale } = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });

  const [search, setSearch] = useState("");
  const [sourceTypeFilter, setSourceTypeFilter] = useState<"ALL" | SystemLedgerSourceType>("ALL");
  const [directionFilter, setDirectionFilter] = useState<"ALL" | "INCOME" | "EXPENSE">("ALL");
  const [customerFilter, setCustomerFilter] = useState("ALL");
  const [policyCategoryFilter, setPolicyCategoryFilter] = useState<"ALL" | PolicyCategoryValue>("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const sourceTypeLabel: Record<SystemLedgerSourceType, string> = {
    CUSTOMER_PREMIUM_RECEIPT: t.ledger.typeCustomerPremiumReceipt,
    PROVIDER_PAYMENT: t.ledger.typeProviderPayment,
    COMMISSION_INCOME: t.ledger.commissionIncome,
  };

  const policyCategoryLabel: Record<PolicyCategoryValue, string> = {
    MOTOR: t.policy.tabMotor,
    NON_MOTOR: t.policy.tabNonMotor,
    BOND: t.policy.tabBond,
    WORK_PERMIT: t.policy.tabWorkPermit,
  };

  const rowTypeLabel = (r: SystemLedgerRow): string => {
    if (r.sourceType === "PROVIDER_PAYMENT" && r.policyCategory === "WORK_PERMIT") return t.ledger.typeAgentPayment;
    return sourceTypeLabel[r.sourceType];
  };

  const customerOptions = useMemo(() => Array.from(new Set(records.map((r) => r.customerName))).sort(), [records]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return records.filter((r) => {
      const matchesTerm =
        !term ||
        r.customerName.toLowerCase().includes(term) ||
        r.policyRecordNumber.toLowerCase().includes(term) ||
        (r.counterparty?.toLowerCase().includes(term) ?? false) ||
        (r.referenceNumber?.toLowerCase().includes(term) ?? false) ||
        (r.paymentMethod?.toLowerCase().includes(term) ?? false) ||
        (r.description?.toLowerCase().includes(term) ?? false);
      const matchesSourceType = sourceTypeFilter === "ALL" || r.sourceType === sourceTypeFilter;
      const matchesDirection = directionFilter === "ALL" || r.direction === directionFilter;
      const matchesCustomer = customerFilter === "ALL" || r.customerName === customerFilter;
      const matchesPolicyCategory = policyCategoryFilter === "ALL" || r.policyCategory === policyCategoryFilter;
      const dateOnly = r.transactionDate.slice(0, 10);
      const matchesFrom = !dateFrom || dateOnly >= dateFrom;
      const matchesTo = !dateTo || dateOnly <= dateTo;
      return matchesTerm && matchesSourceType && matchesDirection && matchesCustomer && matchesPolicyCategory && matchesFrom && matchesTo;
    });
  }, [records, search, sourceTypeFilter, directionFilter, customerFilter, policyCategoryFilter, dateFrom, dateTo]);

  const summary = useMemo(() => {
    let receipts = 0;
    let payments = 0;
    let commission = 0;
    for (const r of filtered) {
      if (r.sourceType === "CUSTOMER_PREMIUM_RECEIPT") receipts += Number(r.amount);
      else if (r.sourceType === "PROVIDER_PAYMENT") payments += Number(r.amount);
      else commission += Number(r.amount);
    }
    return { receipts, payments, commission, net: receipts + commission - payments };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const resetToFirstPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (sourceTypeFilter !== "ALL") params.set("sourceType", sourceTypeFilter);
    if (directionFilter !== "ALL") params.set("direction", directionFilter);
    if (customerFilter !== "ALL") params.set("customer", customerFilter);
    if (policyCategoryFilter !== "ALL") params.set("policyCategory", policyCategoryFilter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return `/api/ledger/system/export?${params.toString()}`;
  }, [search, sourceTypeFilter, directionFilter, customerFilter, policyCategoryFilter, dateFrom, dateTo]);

  return (
    <div className="flex flex-col gap-section">
      <PageHeader
        title={t.ledger.tabSystem}
        actions={
          <a href={exportUrl}>
            <Button variant="secondary" aria-label={t.ledger.exportSystemRecords}>
              <Download size={16} />
              {t.ledger.exportExcel}
            </Button>
          </a>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryStat label={t.ledger.customerPremiumReceived} value={formatMoney(summary.receipts.toFixed(2))} tone="success" />
        <SummaryStat label={t.ledger.providerPayments} value={formatMoney(summary.payments.toFixed(2))} tone="danger" />
        <SummaryStat label={t.ledger.commissionIncome} value={formatMoney(summary.commission.toFixed(2))} tone="success" />
        <SummaryStat label={t.ledger.systemNetCashFlow} value={formatMoney(summary.net.toFixed(2))} tone={summary.net >= 0 ? "success" : "danger"} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar value={search} onChange={resetToFirstPage(setSearch)} placeholder={t.ledger.searchPlaceholderSystem} className="w-full max-w-sm" />
        <Select value={sourceTypeFilter} onChange={(e) => resetToFirstPage(setSourceTypeFilter)(e.target.value as typeof sourceTypeFilter)} className="w-auto max-w-[200px]">
          <option value="ALL">{t.ledger.allTypes}</option>
          <option value="CUSTOMER_PREMIUM_RECEIPT">{sourceTypeLabel.CUSTOMER_PREMIUM_RECEIPT}</option>
          <option value="PROVIDER_PAYMENT">{sourceTypeLabel.PROVIDER_PAYMENT}</option>
          <option value="COMMISSION_INCOME">{sourceTypeLabel.COMMISSION_INCOME}</option>
        </Select>
        <Select value={directionFilter} onChange={(e) => resetToFirstPage(setDirectionFilter)(e.target.value as typeof directionFilter)} className="w-auto max-w-[160px]">
          <option value="ALL">{t.ledger.allDirections}</option>
          <option value="INCOME">{t.ledger.income}</option>
          <option value="EXPENSE">{t.ledger.expense}</option>
        </Select>
        <Select value={customerFilter} onChange={(e) => resetToFirstPage(setCustomerFilter)(e.target.value)} className="w-auto max-w-[200px]">
          <option value="ALL">{t.ledger.allCustomers}</option>
          {customerOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <Select value={policyCategoryFilter} onChange={(e) => resetToFirstPage(setPolicyCategoryFilter)(e.target.value as typeof policyCategoryFilter)} className="w-auto max-w-[180px]">
          <option value="ALL">{t.ledger.allPolicyCategories}</option>
          {(Object.keys(policyCategoryLabel) as PolicyCategoryValue[]).map((c) => (
            <option key={c} value={c}>{policyCategoryLabel[c]}</option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-secondary">
          {t.ledger.dateFrom}
          <Input type="date" value={dateFrom} onChange={(e) => resetToFirstPage(setDateFrom)(e.target.value)} className="w-auto" />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-secondary">
          {t.ledger.dateTo}
          <Input type="date" value={dateTo} onChange={(e) => resetToFirstPage(setDateTo)(e.target.value)} className="w-auto" />
        </label>
      </div>

      <TableWrap scroll>
        <Table className="min-w-[1300px]">
          <thead>
            <tr>
              <th>{t.ledger.date}</th>
              <th>{t.ledger.type}</th>
              <th>{t.ledger.direction}</th>
              <th>{t.ledger.filterCustomer}</th>
              <th>{t.ledger.colPolicyRecord}</th>
              <th>{t.ledger.colPolicyCategory}</th>
              <th>{t.ledger.colCounterparty}</th>
              <th>{t.ledger.description}</th>
              <th>{t.ledger.paymentMethod}</th>
              <th>{t.ledger.referenceNumber}</th>
              <th>{t.ledger.amount}</th>
              <th>{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && <TableEmpty colSpan={12}>{t.ledger.noSystemRecords}</TableEmpty>}
            {pageRows.map((r) => (
              <tr key={r.id}>
                <td className="text-zinc-500">{dateFormatter.format(new Date(r.transactionDate))}</td>
                <td className="text-zinc-500">{rowTypeLabel(r)}</td>
                <td>
                  <Badge tone={DIRECTION_TONE[r.direction]}>{r.direction === "INCOME" ? t.ledger.income : t.ledger.expense}</Badge>
                </td>
                <td className="max-w-[220px] break-words">{r.customerName}</td>
                <td className="text-zinc-500">{r.policyRecordNumber}</td>
                <td className="text-zinc-500">{policyCategoryLabel[r.policyCategory]}</td>
                <td className="max-w-[200px] break-words text-zinc-500">{r.counterparty || "—"}</td>
                <td className="text-zinc-500">{r.description || "—"}</td>
                <td className="text-zinc-500">{r.paymentMethod || "—"}</td>
                <td className="text-zinc-500">{r.referenceNumber || "—"}</td>
                <td className={r.direction === "INCOME" ? "font-medium text-emerald-700" : "font-medium text-red-600"}>
                  {formatMoney(r.amount)}
                </td>
                <td>
                  <Link href={r.sourceRoute} className="inline-flex items-center gap-1 text-emerald-700 hover:underline">
                    <ExternalLink size={14} />
                    {t.ledger.openSource}
                  </Link>
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
