"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Download, Eye, GitBranch, GitCompare, Send, CheckCircle2, XCircle } from "lucide-react";
import { SmartBackLink } from "@/components/ui/smart-back-link";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TableWrap, Table } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatMoney } from "@/components/ui/money-input";
import { QuotationDocumentsTab } from "@/components/quotations/quotation-documents-tab";
import { QuotationCaseOverviewTab } from "@/components/quotations/quotation-case-overview-tab";
import {
  createRevisionAction,
  issueRevisionAction,
  acceptRevisionAction,
  cancelRevisionAction,
  compareRevisionsAction,
  type RevisionCompareResult,
} from "@/app/(app)/quotation/revisionActions";
import type { QuotationCaseStatus, RevisionStatus, QuotationDocumentRow } from "@/components/quotations/types";
import { CASE_STATUS_TONE, REVISION_TONE } from "@/components/quotations/statusTones";
import { buildReturnTo } from "@/lib/navigation/returnTo";

type RevisionRow = {
  id: string;
  revisionCode: string;
  revisionNumber: number;
  revisionStatus: RevisionStatus;
  revisionReason: string | null;
  isCurrentRevision: boolean;
  createdAt: string;
  createdByName: string;
  insuranceTypeNames: string[];
  subtotalPremium: string;
  grandTotal: string;
};

type Tab = "overview" | "documents" | "revisions";

