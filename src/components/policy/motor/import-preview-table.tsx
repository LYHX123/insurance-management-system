"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Info } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { formatMoney } from "@/components/ui/money-input";
import {
  applyManualCustomerMappingAction,
  createCustomersFromHistoricalNamesAction,
  skipHistoricalCustomerGroupAction,
  acceptPossibleMatchAction,
  rejectPossibleMatchAction,
  toggleImportRowIncludeAction,
  toggleDuplicateGroupIncludeAction,
  toggleRowSelectionAction,
  clearSelectionAction,
  selectFirstNEligibleAction,
  selectAllEligibleAction,
  importSelectedRowsAction,
  type ImportResultReport,
  type ImportBatchSummary,
} from "@/app/(app)/policy/motor/import/actions";

export type ImportPreviewRowData = {
  id: string;
  originalRowNumber: number;
  processingDate: string | null;
  customerNameRaw: string | null;
  matchedCustomerId: string | null;
  customerMatchStatus: "MATCHED" | "POSSIBLE" | "MANUAL" | "UNMATCHED";
  insuranceType: string | null;
  registrationNumber: string | null;
  insurerName: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  insurerCost: string | null;
  amountPaidToInsurer: string | null;
  calculatedInsurerBalance: string | null;
  originalInsurerBalance: string | null;
  clientPremium: string | null;
  amountReceivedFromClient: string | null;
  calculatedClientBalance: string | null;
  originalClientBalance: string | null;
  commissionReceived: boolean;
  insurerBalanceVerification: "VERIFIED" | "UNVERIFIED";
  clientBalanceVerification: "VERIFIED" | "UNVERIFIED";
  status: "READY" | "WARNING" | "POSSIBLE_DUPLICATE" | "EXACT_DUPLICATE" | "ERROR" | "IMPORTED" | "SKIPPED";
  warnings: string[];
  duplicateOfRowNumbers: number[];
  duplicateOfPolicyRecordId: string | null;
  includeInImport: boolean;
  isSelectedForImport: boolean;
};

const STATUS_TONE: Record<ImportPreviewRowData["status"], "neutral" | "brand" | "success" | "warning" | "danger"> = {
  READY: "success",
  WARNING: "warning",
  POSSIBLE_DUPLICATE: "brand",
  EXACT_DUPLICATE: "danger",
  ERROR: "danger",
  IMPORTED: "success",
  SKIPPED: "neutral",
};

const MATCH_TONE: Record<ImportPreviewRowData["customerMatchStatus"], "neutral" | "brand" | "success" | "warning" | "danger"> = {
  MATCHED: "success",
  POSSIBLE: "warning",
  MANUAL: "brand",
  UNMATCHED: "danger",
};

const PAGE_SIZE = 50;

function isRowEligible(r: ImportPreviewRowData): boolean {
  return (
    r.includeInImport &&
    r.status !== "ERROR" &&
    r.status !== "EXACT_DUPLICATE" &&
    r.status !== "IMPORTED" &&
    r.customerMatchStatus !== "POSSIBLE"
  );
}

