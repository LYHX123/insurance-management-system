"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Settings, Download, Pencil, X } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { SearchBar } from "@/components/ui/search-bar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatMoney } from "@/components/ui/money-input";
import { cancelManualEntryAction } from "@/app/(app)/ledger/actions";
import { ManualEntryModal } from "@/components/ledger/manual-entry-modal";
import { ManageCategoriesModal } from "@/components/ledger/manage-categories-modal";
import { useUrlListState } from "@/lib/navigation/useUrlListState";
import type { ManualEntryRow, LedgerCategoryOption, LedgerTransactionType } from "@/components/ledger/types";

// Ledger has no customerId server-filter / "View All" deep-link concept
// (unlike Policy/Invoice/Quotation) — this is a pure client-side filter set,
// URL-persisted so a returnTo/back-navigation restores it (Phase 8.1).
const MANUAL_LEDGER_LIST_DEFAULTS = {
  search: "",
  type: "ALL",
  categoryId: "ALL",
  createdById: "ALL",
  dateFrom: "",
  dateTo: "",
  page: "1",
};

const TYPE_TONE: Record<LedgerTransactionType, "success" | "danger"> = {
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

export function ManualLedgerTable({
  records,
  categories,
  canEdit,
}: {
  records: ManualEntryRow[];
  categories: LedgerCategoryOption[];
  canEdit: boolean;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });

  const [listState, setListState] = useUrlListState(MANUAL_LEDGER_LIST_DEFAULTS);
  const {
    search,
    type: typeFilter,
    categoryId: categoryFilter,
    createdById: createdByFilter,
    dateFrom,
    dateTo,
  } = listState;
  const page = Math.max(1, Number(listState.page) || 1);

  const [newEntryType, setNewEntryType] = useState<LedgerTransactionType | null>(null);
  const [editingEntry, setEditingEntry] = useState<ManualEntryRow | null>(null);
  const [showCategories, setShowCategories] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const typeLabel: Record<LedgerTransactionType, string> = {
    INCOME: t.ledger.income,
    EXPENSE: t.ledger.expense,
  };

  const creators = useMemo(
    () => Array.from(new Map(records.map((r) => [r.createdById, r.createdByName])).entries()),
    [records]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return records.filter((r) => {
      const matchesTerm =
        !term ||
        r.categoryName.toLowerCase().includes(term) ||
        (r.description?.toLowerCase().includes(term) ?? false) ||
        (r.referenceNumber?.toLowerCase().includes(term) ?? false) ||
        (r.paymentMethod?.toLowerCase().includes(term) ?? false);
      const matchesType = typeFilter === "ALL" || r.transactionType === typeFilter;
      const matchesCategory = categoryFilter === "ALL" || r.categoryId === categoryFilter;
      const matchesCreatedBy = createdByFilter === "ALL" || r.createdById === createdByFilter;
      const dateOnly = r.transactionDate.slice(0, 10);
      const matchesFrom = !dateFrom || dateOnly >= dateFrom;
      const matchesTo = !dateTo || dateOnly <= dateTo;
      return matchesTerm && matchesType && matchesCategory && matchesCreatedBy && matchesFrom && matchesTo;
    });
  }, [records, search, typeFilter, categoryFilter, createdByFilter, dateFrom, dateTo]);

  const summary = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const r of filtered) {
      if (r.transactionType === "INCOME") income += Number(r.amount);
      else expense += Number(r.amount);
    }
    return { income, expense, net: income - expense };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleCancel = async () => {
    if (!cancellingId) return;
    setIsCancelling(true);
    await cancelManualEntryAction(cancellingId);
    setIsCancelling(false);
    setCancellingId(null);
    router.refresh();
  };

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (typeFilter !== "ALL") params.set("type", typeFilter);
    if (categoryFilter !== "ALL") params.set("categoryId", categoryFilter);
    if (createdByFilter !== "ALL") params.set("createdById", createdByFilter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return `/api/ledger/manual/export?${params.toString()}`;
  }, [search, typeFilter, categoryFilter, createdByFilter, dateFrom, dateTo]);

  return (
    <div className="flex flex-col gap-section">
      <PageHeader
        title={t.ledger.tabManual}
        actions={
          <>
            {canEdit && (
              <Button variant="secondary" onClick={() => setShowCategories(true)}>
                <Settings size={16} />
                {t.ledger.manageCategories}
              </Button>
            )}
            <a href={exportUrl}>
              <Button variant="secondary">
                <Download size={16} />
                {t.ledger.exportExcel}
              </Button>
            </a>
            {canEdit && (
              <>
                <Button onClick={() => setNewEntryType("INCOME")}>
                  <Plus size={16} />
                  {t.ledger.newIncome}
                </Button>
                <Button variant="secondary" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setNewEntryType("EXPENSE")}>
                  <Plus size={16} />
                  {t.ledger.newExpense}
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryStat label={t.ledger.manualIncome} value={formatMoney(summary.income.toFixed(2))} tone="success" />
        <SummaryStat label={t.ledger.manualExpense} value={formatMoney(summary.expense.toFixed(2))} tone="danger" />
        <SummaryStat label={t.ledger.manualNet} value={formatMoney(summary.net.toFixed(2))} tone={summary.net >= 0 ? "success" : "danger"} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(value) => setListState({ search: value, page: "1" })}
          placeholder={t.ledger.searchPlaceholderManual}
          className="w-full max-w-sm"
        />
        <Select
          value={typeFilter}
          onChange={(e) => setListState({ type: e.target.value, page: "1" }, { immediate: true })}
          className="w-auto max-w-[160px]"
        >
          <option value="ALL">{t.ledger.allTypes}</option>
          <option value="INCOME">{t.ledger.income}</option>
          <option value="EXPENSE">{t.ledger.expense}</option>
        </Select>
        <Select
          value={categoryFilter}
          onChange={(e) => setListState({ categoryId: e.target.value, page: "1" }, { immediate: true })}
          className="w-auto max-w-[200px]"
        >
          <option value="ALL">{t.ledger.allCategories}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({typeLabel[c.transactionType]}){!c.isActive ? ` — ${t.ledger.inactive}` : ""}
            </option>
          ))}
        </Select>
        {creators.length > 1 && (
          <Select
            value={createdByFilter}
            onChange={(e) => setListState({ createdById: e.target.value, page: "1" }, { immediate: true })}
            className="w-auto max-w-[180px]"
          >
            <option value="ALL">{t.ledger.allCreators}</option>
            {creators.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </Select>
        )}
        <label className="flex items-center gap-1.5 text-sm text-secondary">
          {t.ledger.dateFrom}
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setListState({ dateFrom: e.target.value, page: "1" }, { immediate: true })}
            className="w-auto"
          />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-secondary">
          {t.ledger.dateTo}
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setListState({ dateTo: e.target.value, page: "1" }, { immediate: true })}
            className="w-auto"
          />
        </label>
      </div>

      <TableWrap scroll>
        <Table className="min-w-[1100px]">
          <thead>
            <tr>
              <th>{t.ledger.date}</th>
              <th>{t.ledger.type}</th>
              <th>{t.ledger.category}</th>
              <th>{t.ledger.description}</th>
              <th>{t.ledger.paymentMethod}</th>
              <th>{t.ledger.referenceNumber}</th>
              <th>{t.ledger.amount}</th>
              <th>{t.ledger.createdBy}</th>
              <th>{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && <TableEmpty colSpan={9}>{t.ledger.noManualRecords}</TableEmpty>}
            {pageRows.map((r) => (
              <tr key={r.id}>
                <td className="text-zinc-500">{dateFormatter.format(new Date(r.transactionDate))}</td>
                <td>
                  <Badge tone={TYPE_TONE[r.transactionType]}>{typeLabel[r.transactionType]}</Badge>
                </td>
                <td>
                  {r.categoryName}
                  {!r.categoryIsActive && <span className="ml-1 text-xs text-zinc-400">({t.ledger.inactive})</span>}
                </td>
                <td className="text-zinc-500">{r.description || "—"}</td>
                <td className="text-zinc-500">{r.paymentMethod || "—"}</td>
                <td className="text-zinc-500">{r.referenceNumber || "—"}</td>
                <td className={r.transactionType === "INCOME" ? "font-medium text-emerald-700" : "font-medium text-red-600"}>
                  {formatMoney(r.amount)}
                </td>
                <td className="text-zinc-500">{r.createdByName}</td>
                <td>
                  <div className="flex items-center justify-end gap-1.5">
                    {canEdit && (
                      <>
                        <IconButton title={t.common.edit} onClick={() => setEditingEntry(r)}>
                          <Pencil size={16} />
                        </IconButton>
                        <IconButton title={t.ledger.cancelManualRecord} onClick={() => setCancellingId(r.id)}>
                          <X size={16} />
                        </IconButton>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      <Pagination page={currentPage} totalPages={totalPages} onPageChange={(p) => setListState({ page: String(p) }, { immediate: true })} />

      {(newEntryType || editingEntry) && (
        <ManualEntryModal
          categories={categories}
          entry={editingEntry}
          fixedType={editingEntry?.transactionType ?? newEntryType!}
          onClose={() => {
            setNewEntryType(null);
            setEditingEntry(null);
          }}
          onSuccess={() => {
            setNewEntryType(null);
            setEditingEntry(null);
            router.refresh();
          }}
        />
      )}

      {showCategories && (
        <ManageCategoriesModal
          categories={categories}
          onClose={() => setShowCategories(false)}
          onChanged={() => router.refresh()}
        />
      )}

      {cancellingId && (
        <ConfirmDialog
          title={t.ledger.cancelManualRecordConfirmTitle}
          message={t.ledger.cancelManualRecordConfirmMessage}
          isSubmitting={isCancelling}
          onConfirm={handleCancel}
          onClose={() => setCancellingId(null)}
        />
      )}
    </div>
  );
}