export function QuotationCaseView({
  quotationCase,
  revisions,
  documents,
}: {
  quotationCase: {
    id: string;
    quotationNumber: string;
    customerName: string;
    projectName: string | null;
    status: QuotationCaseStatus;
    currentRevisionId: string | null;
    currentRevisionCode: string | null;
    insuranceTypeNames: string[];
    enquiryDate: string | null;
    createdAt: string;
  };
  revisions: RevisionRow[];
  documents: QuotationDocumentRow[];
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const requested = searchParams.get("tab");
    const valid: Tab[] = ["overview", "documents", "revisions"];
    return valid.includes(requested as Tab) ? (requested as Tab) : "overview";
  });

  const handleTabChange = (key: Tab) => {
    setTab(key);
    const params = new URLSearchParams(searchParams.toString());
    if (key === "overview") params.delete("tab");
    else params.set("tab", key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const [showCreateRevision, setShowCreateRevision] = useState(false);
  const [copyFromId, setCopyFromId] = useState(quotationCase.currentRevisionId ?? revisions[0]?.id ?? "");
  const [createReason, setCreateReason] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showCompare, setShowCompare] = useState(false);
  const [compareA, setCompareA] = useState(revisions[1]?.id ?? revisions[0]?.id ?? "");
  const [compareB, setCompareB] = useState(revisions[0]?.id ?? "");
  const [compareResult, setCompareResult] = useState<RevisionCompareResult | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  const [issueTarget, setIssueTarget] = useState<string | null>(null);
  const [acceptTarget, setAcceptTarget] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);

  const revisionErrorLabel: Record<string, string> = {
    DRAFT_ALREADY_EXISTS: t.quotations.draftAlreadyExists,
    CASE_NOT_FOUND: t.quotations.caseNotFoundError,
    REVISION_REASON_REQUIRED: t.quotations.revisionReasonRequiredError,
    REVISION_CREATE_FAILED: t.quotations.revisionCreateFailed,
    REVISION_NOT_FOUND: t.quotations.revisionNotFoundError,
    REVISION_NOT_DRAFT: t.quotations.revisionNotDraftError,
    AT_LEAST_ONE_SECTION: t.quotations.atLeastOneSection,
    ISSUE_FAILED: t.quotations.issueFailedError,
    REVISION_NOT_ISSUED: t.quotations.revisionNotIssuedError,
    ANOTHER_REVISION_ALREADY_ACCEPTED: t.quotations.anotherRevisionAlreadyAcceptedError,
    ACCEPT_FAILED: t.quotations.acceptFailedError,
    REVISION_NOT_CANCELLABLE: t.quotations.revisionNotCancellableError,
    CANCELLATION_REASON_REQUIRED: t.quotations.cancellationReasonRequiredError,
    CANCEL_FAILED: t.quotations.cancelFailedError,
    FORBIDDEN: t.quotations.genericError,
    DIFFERENT_CASES: t.quotations.genericError,
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

  const revisionStatusLabel: Record<RevisionStatus, string> = {
    DRAFT: t.quotations.revisionStatusDraft,
    ISSUED: t.quotations.revisionStatusIssued,
    SUPERSEDED: t.quotations.revisionStatusSuperseded,
    ACCEPTED: t.quotations.revisionStatusAccepted,
    CANCELLED: t.quotations.revisionStatusCancelled,
  };

  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });

  // This case page's own current URL (including whatever returnTo it was
  // reached with), forwarded as the returnTo for the Revisions tab's "view"
  // link — otherwise a revision detail's Back button would strand the user
  // here with no way back to the list this case was originally opened from.
  const revisionViewReturnTo = (() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "revisions");
    return buildReturnTo(pathname, params.toString());
  })();

  const handleCreateRevision = async () => {
    if (!createReason.trim()) {
      setCreateError(t.quotations.revisionReasonRequiredError);
      return;
    }
    setBusy(true);
    setCreateError(null);
    const result = await createRevisionAction(quotationCase.id, copyFromId, createReason);
    setBusy(false);
    if (!result.success) {
      setCreateError(revisionErrorLabel[result.error] ?? t.quotations.revisionCreateFailed);
      return;
    }
    router.push(`/quotation/${result.id}/edit?returnTo=${encodeURIComponent(revisionViewReturnTo)}`);
  };

  const handleCompare = async () => {
    setCompareError(null);
    setCompareResult(null);
    if (!compareA || !compareB || compareA === compareB) return;
    const result = await compareRevisionsAction(compareA, compareB);
    if (!result.success) {
      setCompareError(revisionErrorLabel[result.error] ?? t.quotations.genericError);
      return;
    }
    setCompareResult(result.result);
  };

  const handleIssue = async () => {
    if (!issueTarget) return;
    setBusy(true);
    setRowError(null);
    const result = await issueRevisionAction(issueTarget);
    setBusy(false);
    if (!result.success) {
      setRowError(revisionErrorLabel[result.error] ?? t.quotations.issueFailedError);
      return;
    }
    setIssueTarget(null);
    router.refresh();
  };

  const handleAccept = async () => {
    if (!acceptTarget) return;
    setBusy(true);
    setRowError(null);
    const result = await acceptRevisionAction(acceptTarget);
    setBusy(false);
    if (!result.success) {
      setRowError(revisionErrorLabel[result.error] ?? t.quotations.acceptFailedError);
      return;
    }
    setAcceptTarget(null);
    router.refresh();
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    if (!cancelReason.trim()) {
      setRowError(t.quotations.cancellationReasonRequiredError);
      return;
    }
    setBusy(true);
    setRowError(null);
    const result = await cancelRevisionAction(cancelTarget, cancelReason);
    setBusy(false);
    if (!result.success) {
      setRowError(revisionErrorLabel[result.error] ?? t.quotations.cancelFailedError);
      return;
    }
    setCancelTarget(null);
    setCancelReason("");
    router.refresh();
  };

  const tabButton = (key: Tab, label: string) => (
    <button
      type="button"
      onClick={() => handleTabChange(key)}
      className={`border-b-2 px-1 pb-2 text-sm font-medium transition-colors ${
        tab === key ? "border-emerald-700 text-emerald-800" : "border-transparent text-zinc-500 hover:text-zinc-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-section">
      <div>
        <SmartBackLink fallbackHref="/quotation" label={t.quotations.backToList} />
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2">
              {quotationCase.quotationNumber}
              <Badge tone={CASE_STATUS_TONE[quotationCase.status]}>{caseStatusLabel[quotationCase.status]}</Badge>
            </span>
          }
          description={`${quotationCase.customerName}${quotationCase.projectName ? " · " + quotationCase.projectName : ""}`}
        />
      </div>

      <div className="flex gap-6 border-b border-zinc-200">
        {tabButton("overview", t.quotations.overviewTab)}
        {tabButton("documents", t.quotations.underwritingDocumentsTab)}
        {tabButton("revisions", t.quotations.revisionsTab)}
      </div>

      {tab === "overview" && (
        <QuotationCaseOverviewTab
          quotationCaseId={quotationCase.id}
          quotationNumber={quotationCase.quotationNumber}
          customerName={quotationCase.customerName}
          projectName={quotationCase.projectName}
          insuranceTypeNames={quotationCase.insuranceTypeNames}
          enquiryDate={quotationCase.enquiryDate}
          createdAt={quotationCase.createdAt}
          caseStatus={quotationCase.status}
          caseStatusLabel={caseStatusLabel[quotationCase.status]}
          currentRevisionCode={quotationCase.currentRevisionCode}
        />
      )}

      {tab === "revisions" && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCompare(true)} disabled={revisions.length < 2}>
              <GitCompare size={16} />
              {t.quotations.compareRevisions}
            </Button>
            <Button onClick={() => setShowCreateRevision(true)} disabled={revisions.length === 0} title={revisions.length === 0 ? t.quotations.startFirstQuotationHint : undefined}>
              <GitBranch size={16} />
              {t.quotations.createRevision}
            </Button>
          </div>

          {rowError && <div className="rounded-control border border-red-200 bg-red-50 p-3 text-sm text-red-700">{rowError}</div>}

          {revisions.length === 0 && (
            <div className="rounded-control border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
              {t.quotations.noRevisionsYet}
            </div>
          )}

          {revisions.length > 0 && (
          <TableWrap scroll>
            <Table className="min-w-[1200px]">
              <thead>
                <tr>
                  <th>{t.quotations.revisionColumn}</th>
                  <th>{t.quotations.fullReference}</th>
                  <th>{t.quotations.createdDate}</th>
                  <th>{t.quotations.createdBy}</th>
                  <th>{t.quotations.revisionReason}</th>
                  <th>{t.quotations.insuranceTypesUsed}</th>
                  <th>{t.quotations.premium}</th>
                  <th>{t.quotations.grandTotal}</th>
                  <th>{t.common.status}</th>
                  <th>{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {revisions.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Badge tone="neutral">{r.revisionCode}</Badge>
                      {r.isCurrentRevision && <span className="ml-1 text-xs text-emerald-700">({t.quotations.currentMarker})</span>}
                    </td>
                    <td className="font-medium text-zinc-800">
                      {quotationCase.quotationNumber}-{r.revisionCode}
                    </td>
                    <td className="text-zinc-500">{dateFormatter.format(new Date(r.createdAt))}</td>
                    <td className="text-zinc-500">{r.createdByName}</td>
                    <td className="text-zinc-500">{r.revisionReason || "—"}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {r.insuranceTypeNames.slice(0, 2).map((name, idx) => (
                          <Badge key={`${name}-${idx}`} tone="brand">
                            {name}
                          </Badge>
                        ))}
                        {r.insuranceTypeNames.length > 2 && <Badge tone="neutral">+{r.insuranceTypeNames.length - 2}</Badge>}
                      </div>
                    </td>
                    <td className="text-zinc-500">{formatMoney(r.subtotalPremium)}</td>
                    <td className="font-medium text-zinc-800">{formatMoney(r.grandTotal)}</td>
                    <td>
                      <Badge tone={REVISION_TONE[r.revisionStatus]}>{revisionStatusLabel[r.revisionStatus]}</Badge>
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/quotation/${r.id}?returnTo=${encodeURIComponent(revisionViewReturnTo)}`}>
                          <IconButton title={t.quotations.view}>
                            <Eye size={16} />
                          </IconButton>
                        </Link>
                        <a href={`/api/quotation/${r.id}/excel-template`}>
                          <IconButton title={t.quotations.downloadExcel}>
                            <Download size={16} />
                          </IconButton>
                        </a>
                        {r.revisionStatus === "DRAFT" && (
                          <IconButton title={t.quotations.issueRevision} onClick={() => setIssueTarget(r.id)}>
                            <Send size={16} />
                          </IconButton>
                        )}
                        {r.revisionStatus === "ISSUED" && (
                          <IconButton title={t.quotations.markAccepted} onClick={() => setAcceptTarget(r.id)}>
                            <CheckCircle2 size={16} />
                          </IconButton>
                        )}
                        {(r.revisionStatus === "DRAFT" || r.revisionStatus === "ISSUED") && (
                          <IconButton
                            tone="danger"
                            title={t.quotations.cancelRevision}
                            onClick={() => {
                              setCancelTarget(r.id);
                              setCancelReason("");
                              setRowError(null);
                            }}
                          >
                            <XCircle size={16} />
                          </IconButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          )}
        </div>
      )}

      {tab === "documents" && <QuotationDocumentsTab quotationCaseId={quotationCase.id} documents={documents} />}

      {showCreateRevision && (
        <Modal
          title={t.quotations.createRevisionModalTitle}
          onClose={() => {
            setShowCreateRevision(false);
            setCreateError(null);
          }}
        >
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">{t.quotations.copyFromRevision}</label>
              <Select value={copyFromId} onChange={(e) => setCopyFromId(e.target.value)}>
                {revisions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.revisionCode} {r.isCurrentRevision ? `(${t.quotations.currentMarker})` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">{t.quotations.revisionReason}</label>
              <Textarea
                value={createReason}
                onChange={(e) => setCreateReason(e.target.value)}
                placeholder={t.quotations.revisionReasonPlaceholder}
                rows={3}
              />
            </div>
            {createError && <p className="text-sm text-red-600">{createError}</p>}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowCreateRevision(false)} disabled={busy}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleCreateRevision} disabled={busy || !copyFromId || !createReason.trim()}>
              {t.quotations.createRevisionConfirm}
            </Button>
          </div>
        </Modal>
      )}

      {showCompare && (
        <Modal
          title={t.quotations.compareRevisionsTitle}
          onClose={() => {
            setShowCompare(false);
            setCompareResult(null);
            setCompareError(null);
          }}
        >
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">{t.quotations.compareSelectFirst}</label>
                <Select value={compareA} onChange={(e) => setCompareA(e.target.value)}>
                  {revisions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.revisionCode}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-700">{t.quotations.compareSelectSecond}</label>
                <Select value={compareB} onChange={(e) => setCompareB(e.target.value)}>
                  {revisions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.revisionCode}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={handleCompare} disabled={compareA === compareB}>
                {t.quotations.compareRevisions}
              </Button>
            </div>
            {compareError && <p className="text-sm text-red-600">{compareError}</p>}

            {compareResult && (
              <div className="flex flex-col gap-3">
                <TableWrap scroll>
                  <Table className="min-w-[520px]">
                    <thead>
                      <tr>
                        <th>{t.quotations.compareInsuranceType}</th>
                        <th>{compareResult.a.revisionCode}</th>
                        <th>{compareResult.b.revisionCode}</th>
                        <th>{t.quotations.compareDifference}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareResult.byType.map((row) => {
                        const aVal = row.aTotal ? Number(row.aTotal) : 0;
                        const bVal = row.bTotal ? Number(row.bTotal) : 0;
                        return (
                          <tr key={row.insuranceType}>
                            <td className="font-medium text-zinc-800">{row.insuranceType}</td>
                            <td className="text-zinc-500">{row.aTotal ? formatMoney(row.aTotal) : "—"}</td>
                            <td className="text-zinc-500">{row.bTotal ? formatMoney(row.bTotal) : "—"}</td>
                            <td className={bVal - aVal === 0 ? "text-zinc-500" : bVal - aVal > 0 ? "text-red-600" : "text-emerald-700"}>
                              {formatMoney((bVal - aVal).toFixed(2))}
                            </td>
                          </tr>
                        );
                      })}
                      <tr>
                        <td className="font-semibold text-zinc-800">{t.quotations.compareGrandTotal}</td>
                        <td className="font-semibold text-zinc-800">{formatMoney(compareResult.a.grandTotal)}</td>
                        <td className="font-semibold text-zinc-800">{formatMoney(compareResult.b.grandTotal)}</td>
                        <td className="font-semibold">{formatMoney(compareResult.grandTotalDifference)}</td>
                      </tr>
                    </tbody>
                  </Table>
                </TableWrap>

                {compareResult.addedTypes.length === 0 && compareResult.removedTypes.length === 0 ? (
                  <p className="text-secondary text-sm">{t.quotations.compareNoChange}</p>
                ) : (
                  <div className="text-sm">
                    {compareResult.addedTypes.length > 0 && (
                      <p className="text-emerald-700">
                        {t.quotations.compareAddedTypes}: {compareResult.addedTypes.join(", ")}
                      </p>
                    )}
                    {compareResult.removedTypes.length > 0 && (
                      <p className="text-red-600">
                        {t.quotations.compareRemovedTypes}: {compareResult.removedTypes.join(", ")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {issueTarget && (
        <ConfirmDialog
          title={t.quotations.issueRevisionConfirmTitle}
          message={rowError ?? t.quotations.issueRevisionConfirmMessage}
          isSubmitting={busy}
          onConfirm={handleIssue}
          onClose={() => {
            setIssueTarget(null);
            setRowError(null);
          }}
        />
      )}

      {acceptTarget && (
        <ConfirmDialog
          title={t.quotations.acceptRevisionConfirmTitle}
          message={rowError ?? t.quotations.acceptRevisionConfirmMessage}
          isSubmitting={busy}
          onConfirm={handleAccept}
          onClose={() => {
            setAcceptTarget(null);
            setRowError(null);
          }}
        />
      )}

      {cancelTarget && (
        <Modal
          title={t.quotations.cancelRevisionConfirmTitle}
          onClose={() => {
            setCancelTarget(null);
            setRowError(null);
          }}
        >
          <label className="mb-1 block text-sm font-medium text-zinc-700">{t.quotations.cancellationReason}</label>
          <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} />
          {rowError && <p className="mt-2 text-sm text-red-600">{rowError}</p>}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCancelTarget(null)} disabled={busy}>
              {t.common.cancel}
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={busy || !cancelReason.trim()}>
              {t.quotations.cancelRevision}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
