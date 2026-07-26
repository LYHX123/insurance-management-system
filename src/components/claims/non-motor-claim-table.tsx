"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Eye, XCircle, RotateCcw, Trash2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { SearchBar } from "@/components/ui/search-bar";
import { Badge } from "@/components/ui/badge";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { closeNonMotorClaimAction, reopenNonMotorClaimAction, deleteNonMotorClaimAction } from "@/app/(app)/task/non-motor-claim/actions";
import { NonMotorClaimFormModal } from "@/components/claims/non-motor-claim-form-modal";
import { NON_MOTOR_CLAIM_PROGRESS_VALUES, NON_MOTOR_CLAIM_PROGRESS_TONE } from "@/lib/claims/enums";
import { NON_MOTOR_COVER_TYPES } from "@/lib/policy/nonMotorCoverTypes";
import type { NonMotorClaimRow, ClaimCustomerOption, ActiveUserOption, ClaimStatusValue, NonMotorClaimProgressValue } from "@/components/claims/types";
import type { NonMotorCoverType } from "@/lib/policy/nonMotorCoverTypes";

const PAGE_SIZE = 25;

type ConfirmKind = "close" | "reopen" | "delete";

export function NonMotorClaimTable({
  claims,
  customers,
  insurers,
  currentUserId,
  activeUsers,
}: {
  claims: NonMotorClaimRow[];
  customers: ClaimCustomerOption[];
  insurers: string[];
  currentUserId: string;
  activeUsers: ActiveUserOption[];
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("ALL");
  const [insurerFilter, setInsurerFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState<"ALL" | NonMotorCoverType>("ALL");
  const [progressFilter, setProgressFilter] = useState<"ALL" | NonMotorClaimProgressValue>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | ClaimStatusValue>("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const [showCreate, setShowCreate] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ kind: ConfirmKind; claim: NonMotorClaimRow } | null>(null);
  const [isConfirmBusy, setIsConfirmBusy] = useState(false);

  const coverTypeLabel: Record<NonMotorCoverType, string> = useMemo(
    () => ({
      CONTRACTORS_ALL_RISKS: t.policy.coverContractorsAllRisks,
      WIBA: t.policy.coverWiba,
      EMPLOYERS_LIABILITY: t.policy.coverEmployersLiability,
      CONTRACTORS_PLANT_MACHINERY: t.policy.coverContractorsPlantMachinery,
      PUBLIC_LIABILITY: t.policy.coverPublicLiability,
      FIRE_ALLIED_PERILS: t.policy.coverFireAlliedPerils,
      BURGLARY: t.policy.coverBurglary,
      GOODS_IN_TRANSIT_SINGLE: t.policy.coverGoodsInTransitSingle,
      GOODS_IN_TRANSIT_ANNUAL: t.policy.coverGoodsInTransitAnnual,
      MARINE: t.policy.coverMarine,
      GROUP_PERSONAL_ACCIDENT: t.policy.coverGroupPersonalAccident,
      GROUP_MEDICAL: t.policy.coverGroupMedical,
    }),
    [t]
  );
  const progressLabel: Record<NonMotorClaimProgressValue, string> = {
    DOCUMENT_PREPARATION: t.claims.progressDocumentPreparation,
    LOSS_ASSESSMENT_INVESTIGATION: t.claims.progressLossAssessmentInvestigation,
    APPROVAL: t.claims.progressApproval,
    DV_ISSUED: t.claims.progressDvIssued,
    PAYMENT: t.claims.progressPayment,
    FINISH: t.claims.progressFinish,
  };
  const statusLabel: Record<ClaimStatusValue, string> = { OPEN: t.claims.open, CLOSED: t.claims.closed };

  const customerOptions = useMemo(() => Array.from(new Set(claims.map((c) => c.customerName))).sort(), [claims]);
  const insurerOptions = useMemo(() => Array.from(new Set(claims.map((c) => c.insurer))).sort(), [claims]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return claims.filter((c) => {
      const matchesTerm =
        !term ||
        c.claimNumber.toLowerCase().includes(term) ||
        c.customerName.toLowerCase().includes(term) ||
        (c.projectName?.toLowerCase().includes(term) ?? false) ||
        c.contactName.toLowerCase().includes(term) ||
        c.contactPhone.toLowerCase().includes(term) ||
        c.insurer.toLowerCase().includes(term) ||
        c.participantNames.some((n) => n.toLowerCase().includes(term)) ||
        coverTypeLabel[c.insuranceType].toLowerCase().includes(term);
      const matchesCustomer = customerFilter === "ALL" || c.customerName === customerFilter;
      const matchesInsurer = insurerFilter === "ALL" || c.insurer === insurerFilter;
      const matchesType = typeFilter === "ALL" || c.insuranceType === typeFilter;
      const matchesProgress = progressFilter === "ALL" || c.progress === progressFilter;
      const matchesStatus = statusFilter === "ALL" || c.status === statusFilter;
      const dateOnly = c.reportedAt.slice(0, 10);
      const matchesFrom = !dateFrom || dateOnly >= dateFrom;
      const matchesTo = !dateTo || dateOnly <= dateTo;
      return matchesTerm && matchesCustomer && matchesInsurer && matchesType && matchesProgress && matchesStatus && matchesFrom && matchesTo;
    });
  }, [claims, search, customerFilter, insurerFilter, typeFilter, progressFilter, statusFilter, dateFrom, dateTo, coverTypeLabel]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const resetToFirstPage = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const handleConfirm = async () => {
    if (!confirmAction) return;
    setIsConfirmBusy(true);
    const { kind, claim } = confirmAction;
    if (kind === "close") await closeNonMotorClaimAction(claim.id);
    else if (kind === "reopen") await reopenNonMotorClaimAction(claim.id);
    else await deleteNonMotorClaimAction(claim.id);
    setIsConfirmBusy(false);
    setConfirmAction(null);
    router.refresh();
  };

  const confirmTitle: Record<ConfirmKind, string> = {
    close: t.claims.confirmCloseTitle,
    reopen: t.claims.confirmReopenTitle,
    delete: t.claims.confirmDeleteTitle,
  };
  const confirmMessage: Record<ConfirmKind, string> = {
    close: t.claims.confirmCloseMessage,
    reopen: t.claims.confirmReopenMessage,
    delete: t.claims.confirmDeleteMessage,
  };

  return (
    <div className="flex flex-col gap-section">
      <PageHeader
        title={t.task.tabNonMotorClaim}
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={16} />
            {t.claims.createClaim}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar value={search} onChange={resetToFirstPage(setSearch)} placeholder={t.claims.searchPlaceholderNonMotor} className="w-full max-w-sm" />
        <Select value={customerFilter} onChange={(e) => resetToFirstPage(setCustomerFilter)(e.target.value)} className="w-auto max-w-[200px]">
          <option value="ALL">{t.claims.allCustomers}</option>
          {customerOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <Select value={insurerFilter} onChange={(e) => resetToFirstPage(setInsurerFilter)(e.target.value)} className="w-auto max-w-[180px]">
          <option value="ALL">{t.claims.allInsurers}</option>
          {insurerOptions.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </Select>
        <Select value={typeFilter} onChange={(e) => resetToFirstPage(setTypeFilter)(e.target.value as typeof typeFilter)} className="w-auto max-w-[210px]">
          <option value="ALL">{t.claims.allInsuranceTypes}</option>
          {NON_MOTOR_COVER_TYPES.map((c) => (
            <option key={c} value={c}>{coverTypeLabel[c]}</option>
          ))}
        </Select>
        <Select value={progressFilter} onChange={(e) => resetToFirstPage(setProgressFilter)(e.target.value as typeof progressFilter)} className="w-auto max-w-[210px]">
          <option value="ALL">{t.claims.allProgress}</option>
          {NON_MOTOR_CLAIM_PROGRESS_VALUES.map((p) => (
            <option key={p} value={p}>{progressLabel[p]}</option>
          ))}
        </Select>
        <Select value={statusFilter} onChange={(e) => resetToFirstPage(setStatusFilter)(e.target.value as typeof statusFilter)} className="w-auto max-w-[160px]">
          <option value="ALL">{t.claims.allClaimStatuses}</option>
          <option value="OPEN">{t.claims.open}</option>
          <option value="CLOSED">{t.claims.closed}</option>
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-secondary">
          {t.claims.dateFrom}
          <Input type="date" value={dateFrom} onChange={(e) => resetToFirstPage(setDateFrom)(e.target.value)} className="w-auto" />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-secondary">
          {t.claims.dateTo}
          <Input type="date" value={dateTo} onChange={(e) => resetToFirstPage(setDateTo)(e.target.value)} className="w-auto" />
        </label>
      </div>

      <TableWrap scroll>
        <Table className="min-w-[1150px]">
          <thead>
            <tr>
              <th>{t.claims.reportedTime}</th>
              <th>{t.claims.customer}</th>
              <th>{t.claims.insuranceType}</th>
              <th>{t.claims.insurer}</th>
              <th>{t.claims.progress}</th>
              <th>{t.claims.lastUpdated}</th>
              <th>{t.common.status}</th>
              <th>{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && <TableEmpty colSpan={8}>{t.claims.noClaimsFound}</TableEmpty>}
            {pageRows.map((c) => {
              const isClosed = c.status === "CLOSED";
              return (
                <tr key={c.id} className={isClosed ? "opacity-60" : ""}>
                  <td className="text-zinc-500">{dateFormatter.format(new Date(c.reportedAt))}</td>
                  <td className={isClosed ? "text-zinc-500" : "font-medium text-zinc-800"}>{c.customerName}</td>
                  <td className="text-zinc-500">{coverTypeLabel[c.insuranceType]}</td>
                  <td className="text-zinc-500">{c.insurer}</td>
                  <td>
                    <Badge tone={NON_MOTOR_CLAIM_PROGRESS_TONE[c.progress]}>{progressLabel[c.progress]}</Badge>
                  </td>
                  <td className="text-zinc-500">{dateFormatter.format(new Date(c.updatedAt))}</td>
                  <td>
                    <Badge tone={isClosed ? "neutral" : "brand"}>{statusLabel[c.status]}</Badge>
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <Link href={`/task/non-motor-claim/${c.id}`}>
                        <IconButton title={t.claims.view}>
                          <Eye size={16} />
                        </IconButton>
                      </Link>
                      {!isClosed && (
                        <IconButton title={t.claims.closeClaim} onClick={() => setConfirmAction({ kind: "close", claim: c })}>
                          <XCircle size={16} />
                        </IconButton>
                      )}
                      {isClosed && (
                        <IconButton title={t.claims.reopenClaim} onClick={() => setConfirmAction({ kind: "reopen", claim: c })}>
                          <RotateCcw size={16} />
                        </IconButton>
                      )}
                      <IconButton title={t.claims.deleteClaim} onClick={() => setConfirmAction({ kind: "delete", claim: c })}>
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>

      <Pagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />

      {showCreate && (
        <NonMotorClaimFormModal
          categorySlug="non-motor-claim"
          customers={customers}
          insurers={insurers}
          currentUserId={currentUserId}
          activeUsers={activeUsers}
          onClose={() => setShowCreate(false)}
        />
      )}

      {confirmAction && (
        <ConfirmDialog
          title={confirmTitle[confirmAction.kind]}
          message={confirmMessage[confirmAction.kind]}
          isSubmitting={isConfirmBusy}
          onConfirm={handleConfirm}
          onClose={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
