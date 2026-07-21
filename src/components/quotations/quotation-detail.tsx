"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Download, Trash2, GitBranch, Send, CheckCircle2, XCircle } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { TableWrap, Table } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatMoney } from "@/components/ui/money-input";
import { deleteQuotationAction } from "@/app/(app)/quotation/actions";
import {
  createRevisionAction,
  issueRevisionAction,
  acceptRevisionAction,
  cancelRevisionAction,
  deleteDraftRevisionAction,
} from "@/app/(app)/quotation/revisionActions";
import type { QuotationDetail, RevisionStatus, QuotationCaseStatus } from "@/components/quotations/types";
import { REVISION_TONE, CASE_STATUS_TONE } from "@/components/quotations/statusTones";

function ReasonModal({
  title,
  label,
  confirmLabel,
  isSubmitting,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  label: string;
  confirmLabel: string;
  isSubmitting: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [reason, setReason] = useState("");

  return (
    <Modal title={title} onClose={onClose}>
      <label className="mb-1 block text-sm font-medium text-zinc-700">{label}</label>
      <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
          {t.common.cancel}
        </Button>
        <Button onClick={() => onConfirm(reason)} disabled={isSubmitting || !reason.trim()}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function QuotationDetailView({
  quotation,
  embedded = false,
  caseStatus = null,
}: {
  quotation: QuotationDetail;
  /** True when rendered inside the QuotationCase page's "Quotation Details"
   * tab, which already renders its own back-link/title/customer-name
   * header — suppresses this component's own copy of the same, showing
   * only a compact revision badge + action row instead. Business logic
   * (state, handlers, visibility rules) is identical either way; only the
   * surrounding layout changes. */
  embedded?: boolean;
  /** The owning QuotationCase's own status, shown alongside (never instead
   * of) this revision's own RevisionStatus — see statusTones.ts's doc
   * comment on why these must never be conflated. */
  caseStatus?: QuotationCaseStatus | null;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [showCreateRevision, setShowCreateRevision] = useState(false);
  const [showCancelRevision, setShowCancelRevision] = useState(false);
  const [confirmingIssue, setConfirmingIssue] = useState(false);
  const [confirmingAccept, setConfirmingAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const revisionStatus = quotation.revisionStatus ?? null;
  const isLocked = revisionStatus !== null && revisionStatus !== "DRAFT";
  const hasRevisionInfo = !!quotation.quotationCaseId;

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
    ONLY_DRAFT_DELETABLE: t.quotations.onlyDraftDeletableError,
    DELETE_FAILED: t.quotations.deleteRevisionFailedError,
    FORBIDDEN: t.quotations.genericError,
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    const result = hasRevisionInfo
      ? await deleteDraftRevisionAction(quotation.id)
      : await deleteQuotationAction(quotation.id);
    setIsDeleting(false);
    if (!result.success) {
      setDeleteError(revisionErrorLabel[result.error] ?? t.quotations.deleteQuotationFailed);
      return;
    }
    router.push("/quotation");
  };

  const handleCreateRevision = async (reason: string) => {
    if (!quotation.quotationCaseId) return;
    setBusy(true);
    setActionError(null);
    const result = await createRevisionAction(quotation.quotationCaseId, quotation.id, reason);
    setBusy(false);
    if (!result.success) {
      setActionError(revisionErrorLabel[result.error] ?? t.quotations.revisionCreateFailed);
      return;
    }
    setShowCreateRevision(false);
    router.push(`/quotation/${result.id}/edit`);
  };

  const handleIssue = async () => {
    setBusy(true);
    setActionError(null);
    const result = await issueRevisionAction(quotation.id);
    setBusy(false);
    if (!result.success) {
      setActionError(revisionErrorLabel[result.error] ?? t.quotations.issueFailedError);
      return;
    }
    setConfirmingIssue(false);
    router.refresh();
  };

  const handleAccept = async () => {
    setBusy(true);
    setActionError(null);
    const result = await acceptRevisionAction(quotation.id);
    setBusy(false);
    if (!result.success) {
      setActionError(revisionErrorLabel[result.error] ?? t.quotations.acceptFailedError);
      return;
    }
    setConfirmingAccept(false);
    router.refresh();
  };

  const handleCancel = async (reason: string) => {
    setBusy(true);
    setActionError(null);
    const result = await cancelRevisionAction(quotation.id, reason);
    setBusy(false);
    if (!result.success) {
      setActionError(revisionErrorLabel[result.error] ?? t.quotations.cancelFailedError);
      return;
    }
    setShowCancelRevision(false);
    router.refresh();
  };

  const revisionStatusLabel: Record<RevisionStatus, string> = {
    DRAFT: t.quotations.revisionStatusDraft,
    ISSUED: t.quotations.revisionStatusIssued,
    SUPERSEDED: t.quotations.revisionStatusSuperseded,
    ACCEPTED: t.quotations.revisionStatusAccepted,
    CANCELLED: t.quotations.revisionStatusCancelled,
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

  const calculationMethodLabel: Record<string, string> = {
    PERCENTAGE: t.quotations.percentage,
    FIXED_PREMIUM: t.quotations.fixedPremium,
    MANUAL_PREMIUM: t.quotations.manualPremium,
  };

  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });
  const dateTimeFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const money = formatMoney;

  // Single definition of every action button + its visibility rule, reused
  // by both the standalone full header and the embedded compact header
  // below — only the surrounding layout differs, never this logic.
  //   DRAFT:      Edit, Download, Issue, Cancel, Delete (if eligible) — no Create Revision (you're already on the case's draft)
  //   ISSUED:     Download, Create Revision, Mark Accepted, Cancel — no Edit, no Issue
  //   SUPERSEDED: Download, Create Revision only
  //   ACCEPTED:   Download, Create Revision only
  //   CANCELLED:  Download, Create Revision only
  const actionButtons = (
    <>
      <a href={`/api/quotation/${quotation.id}/excel-template`}>
        <Button variant="primary">
          <Download size={16} />
          {t.quotations.downloadExcel}
        </Button>
      </a>

      {!isLocked && (
        <Link href={`/quotation/${quotation.id}/edit`}>
          <Button variant="secondary">
            <Pencil size={16} />
            {t.common.edit}
          </Button>
        </Link>
      )}

      {hasRevisionInfo && isLocked && (
        <Button variant="secondary" onClick={() => setShowCreateRevision(true)}>
          <GitBranch size={16} />
          {t.quotations.createRevisionFromThisVersion}
        </Button>
      )}

      {revisionStatus === "DRAFT" && (
        <Button variant="primary" onClick={() => setConfirmingIssue(true)}>
          <Send size={16} />
          {t.quotations.issueRevision}
        </Button>
      )}
      {revisionStatus === "ISSUED" && (
        <Button variant="primary" onClick={() => setConfirmingAccept(true)}>
          <CheckCircle2 size={16} />
          {t.quotations.markAccepted}
        </Button>
      )}
      {(revisionStatus === "DRAFT" || revisionStatus === "ISSUED") && (
        <Button variant="secondary" onClick={() => setShowCancelRevision(true)}>
          <XCircle size={16} />
          {t.quotations.cancelRevision}
        </Button>
      )}

      {(!hasRevisionInfo || revisionStatus === "DRAFT") && (
        <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>
          <Trash2 size={16} />
          {t.common.delete}
        </Button>
      )}
    </>
  );

  const revisionBadges = (
    <span className="inline-flex items-center gap-2">
      {quotation.revisionCode && <Badge tone="neutral">{quotation.revisionCode}</Badge>}
      {revisionStatus && <Badge tone={REVISION_TONE[revisionStatus]}>{revisionStatusLabel[revisionStatus]}</Badge>}
    </span>
  );

  return (
    <div className="flex flex-col gap-section">
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {revisionBadges}
          <div className="flex flex-wrap items-center gap-2">{actionButtons}</div>
        </div>
      ) : (
        <div>
          <Link
            href="/quotation"
            className="mb-2 inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline"
          >
            <ArrowLeft size={14} />
            {t.quotations.backToList}
          </Link>
          <PageHeader
            title={
              <span className="inline-flex items-center gap-2">
                {quotation.quotationNumber}
                {revisionBadges}
              </span>
            }
            description={quotation.customerName}
            actions={actionButtons}
          />
        </div>
      )}

      {isLocked && (
        <div className="rounded-control border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t.quotations.revisionLocked}
        </div>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title={t.quotations.confirmDeleteQuotation}
          message={
            deleteError ??
            t.quotations.confirmDeleteQuotationMessage.replace("{number}", quotation.quotationNumber)
          }
          isSubmitting={isDeleting}
          onConfirm={handleDelete}
          onClose={() => setConfirmingDelete(false)}
        />
      )}

      {showCreateRevision && (
        <ReasonModal
          title={t.quotations.createRevisionModalTitle}
          label={t.quotations.revisionReason}
          confirmLabel={t.quotations.createRevisionConfirm}
          isSubmitting={busy}
          error={actionError}
          onConfirm={handleCreateRevision}
          onClose={() => {
            setShowCreateRevision(false);
            setActionError(null);
          }}
        />
      )}

      {showCancelRevision && (
        <ReasonModal
          title={t.quotations.cancelRevisionConfirmTitle}
          label={t.quotations.cancellationReason}
          confirmLabel={t.quotations.cancelRevision}
          isSubmitting={busy}
          error={actionError}
          onConfirm={handleCancel}
          onClose={() => {
            setShowCancelRevision(false);
            setActionError(null);
          }}
        />
      )}

      {confirmingIssue && (
        <ConfirmDialog
          title={t.quotations.issueRevisionConfirmTitle}
          message={actionError ?? t.quotations.issueRevisionConfirmMessage}
          isSubmitting={busy}
          onConfirm={handleIssue}
          onClose={() => {
            setConfirmingIssue(false);
            setActionError(null);
          }}
        />
      )}

      {confirmingAccept && (
        <ConfirmDialog
          title={t.quotations.acceptRevisionConfirmTitle}
          message={actionError ?? t.quotations.acceptRevisionConfirmMessage}
          isSubmitting={busy}
          onConfirm={handleAccept}
          onClose={() => {
            setConfirmingAccept(false);
            setActionError(null);
          }}
        />
      )}

      <Card>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-secondary">{t.quotations.customer}</dt>
            <dd className="text-body font-medium">{quotation.customerName}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.quotations.project}</dt>
            <dd className="text-body">{quotation.projectName || "—"}</dd>
          </div>
          {revisionStatus && (
            <div>
              <dt className="text-secondary">{t.quotations.revisionStatusLabel}</dt>
              <dd>
                <Badge tone={REVISION_TONE[revisionStatus]}>{revisionStatusLabel[revisionStatus]}</Badge>
              </dd>
            </div>
          )}
          {caseStatus && (
            <div>
              <dt className="text-secondary">{t.quotations.caseStatusLabel}</dt>
              <dd>
                <Badge tone={CASE_STATUS_TONE[caseStatus]}>{caseStatusLabel[caseStatus]}</Badge>
              </dd>
            </div>
          )}
          <div>
            <dt className="text-secondary">{t.quotations.quotationDate}</dt>
            <dd className="text-body">{dateFormatter.format(new Date(quotation.quotationDate))}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.quotations.validUntil}</dt>
            <dd className="text-body">
              {quotation.validUntil ? dateFormatter.format(new Date(quotation.validUntil)) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-secondary">{t.quotations.currency}</dt>
            <dd className="text-body">{quotation.currency}</dd>
          </div>
          {quotation.revisionReason && (
            <div>
              <dt className="text-secondary">{t.quotations.revisionReason}</dt>
              <dd className="text-body">{quotation.revisionReason}</dd>
            </div>
          )}
          {quotation.internalNotes && (
            <div className="sm:col-span-3">
              <dt className="text-secondary">{t.quotations.internalNotes}</dt>
              <dd className="text-body whitespace-pre-wrap">{quotation.internalNotes}</dd>
            </div>
          )}
        </dl>
      </Card>

      <div className="flex flex-col gap-4">
        {quotation.sections.map((section) => (
          <Card key={section.id}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-title">{section.insuranceTypeNameSnapshot}</h2>
            </div>
            {section.description && <p className="text-secondary mb-3">{section.description}</p>}

            <TableWrap scroll>
              <Table className="min-w-[720px]">
                <thead>
                  <tr>
                    <th>{t.quotations.insuredContent}</th>
                    <th>{t.quotations.calculationMethod}</th>
                    <th>{t.quotations.sumInsured}</th>
                    <th>{t.quotations.rate}</th>
                    <th>{t.quotations.premium}</th>
                    <th>{t.quotations.notes}</th>
                  </tr>
                </thead>
                <tbody>
                  {section.items.map((item) => (
                    <tr key={item.id}>
                      <td className="font-medium text-zinc-800">{item.insuredContent}</td>
                      <td className="text-zinc-500">{calculationMethodLabel[item.calculationMethod]}</td>
                      <td className="text-zinc-500">{item.sumInsured ? money(item.sumInsured) : "—"}</td>
                      <td className="text-zinc-500">{item.rate ?? "—"}</td>
                      <td className="text-zinc-800">{money(item.premium)}</td>
                      <td className="text-zinc-500">{item.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>

            <div className="mt-4 grid grid-cols-2 gap-2 rounded-control bg-zinc-50 p-3 text-sm sm:grid-cols-4">
              <div>
                <div className="text-secondary">{t.quotations.premium}</div>
                <div className="font-medium text-zinc-800">{money(section.basePremium)}</div>
              </div>
              <div>
                <div className="text-secondary">{t.quotations.phcf}</div>
                <div className="font-medium text-zinc-800">{money(section.phcfAmount)}</div>
              </div>
              <div>
                <div className="text-secondary">{t.quotations.itl}</div>
                <div className="font-medium text-zinc-800">{money(section.itlAmount)}</div>
              </div>
              <div>
                <div className="text-secondary">{t.quotations.sectionTotal}</div>
                <div className="font-semibold text-emerald-800">{money(section.sectionTotal)}</div>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-secondary">{t.quotations.clauses}</dt>
                <dd className="text-body whitespace-pre-wrap">{section.clausesSnapshot || "—"}</dd>
              </div>
              <div>
                <dt className="text-secondary">{t.quotations.exclusions}</dt>
                <dd className="text-body whitespace-pre-wrap">{section.exclusionsSnapshot || "—"}</dd>
              </div>
              <div>
                <dt className="text-secondary">{t.quotations.conditions}</dt>
                <dd className="text-body whitespace-pre-wrap">{section.conditionsSnapshot || "—"}</dd>
              </div>
            </dl>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="section-title mb-4">{t.quotations.financialSummary}</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <div>
            <div className="text-secondary">{t.quotations.subtotalPremium}</div>
            <div className="text-body font-medium">{money(quotation.subtotalPremium)}</div>
          </div>
          <div>
            <div className="text-secondary">{t.quotations.totalPHCF}</div>
            <div className="text-body font-medium">{money(quotation.totalPHCF)}</div>
          </div>
          <div>
            <div className="text-secondary">{t.quotations.totalITL}</div>
            <div className="text-body font-medium">{money(quotation.totalITL)}</div>
          </div>
          <div>
            <div className="text-secondary">{t.quotations.totalStampDuty}</div>
            <div className="text-body font-medium">{money(quotation.totalStampDuty)}</div>
          </div>
          <div>
            <div className="text-secondary">{t.quotations.grandTotal}</div>
            <div className="text-lg font-semibold text-emerald-800">
              {quotation.currency} {money(quotation.grandTotal)}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-secondary">{t.quotations.createdBy}</dt>
            <dd className="text-body">{quotation.createdByName}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.quotations.updatedAt}</dt>
            <dd className="text-body">{dateTimeFormatter.format(new Date(quotation.updatedAt))}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
