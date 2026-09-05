"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Eye, Plus, Upload, Download } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
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
import { MOTOR_VALUATION_STATUSES, isComprehensiveMotorCover } from "@/lib/policy/motorValuation";
import { MotorValuationBadge } from "@/components/policy/motor/motor-valuation-badge";
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
// Phase 12A: `contact` (free-text Contact Person / 经办人, case-insensitive
// partial match), `expiryFrom` and `expiryTo` are applied server-side (see
// policy/motor/page.tsx + buildMotorListFilterWhere) — they are tracked here
// only so useUrlListState keeps them in the URL and drives the server
// re-fetch on change. `contact` + the expiry range replace the former
// single-date `expiryDate` exact-match key. Every other key below is still
// the pre-existing client-side filter, unchanged.
const MOTOR_LIST_DEFAULTS = {
  search: "",
  customer: "ALL",
  type: "ALL",
  insurer: "ALL",
  status: "ALL",
  contact: "",
  expiryFrom: "",
  expiryTo: "",
  valuationStatus: "ALL",
  outstandingClientOnly: "",
  outstandingInsurerOnly: "",
  page: "1",
  customerId: "",
};

export function MotorListTable({ records, canEdit }: { records: MotorListRow[]; canEdit: boolean }) {
  const { t, locale } = useLocale();
  const [listState, setListState] = useUrlListState(MOTOR_LIST_DEFAULTS);
  const {
    search,
    customer: customerFilter,
    type: typeFilter,
    insurer: insurerFilter,
    status: statusFilter,
    contact: contactFilter,
    expiryFrom,
    expiryTo,
    valuationStatus: valuationFilter,
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

  const valuationFilterLabel: Record<string, string> = {
    NOT_ARRANGED: t.policy.valuationNotArranged,
    IN_PROGRESS: t.policy.valuationInProgress,
    COMPLETED: t.policy.valuationCompleted,
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
      // Handler + Expiry range are filtered server-side (see
      // policy/motor/page.tsx) — `records` is already narrowed by the time
      // it reaches here, so there is nothing to re-check client-side.
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
            {canEdit && (
              <Link href="/policy/motor/import">
                <Button variant="secondary">
                  <Upload size={16} />
                  {t.policy.importHistorical}
                </Button>
              </Link>
            )}
            <IconButton title={t.comingSoon.title} disabled>
              <Download size={16} />
            </IconButton>
            {canEdit && (
              <Link href="/policy/motor/new">
                <Button>
                  <Plus size={16} />
                  {t.policy.addMotorRecord}
                </Button>
              </Link>
            )}
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
        <Input
          value={contactFilter}
          onChange={(e) => setListState({ contact: e.target.value, page: "1" })}
          placeholder={t.policy.contactPersonFilterPlaceholder}
          aria-label={t.policy.contactPerson}
          className="w-auto max-w-[200px]"
        />
        <Select
          value={valuationFilter}
          onChange={(e) => setListState({ valuationStatus: e.target.value, page: "1" }, { immediate: true })}
          className="w-auto max-w-[180px]"
          aria-label={t.policy.valuationStatus}
        >
          <option value="ALL">{t.policy.allValuationStatuses}</option>
          {MOTOR_VALUATION_STATUSES.map((s) => (
            <option key={s} value={s}>{valuationFilterLabel[s]}</option>
          ))}
        </Select>
        <PolicyExpiryDateFilter
          fromValue={expiryFrom}
          toValue={expiryTo}
          onFromChange={(value) => setListState({ expiryFrom: value, page: "1" }, { immediate: true })}
          onToChange={(value) => setListState({ expiryTo: value, page: "1" }, { immediate: true })}
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
        {/* Phase 12A — explicit column widths + nowrap headers so every
            header label (incl. the Chinese "保险公司" / "经办人") stays on one
            line. Customer / Insurance Type get the extra room their longer
            content needs; Actions stays compact. table-layout stays `auto`,
            so these widths are proportional hints and long cell content
            still widens the table into its horizontal scroll on small
            screens. */}
        <Table className="min-w-[1290px]">
          <colgroup>
            <col style={{ width: "104px" }} />
            <col style={{ width: "120px" }} />
            <col style={{ width: "200px" }} />
            <col style={{ width: "140px" }} />
            <col style={{ width: "160px" }} />
            <col style={{ width: "112px" }} />
            <col style={{ width: "120px" }} />
            <col style={{ width: "132px" }} />
            <col style={{ width: "112px" }} />
            <col style={{ width: "120px" }} />
            <col style={{ width: "120px" }} />
            <col style={{ width: "100px" }} />
            <col style={{ width: "64px" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="whitespace-nowrap">{t.policy.recordNumber}</th>
              <th className="whitespace-nowrap">{t.policy.processingDate}</th>
              <th className="whitespace-nowrap">{t.policy.customer}</th>
              <th className="whitespace-nowrap">{t.policy.contactPerson}</th>
              <th className="whitespace-nowrap">{t.policy.typeOfCover}</th>
              <th className="whitespace-nowrap">{t.policy.valuationColumn}</th>
              <th className="whitespace-nowrap">{t.policy.registrationNumber}</th>
              <th className="whitespace-nowrap">{t.policy.insurer}</th>
              <th className="whitespace-nowrap">{t.policy.expiryDate}</th>
              <th className="whitespace-nowrap">{t.policy.clientPremium}</th>
              <th className="whitespace-nowrap">{t.policy.clientBalance}</th>
              <th className="whitespace-nowrap">{t.common.status}</th>
              <th className="whitespace-nowrap">{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && <TableEmpty colSpan={13}>{t.policy.noRecords}</TableEmpty>}
            {pageRows.map((r) => (
              <tr key={r.id}>
                <td className="font-medium whitespace-nowrap text-zinc-800">
                  <Link href={`/policy/motor/${r.id}`} className="text-emerald-700 hover:underline">
                    {r.recordNumber}
                  </Link>
                </td>
                <td className="whitespace-nowrap text-zinc-500">{dateFormatter.format(new Date(r.processingDate))}</td>
                <td>{r.customerName}</td>
                <td className="text-zinc-500">{r.contactPerson || "—"}</td>
                <td className="text-zinc-500">{r.insuranceType}</td>
                <td className="whitespace-nowrap">
                  {r.valuationStatus && isComprehensiveMotorCover(r.insuranceType) ? (
                    <MotorValuationBadge status={r.valuationStatus} />
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap text-zinc-500">{r.registrationNumber}</td>
                <td className="text-zinc-500">{r.insurerName || "—"}</td>
                <td className="whitespace-nowrap text-zinc-500">{dateFormatter.format(new Date(r.expiryDate))}</td>
                <td className="whitespace-nowrap text-zinc-500">{formatMoney(r.clientPremium)}</td>
                <td className={`whitespace-nowrap ${Number(r.clientBalance) > 0 ? "font-medium text-amber-700" : "text-zinc-500"}`}>
                  {formatMoney(r.clientBalance)}
                </td>
                <td className="whitespace-nowrap">
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