export function ImportPreviewTable({
  batchId,
  batchStatus,
  sourceFileName,
  rows: initialRows,
  customers,
  initialSummary,
}: {
  batchId: string;
  batchStatus: string;
  sourceFileName: string;
  rows: ImportPreviewRowData[];
  customers: { id: string; companyName: string }[];
  initialSummary: ImportBatchSummary | null;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });

  const [rows, setRows] = useState(initialRows);
  const [statusFilter, setStatusFilter] = useState<"ALL" | ImportPreviewRowData["status"]>("ALL");
  const [page, setPage] = useState(1);
  const [mappingSelections, setMappingSelections] = useState<Record<string, string>>({});
  const [selectedUnmatched, setSelectedUnmatched] = useState<Record<string, boolean>>({});
  const [busyName, setBusyName] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [groupBusy, setGroupBusy] = useState<string | null>(null);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmedRowIds, setConfirmedRowIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportResultReport | null>(null);

  const statusLabel: Record<ImportPreviewRowData["status"], string> = {
    READY: t.policy.filterStatusReady,
    WARNING: t.policy.filterStatusWarning,
    POSSIBLE_DUPLICATE: t.policy.filterStatusPossibleDuplicate,
    EXACT_DUPLICATE: t.policy.filterStatusExactDuplicate,
    ERROR: t.policy.filterStatusError,
    IMPORTED: t.common.confirm,
    SKIPPED: t.common.close,
  };

  const matchLabel: Record<ImportPreviewRowData["customerMatchStatus"], string> = {
    MATCHED: t.policy.importMatchedBadge,
    POSSIBLE: t.policy.importPossibleBadge,
    MANUAL: t.policy.importManualBadge,
    UNMATCHED: t.policy.importUnmatchedBadge,
  };

  // --- Customer resolution groups ---------------------------------------
  const unmatchedGroups = useMemo(() => {
    const names = new Map<string, number>();
    for (const r of rows) {
      if (r.customerMatchStatus === "UNMATCHED" && r.customerNameRaw) {
        names.set(r.customerNameRaw, (names.get(r.customerNameRaw) ?? 0) + 1);
      }
    }
    return Array.from(names.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const possibleGroups = useMemo(() => {
    const names = new Map<string, { count: number; matchedCustomerId: string | null }>();
    for (const r of rows) {
      if (r.customerMatchStatus === "POSSIBLE" && r.customerNameRaw) {
        const existing = names.get(r.customerNameRaw);
        names.set(r.customerNameRaw, { count: (existing?.count ?? 0) + 1, matchedCustomerId: r.matchedCustomerId });
      }
    }
    return Array.from(names.entries()).sort((a, b) => b[1].count - a[1].count);
  }, [rows]);

  const duplicateGroups = useMemo(() => {
    const seen = new Set<number>();
    const groups: { rowNumbers: number[]; anyIncluded: boolean }[] = [];
    for (const r of rows) {
      if (r.status !== "POSSIBLE_DUPLICATE" || seen.has(r.originalRowNumber)) continue;
      const members = [r.originalRowNumber, ...r.duplicateOfRowNumbers].sort((a, b) => a - b);
      members.forEach((m) => seen.add(m));
      const anyIncluded = rows.some((row) => members.includes(row.originalRowNumber) && row.includeInImport);
      groups.push({ rowNumbers: members, anyIncluded });
    }
    return groups;
  }, [rows]);

  const counts = useMemo(() => {
    const c: Record<ImportPreviewRowData["status"], number> = {
      READY: 0, WARNING: 0, POSSIBLE_DUPLICATE: 0, EXACT_DUPLICATE: 0, ERROR: 0, IMPORTED: 0, SKIPPED: 0,
    };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const selectedRows = useMemo(() => rows.filter((r) => r.isSelectedForImport), [rows]);
  const selectedCount = selectedRows.length;
  const blockedSelectedCount = useMemo(() => selectedRows.filter((r) => !isRowEligible(r)).length, [selectedRows]);

  const filtered = useMemo(
    () => (statusFilter === "ALL" ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter]
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageEligibleIds = pageRows.filter(isRowEligible).map((r) => r.id);
  const allPageEligibleSelected = pageEligibleIds.length > 0 && pageEligibleIds.every((id) => rows.find((r) => r.id === id)?.isSelectedForImport);

  const refresh = () => router.refresh();

  const handleApplyMapping = async (name: string) => {
    const customerId = mappingSelections[name];
    if (!customerId) return;
    setBusyName(name);
    const result = await applyManualCustomerMappingAction(batchId, name, customerId);
    setBusyName(null);
    if (result.success) refresh();
  };

  const handleCreateCustomers = async (names: string[]) => {
    if (names.length === 0) return;
    setBusyName(names.length === 1 ? names[0] : "__bulk__");
    const result = await createCustomersFromHistoricalNamesAction(batchId, names);
    setBusyName(null);
    if (result.success) {
      setSelectedUnmatched({});
      refresh();
    }
  };

  const handleSkipGroup = async (name: string) => {
    setBusyName(name);
    const result = await skipHistoricalCustomerGroupAction(batchId, name);
    setBusyName(null);
    if (result.success) refresh();
  };

  const handleAcceptPossible = async (name: string) => {
    setBusyName(name);
    const result = await acceptPossibleMatchAction(batchId, name);
    setBusyName(null);
    if (result.success) refresh();
  };

  const handleRejectPossible = async (name: string) => {
    setBusyName(name);
    const result = await rejectPossibleMatchAction(batchId, name);
    setBusyName(null);
    if (result.success) refresh();
  };

  const handleToggleInclude = async (rowId: string, include: boolean) => {
    setRowBusy(rowId);
    const result = await toggleImportRowIncludeAction(rowId, include);
    setRowBusy(null);
    if (result.success) refresh();
  };

  const handleToggleGroup = async (rowNumbers: number[], include: boolean) => {
    const key = rowNumbers.join(",");
    setGroupBusy(key);
    const result = await toggleDuplicateGroupIncludeAction(batchId, rowNumbers, include);
    setGroupBusy(null);
    if (result.success) refresh();
  };

  const handleToggleSelection = async (rowId: string, selected: boolean) => {
    setRowBusy(rowId);
    const result = await toggleRowSelectionAction(rowId, selected);
    setRowBusy(null);
    if (result.success) {
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, isSelectedForImport: selected } : r)));
    }
  };

  const handleTogglePageAll = async (selectAll: boolean) => {
    setSelectionBusy(true);
    for (const id of pageEligibleIds) {
      await toggleRowSelectionAction(id, selectAll);
    }
    setSelectionBusy(false);
    refresh();
  };

  const handleClearSelection = async () => {
    setSelectionBusy(true);
    await clearSelectionAction(batchId);
    setSelectionBusy(false);
    refresh();
  };

  const handleSelectFirstN = async (n: number) => {
    setSelectionBusy(true);
    await selectFirstNEligibleAction(batchId, n);
    setSelectionBusy(false);
    refresh();
  };

  const handleSelectAllEligible = async () => {
    setSelectionBusy(true);
    await selectAllEligibleAction(batchId);
    setSelectionBusy(false);
    refresh();
  };

  const openConfirm = () => {
    setConfirmedRowIds(selectedRows.map((r) => r.id));
    setConfirmError(null);
    setShowConfirm(true);
  };

  const handleImportSelected = async () => {
    setConfirming(true);
    setConfirmError(null);
    const result = await importSelectedRowsAction(batchId, confirmedRowIds);
    setConfirming(false);
    if (!result.success) {
      const errorLabel: Record<string, string> = {
        NO_ROWS_SELECTED: t.policy.importErrorNoRowsSelected,
        SELECTION_CHANGED: t.policy.importErrorSelectionChanged,
        SELECTED_ROWS_NOT_IMPORTABLE: t.policy.importErrorRowsNotImportable,
        ALREADY_COMPLETED: t.policy.genericError,
      };
      setConfirmError(errorLabel[result.error] ?? t.policy.genericError);
      return;
    }
    setReport(result.report);
    setShowConfirm(false);
  };

  if (report) {
    return (
      <div className="flex flex-col gap-section">
        <PageHeader title={t.policy.importResultTitle} />
        <Card>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <SummaryStat label={t.policy.resultPoliciesCreated} value={report.policiesCreated} tone="success" />
            <SummaryStat label={t.policy.resultCustomersCreated} value={report.customersCreated} tone="brand" />
            <SummaryStat label={t.policy.resultReceiptsCreated} value={report.customerReceiptsCreated} />
            <SummaryStat label={t.policy.resultPaymentsCreated} value={report.providerPaymentsCreated} />
            <SummaryStat label={t.policy.resultRowsImported} value={report.rowsImported} tone="success" />
            <SummaryStat label={t.policy.resultRowsRemaining} value={report.rowsRemaining} />
            <SummaryStat label={t.policy.resultRowsSkippedOrBlocked} value={report.rowsSkippedOrBlocked} tone="warning" />
          </dl>
        </Card>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setReport(null);
              refresh();
            }}
          >
            {t.policy.importContinueInBatch}
          </Button>
          <Button onClick={() => router.push("/policy/motor")}>{t.policy.importDone}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section">
      <div>
        <Link href="/policy/motor" className="mb-2 inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline">
          <ArrowLeft size={14} />
          {t.policy.backToList}
        </Link>
        <PageHeader title={t.policy.importPreviewTitle} description={`${sourceFileName} — ${t.policy.importPreviewDescription}`} />
      </div>

      <div className="flex items-start gap-2 rounded-control border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        <Info size={16} className="mt-0.5 shrink-0" />
        <p>{t.policy.controlledImportNotice}</p>
      </div>

      {initialSummary && (
        <Card>
          <h2 className="section-title mb-3">{t.policy.importSummaryTitle}</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <SummaryStat label={t.policy.summaryTotalParsedRows} value={initialSummary.totalParsedRows} />
            <SummaryStat label={t.policy.summaryImportedRows} value={initialSummary.importedRows} tone="success" />
            <SummaryStat label={t.policy.summarySelectedRows} value={initialSummary.selectedRows} tone="brand" />
            <SummaryStat label={t.policy.summaryReadyButUnselected} value={initialSummary.readyButUnselected} />
            <SummaryStat label={t.policy.summarySkippedRows} value={initialSummary.skippedRows} />
            <SummaryStat label={t.policy.summaryErrorRows} value={initialSummary.errorRows} tone="danger" />
            <SummaryStat label={t.policy.summaryPossibleDuplicatesAwaiting} value={initialSummary.possibleDuplicatesAwaitingDecision} tone="warning" />
            <SummaryStat label={t.policy.summaryDuplicateOverrides} value={initialSummary.possibleDuplicatesOverridden} tone="brand" />
            <SummaryStat label={t.policy.summaryExactDuplicatesBlocked} value={initialSummary.exactDuplicatesBlocked} tone="danger" />
            <SummaryStat label={t.policy.summaryUnmatchedCustomers} value={initialSummary.unmatchedCustomers} />
            <SummaryStat label={t.policy.summaryPossibleCustomerMatches} value={initialSummary.possibleCustomerMatchesAwaitingAcceptance} tone="warning" />
            <SummaryStat label={t.policy.summaryNewlyCreatedCustomers} value={initialSummary.newlyCreatedCustomers} tone="brand" />
            <SummaryStat label={t.policy.summaryUnverifiedInsurer} value={initialSummary.rowsWithUnverifiedInsurerBalance} tone="warning" />
            <SummaryStat label={t.policy.summaryUnverifiedClient} value={initialSummary.rowsWithUnverifiedClientBalance} tone="warning" />
            <SummaryStat label={t.policy.summaryRemainingAfterImport} value={initialSummary.remainingAfterLatestSelectedImport} />
          </dl>
        </Card>
      )}

      {unmatchedGroups.length > 0 && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="section-title">{t.policy.importUnmatchedCustomersTitle}</h2>
            <Button
              variant="secondary"
              onClick={() => handleCreateCustomers(unmatchedGroups.map(([name]) => name))}
              disabled={busyName !== null}
            >
              {t.policy.importCreateAllUnmatched}
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {Object.values(selectedUnmatched).some(Boolean) && (
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  onClick={() => handleCreateCustomers(Object.entries(selectedUnmatched).filter(([, v]) => v).map(([k]) => k))}
                  disabled={busyName !== null}
                >
                  {t.policy.importCreateSelected}
                </Button>
              </div>
            )}
            {unmatchedGroups.map(([name, count]) => (
              <div key={name} className="flex flex-wrap items-center gap-2 rounded-control border border-zinc-200 p-2">
                <input
                  type="checkbox"
                  checked={!!selectedUnmatched[name]}
                  onChange={(e) => setSelectedUnmatched((prev) => ({ ...prev, [name]: e.target.checked }))}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                <span className="min-w-[200px] flex-1 text-sm font-medium text-zinc-800">
                  {name} <span className="text-zinc-400">({count})</span>
                </span>
                <Select
                  value={mappingSelections[name] ?? ""}
                  onChange={(e) => setMappingSelections((prev) => ({ ...prev, [name]: e.target.value }))}
                  className="w-auto max-w-[240px]"
                >
                  <option value="">{t.policy.importSelectCustomerToMap}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.companyName}</option>
                  ))}
                </Select>
                <Button variant="secondary" onClick={() => handleApplyMapping(name)} disabled={!mappingSelections[name] || busyName === name}>
                  {t.policy.importApplyMapping}
                </Button>
                <Button variant="secondary" onClick={() => handleCreateCustomers([name])} disabled={busyName === name}>
                  {t.policy.importCreateCustomer}
                </Button>
                <Button variant="destructive" onClick={() => handleSkipGroup(name)} disabled={busyName === name}>
                  {t.policy.importSkipCustomer}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {possibleGroups.length > 0 && (
        <Card>
          <h2 className="section-title mb-3">{t.policy.importPossibleMatchesTitle}</h2>
          <div className="flex flex-col gap-2">
            {possibleGroups.map(([name, info]) => {
              const candidate = customers.find((c) => c.id === info.matchedCustomerId);
              return (
                <div key={name} className="flex flex-wrap items-center gap-2 rounded-control border border-amber-200 bg-amber-50 p-2">
                  <span className="min-w-[200px] flex-1 text-sm font-medium text-zinc-800">
                    {name} <span className="text-zinc-400">({info.count})</span>
                    {candidate && <span className="ml-1 text-zinc-500">→ {candidate.companyName}</span>}
                  </span>
                  <Button variant="secondary" onClick={() => handleAcceptPossible(name)} disabled={busyName === name}>
                    {t.policy.importAcceptMatch}
                  </Button>
                  <Button variant="destructive" onClick={() => handleRejectPossible(name)} disabled={busyName === name}>
                    {t.policy.importRejectMatch}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {duplicateGroups.length > 0 && (
        <Card>
          <h2 className="section-title mb-3">{t.policy.importDuplicateGroupsTitle}</h2>
          <div className="flex flex-col gap-2">
            {duplicateGroups.map((group) => {
              const key = group.rowNumbers.join(",");
              return (
                <div key={key} className="flex flex-wrap items-center gap-2 rounded-control border border-zinc-200 p-2">
                  <span className="flex-1 text-sm font-medium text-zinc-800">
                    {t.policy.importColRowNumber} {group.rowNumbers.join(", ")}
                  </span>
                  {group.anyIncluded ? (
                    <Button variant="destructive" onClick={() => handleToggleGroup(group.rowNumbers, false)} disabled={groupBusy === key}>
                      {t.policy.importExcludeGroup}
                    </Button>
                  ) : (
                    <Button variant="secondary" onClick={() => handleToggleGroup(group.rowNumbers, true)} disabled={groupBusy === key}>
                      {t.policy.importIncludeGroup}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-zinc-700">{t.policy.selectionControlsTitle}</span>
          <Button variant="secondary" onClick={handleClearSelection} disabled={selectionBusy}>
            {t.policy.selectionClear}
          </Button>
          <Button variant="secondary" onClick={() => handleSelectFirstN(5)} disabled={selectionBusy}>
            {t.policy.selectionFirst5}
          </Button>
          <Button variant="secondary" onClick={() => handleSelectFirstN(10)} disabled={selectionBusy}>
            {t.policy.selectionFirst10}
          </Button>
          <Button variant="secondary" onClick={() => handleSelectFirstN(20)} disabled={selectionBusy}>
            {t.policy.selectionFirst20}
          </Button>
          <Button variant="secondary" onClick={handleSelectAllEligible} disabled={selectionBusy}>
            {t.policy.selectionAllEligible}
          </Button>
          <span className="ml-auto text-sm text-zinc-500">
            {t.policy.selectionCurrentCount}: <span className="font-semibold text-zinc-800">{selectedCount}</span>
          </span>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(1); }} className="w-auto max-w-[220px]">
          <option value="ALL">{t.policy.filterAllRowStatuses}</option>
          <option value="READY">{t.policy.filterStatusReady} ({counts.READY})</option>
          <option value="WARNING">{t.policy.filterStatusWarning} ({counts.WARNING})</option>
          <option value="POSSIBLE_DUPLICATE">{t.policy.filterStatusPossibleDuplicate} ({counts.POSSIBLE_DUPLICATE})</option>
          <option value="EXACT_DUPLICATE">{t.policy.filterStatusExactDuplicate} ({counts.EXACT_DUPLICATE})</option>
          <option value="ERROR">{t.policy.filterStatusError} ({counts.ERROR})</option>
        </Select>
      </div>

      <TableWrap scroll>
        <Table className="min-w-[2200px]">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={allPageEligibleSelected}
                  disabled={pageEligibleIds.length === 0 || selectionBusy}
                  onChange={(e) => handleTogglePageAll(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300"
                  title={t.policy.selectionSelectAllVisible}
                />
              </th>
              <th>{t.policy.importColInclude}</th>
              <th>{t.policy.importColRowNumber}</th>
              <th>{t.policy.importColProcessingDate}</th>
              <th>{t.policy.importColCustomer}</th>
              <th>{t.policy.importColTypeOfCover}</th>
              <th>{t.policy.importColRegistrationNumber}</th>
              <th>{t.policy.importColInsurer}</th>
              <th>{t.policy.importColEffectiveDate}</th>
              <th>{t.policy.importColExpiryDate}</th>
              <th>{t.policy.importColInsurerCost}</th>
              <th>{t.policy.importColAmountPaid}</th>
              <th>{t.policy.importColCalcInsurerBalance}</th>
              <th>{t.policy.importColOrigInsurerBalance}</th>
              <th>{t.policy.importColClientPremium}</th>
              <th>{t.policy.importColAmountReceived}</th>
              <th>{t.policy.importColCalcClientBalance}</th>
              <th>{t.policy.importColOrigClientBalance}</th>
              <th>{t.policy.importColCommission}</th>
              <th>{t.policy.importColStatus}</th>
              <th>{t.policy.importColWarnings}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && <TableEmpty colSpan={21}>{t.policy.noRecords}</TableEmpty>}
            {pageRows.map((r) => {
              const unverified = r.insurerBalanceVerification === "UNVERIFIED" || r.clientBalanceVerification === "UNVERIFIED";
              const eligible = isRowEligible(r);
              return (
                <tr key={r.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.isSelectedForImport}
                      disabled={!eligible || rowBusy === r.id}
                      onChange={(e) => handleToggleSelection(r.id, e.target.checked)}
                      className="h-4 w-4 rounded border-zinc-300"
                      title={eligible ? t.policy.selectionSelectRow : t.policy.selectionRowNotEligible}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.includeInImport}
                      disabled={r.status === "ERROR" || r.status === "EXACT_DUPLICATE" || rowBusy === r.id}
                      onChange={(e) => handleToggleInclude(r.id, e.target.checked)}
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                  </td>
                  <td className="text-zinc-500">{r.originalRowNumber}</td>
                  <td className="text-zinc-500">{r.processingDate ? dateFormatter.format(new Date(r.processingDate)) : "—"}</td>
                  <td>
                    <div className="flex flex-col gap-0.5">
                      <span>{r.customerNameRaw || "—"}</span>
                      <Badge tone={MATCH_TONE[r.customerMatchStatus]}>{matchLabel[r.customerMatchStatus]}</Badge>
                    </div>
                  </td>
                  <td className="text-zinc-500">{r.insuranceType || "—"}</td>
                  <td className="text-zinc-500">{r.registrationNumber || "—"}</td>
                  <td className="text-zinc-500">{r.insurerName || "—"}</td>
                  <td className="text-zinc-500">{r.effectiveDate ? dateFormatter.format(new Date(r.effectiveDate)) : "—"}</td>
                  <td className="text-zinc-500">{r.expiryDate ? dateFormatter.format(new Date(r.expiryDate)) : "—"}</td>
                  <td className="text-zinc-500">{r.insurerCost ? formatMoney(r.insurerCost) : "—"}</td>
                  <td className="text-zinc-500">{r.amountPaidToInsurer ? formatMoney(r.amountPaidToInsurer) : "—"}</td>
                  <td className="text-zinc-500">{r.calculatedInsurerBalance ? formatMoney(r.calculatedInsurerBalance) : "—"}</td>
                  <td className="text-zinc-500">
                    {r.insurerBalanceVerification === "UNVERIFIED" ? (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <AlertTriangle size={12} /> {t.policy.unverifiedShort}
                      </span>
                    ) : r.originalInsurerBalance ? (
                      formatMoney(r.originalInsurerBalance)
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-zinc-500">{r.clientPremium ? formatMoney(r.clientPremium) : "—"}</td>
                  <td className="text-zinc-500">{r.amountReceivedFromClient ? formatMoney(r.amountReceivedFromClient) : "—"}</td>
                  <td className="text-zinc-500">{r.calculatedClientBalance ? formatMoney(r.calculatedClientBalance) : "—"}</td>
                  <td className="text-zinc-500">
                    {r.clientBalanceVerification === "UNVERIFIED" ? (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <AlertTriangle size={12} /> {t.policy.unverifiedShort}
                      </span>
                    ) : r.originalClientBalance ? (
                      formatMoney(r.originalClientBalance)
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-zinc-500">{r.commissionReceived ? t.common.yes : t.common.no}</td>
                  <td>
                    <div className="flex flex-col gap-0.5">
                      <Badge tone={STATUS_TONE[r.status]}>{statusLabel[r.status]}</Badge>
                      {unverified && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                          <AlertTriangle size={11} /> {t.policy.unverifiedShort}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="max-w-[280px] text-xs text-zinc-500">
                    {r.warnings.length > 0 ? r.warnings.join(" ") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>

      <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />

      <div className="flex justify-end">
        <Button onClick={openConfirm} disabled={selectedCount === 0 || batchStatus === "COMPLETED"}>
          {t.policy.importSelectedButton} ({selectedCount})
        </Button>
      </div>

      {showConfirm && (
        <Modal title={t.policy.importSelectedButton} onClose={() => setShowConfirm(false)}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-secondary">{t.policy.importSelectedConfirmDescription}</p>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <SummaryStat label={t.policy.confirmSelectedRows} value={selectedCount} />
              <SummaryStat label={t.policy.confirmEligibleSelectedRows} value={selectedCount - blockedSelectedCount} tone="success" />
              {blockedSelectedCount > 0 && (
                <SummaryStat label={t.policy.confirmBlockedSelectedRows} value={blockedSelectedCount} tone="danger" />
              )}
              <SummaryStat label={t.policy.summaryExistingCustomerMatches} value={selectedRows.filter((r) => r.customerMatchStatus === "MATCHED" || r.customerMatchStatus === "MANUAL").length} />
              <SummaryStat label={t.policy.summaryPossibleDuplicatesAwaiting} value={selectedRows.filter((r) => r.status === "POSSIBLE_DUPLICATE").length} tone="brand" />
              <SummaryStat label={t.policy.summaryUnverifiedInsurer} value={selectedRows.filter((r) => r.insurerBalanceVerification === "UNVERIFIED").length} tone="warning" />
              <SummaryStat label={t.policy.summaryUnverifiedClient} value={selectedRows.filter((r) => r.clientBalanceVerification === "UNVERIFIED").length} tone="warning" />
              <SummaryStat label={t.policy.confirmOtherWarnings} value={selectedRows.filter((r) => r.warnings.length > 0).length} tone="warning" />
              <SummaryStat label={t.policy.confirmFinalPolicies} value={selectedCount - blockedSelectedCount} tone="success" />
            </dl>
            {confirmError && <p className="text-sm text-red-600">{confirmError}</p>}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowConfirm(false)} disabled={confirming}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleImportSelected} disabled={confirming || blockedSelectedCount > 0}>
              {t.policy.importSelectedButton}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
}) {
  const toneClass: Record<string, string> = {
    neutral: "text-zinc-700",
    brand: "text-emerald-700",
    success: "text-emerald-700",
    warning: "text-amber-700",
    danger: "text-red-600",
  };
  return (
    <div>
      <dt className="text-secondary text-xs">{label}</dt>
      <dd className={`text-lg font-semibold ${toneClass[tone]}`}>{value}</dd>
    </div>
  );
}
