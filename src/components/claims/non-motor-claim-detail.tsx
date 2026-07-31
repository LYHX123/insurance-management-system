"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, UserCog, XCircle, RotateCcw, Trash2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { SmartBackLink } from "@/components/ui/smart-back-link";
import { useSmartBackHref } from "@/lib/navigation/useSmartBack";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  closeNonMotorClaimAction,
  reopenNonMotorClaimAction,
  deleteNonMotorClaimAction,
  addNonMotorClaimUpdateAction,
  editNonMotorClaimUpdateAction,
  deleteNonMotorClaimUpdateAction,
  updateNonMotorClaimParticipantsAction,
} from "@/app/(app)/task/non-motor-claim/actions";
import { NON_MOTOR_CLAIM_PROGRESS_TONE } from "@/lib/claims/enums";
import { NonMotorClaimEditModal } from "@/components/claims/non-motor-claim-edit-modal";
import { ClaimParticipantsModal } from "@/components/claims/claim-participants-modal";
import { ClaimTimelinePanel } from "@/components/claims/claim-timeline-panel";
import { ClaimDropboxSection } from "@/components/claims/claim-dropbox-section";
import { ClaimDocumentsSection } from "@/components/claims/claim-documents-section";
import {
  uploadNonMotorClaimDocumentAction,
  deleteNonMotorClaimDocumentAction,
} from "@/app/(app)/task/non-motor-claim/documentActions";
import {
  retryNonMotorClaimDocumentSyncAction,
  verifyNonMotorClaimDocumentAction,
  verifyNonMotorClaimBusinessFolderAction,
  syncMissingNonMotorClaimDocumentsAction,
} from "@/app/(app)/task/non-motor-claim/dropboxActions";
import { NON_MOTOR_CLAIM_DOCUMENT_TYPES } from "@/lib/claims/enums";
import type {
  NonMotorClaimDetail,
  NonMotorClaimProgressValue,
  ClaimCustomerOption,
  ActiveUserOption,
  ClaimPolicyOption,
  ClaimDropboxSectionView,
} from "@/components/claims/types";
import type { NonMotorCoverType } from "@/lib/policy/nonMotorCoverTypes";

type ConfirmKind = "close" | "reopen" | "delete";

const DOCUMENT_TYPE_LABEL_KEY: Record<(typeof NON_MOTOR_CLAIM_DOCUMENT_TYPES)[number], string> = {
  CLAIM_FORM: "docTypeClaimForm",
  INCIDENT_REPORT: "docTypeIncidentReport",
  SURVEY_REPORT: "docTypeSurveyReport",
  ASSESSMENT_REPORT: "docTypeAssessmentReport",
  SUPPORTING_DOCUMENT: "docTypeSupportingDocument",
  REPAIR_ESTIMATE: "docTypeRepairEstimate",
  REPAIR_INVOICE: "docTypeRepairInvoice",
  SETTLEMENT_OFFER: "docTypeSettlementOffer",
  DISCHARGE_VOUCHER: "docTypeDischargeVoucher",
  SETTLEMENT_LETTER: "docTypeSettlementLetter",
  PHOTOS: "docTypePhotos",
  OTHER: "docTypeOther",
};

export function NonMotorClaimDetailView({
  claim,
  currentUserId,
  customers,
  insurers,
  activeUsers,
  policyOptions,
  dropbox,
  isAdmin,
}: {
  claim: NonMotorClaimDetail;
  currentUserId: string;
  customers: ClaimCustomerOption[];
  insurers: string[];
  activeUsers: ActiveUserOption[];
  policyOptions: ClaimPolicyOption[];
  dropbox: ClaimDropboxSectionView;
  isAdmin: boolean;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });
  // Phase 8.1 Part 4 — same resolution SmartBackLink uses below: the
  // validated `returnTo` this page was opened with (a filtered list URL),
  // falling back to the bare category route only when none was supplied.
  const backHref = useSmartBackHref("/task/non-motor-claim");

  const isCreator = claim.createdById === currentUserId;
  const isOpen = claim.status === "OPEN";

  const coverTypeLabel: Record<NonMotorCoverType, string> = {
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
  };
  const progressLabel: Record<NonMotorClaimProgressValue, string> = {
    DOCUMENT_PREPARATION: t.claims.progressDocumentPreparation,
    LOSS_ASSESSMENT_INVESTIGATION: t.claims.progressLossAssessmentInvestigation,
    APPROVAL: t.claims.progressApproval,
    DV_ISSUED: t.claims.progressDvIssued,
    PAYMENT: t.claims.progressPayment,
    FINISH: t.claims.progressFinish,
  };

  const [showEdit, setShowEdit] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [isConfirmBusy, setIsConfirmBusy] = useState(false);

  const confirmClaimAction = async () => {
    if (!confirmKind) return;
    setIsConfirmBusy(true);
    const result =
      confirmKind === "close"
        ? await closeNonMotorClaimAction(claim.id)
        : confirmKind === "reopen"
          ? await reopenNonMotorClaimAction(claim.id)
          : await deleteNonMotorClaimAction(claim.id);
    setIsConfirmBusy(false);
    setConfirmKind(null);
    if (result.success && confirmKind === "delete") {
      // replace, not push — a deleted claim must not be reachable again via
      // the browser back button (Phase 8 Part 11). Uses the same resolved
      // returnTo as SmartBackLink so the filtered list URL (search/status/
      // pagination) survives the round trip instead of resetting to a bare
      // category URL (Phase 8.1 Part 4).
      router.replace(backHref);
      return;
    }
    router.refresh();
  };

  const confirmTitle: Record<ConfirmKind, string> = {
    close: t.claims.confirmCloseTitle,
    reopen: t.claims.confirmReopenTitle,
    delete: t.claims.confirmDeleteTitle,
  };
  const hasSyncedDocuments = claim.documents.some((d) => d.dropbox.view.state === "synced");
  const confirmMessage: Record<ConfirmKind, string> = {
    close: t.claims.confirmCloseMessage,
    reopen: t.claims.confirmReopenMessage,
    delete: hasSyncedDocuments ? `${t.claims.confirmDeleteMessage} ${t.claims.dropboxRetentionNote}` : t.claims.confirmDeleteMessage,
  };

  const documentTypeOptions = NON_MOTOR_CLAIM_DOCUMENT_TYPES.map((value) => ({ value, label: t.claims[DOCUMENT_TYPE_LABEL_KEY[value] as keyof typeof t.claims] as string }));
  const documentTypeLabel: Record<string, string> = Object.fromEntries(documentTypeOptions.map((o) => [o.value, o.label]));

  return (
    <div className="flex flex-col gap-section">
      <SmartBackLink fallbackHref="/task/non-motor-claim" label={t.task.tabNonMotorClaim} />

      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {claim.claimNumber}
            <Badge tone={isOpen ? "brand" : "neutral"}>{isOpen ? t.claims.open : t.claims.closed}</Badge>
            <Badge tone={NON_MOTOR_CLAIM_PROGRESS_TONE[claim.progress]}>{progressLabel[claim.progress]}</Badge>
          </span>
        }
      />

      <Card>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-secondary text-sm">{t.claims.customer}</dt>
            <dd className="font-medium text-zinc-800">{claim.customerName}</dd>
          </div>
          <div>
            <dt className="text-secondary text-sm">{t.claims.project}</dt>
            <dd className="font-medium text-zinc-800">{claim.projectName ?? t.claims.noProject}</dd>
          </div>
          <div>
            <dt className="text-secondary text-sm">{t.claims.reportedTime}</dt>
            <dd className="font-medium text-zinc-800">{dateFormatter.format(new Date(claim.reportedAt))}</dd>
          </div>
          <div>
            <dt className="text-secondary text-sm">{t.claims.contactName}</dt>
            <dd className="font-medium text-zinc-800">{claim.contactName}</dd>
          </div>
          <div>
            <dt className="text-secondary text-sm">{t.claims.contactPhone}</dt>
            <dd className="font-medium text-zinc-800">{claim.contactPhone}</dd>
          </div>
          <div>
            <dt className="text-secondary text-sm">{t.claims.insurer}</dt>
            <dd className="font-medium text-zinc-800">{claim.insurer}</dd>
          </div>
          <div>
            <dt className="text-secondary text-sm">{t.claims.insuranceType}</dt>
            <dd className="font-medium text-zinc-800">{coverTypeLabel[claim.insuranceType]}</dd>
          </div>
          <div>
            <dt className="text-secondary text-sm">{t.claims.linkedPolicy}</dt>
            <dd className="font-medium text-zinc-800">
              {claim.linkedPolicy ? (
                <Link href={`/policy/non-motor/${claim.linkedPolicy.id}`} className="text-emerald-700 hover:underline">
                  {claim.linkedPolicy.recordNumber}
                </Link>
              ) : (
                t.claims.noLinkedPolicy
              )}
            </dd>
          </div>
          <div>
            <dt className="text-secondary text-sm">{t.claims.lastUpdated}</dt>
            <dd className="font-medium text-zinc-800">{dateFormatter.format(new Date(claim.updatedAt))}</dd>
          </div>
          <div>
            <dt className="text-secondary text-sm">{t.task.createdBy}</dt>
            <dd className="font-medium text-zinc-800">
              {claim.createdByName} · {dateFormatter.format(new Date(claim.createdAt))}
            </dd>
          </div>
          {claim.closedAt && (
            <div>
              <dt className="text-secondary text-sm">{t.claims.closedBy}</dt>
              <dd className="font-medium text-zinc-800">
                {claim.closedByName} · {dateFormatter.format(new Date(claim.closedAt))}
              </dd>
            </div>
          )}
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-secondary text-sm">{t.claims.participants}</dt>
            <dd className="font-medium text-zinc-800 break-words">{claim.participants.map((p) => p.fullName).join(", ")}</dd>
          </div>
        </dl>

        {isCreator && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
            {isOpen ? (
              <>
                <Button variant="secondary" onClick={() => setShowEdit(true)}>
                  <Pencil size={16} />
                  {t.claims.editClaim}
                </Button>
                <Button variant="secondary" onClick={() => setShowParticipants(true)}>
                  <UserCog size={16} />
                  {t.claims.manageParticipants}
                </Button>
                <Button variant="secondary" onClick={() => setConfirmKind("close")}>
                  <XCircle size={16} />
                  {t.claims.closeClaim}
                </Button>
                <Button variant="secondary" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setConfirmKind("delete")}>
                  <Trash2 size={16} />
                  {t.claims.deleteClaim}
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setConfirmKind("reopen")}>
                  <RotateCcw size={16} />
                  {t.claims.reopenClaim}
                </Button>
                <Button variant="secondary" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setConfirmKind("delete")}>
                  <Trash2 size={16} />
                  {t.claims.deleteClaim}
                </Button>
              </>
            )}
          </div>
        )}
      </Card>

      <ClaimDocumentsSection
        claimId={claim.id}
        claimIdFieldName="nonMotorClaimId"
        documents={claim.documents}
        isAdmin={isAdmin}
        isOpen={isOpen}
        documentTypeOptions={documentTypeOptions}
        documentTypeLabel={documentTypeLabel}
        downloadRoutePrefix="/api/non-motor-claim-documents"
        uploadAction={uploadNonMotorClaimDocumentAction}
        deleteAction={deleteNonMotorClaimDocumentAction}
        retryAction={retryNonMotorClaimDocumentSyncAction}
        verifyAction={verifyNonMotorClaimDocumentAction}
      />

      <ClaimDropboxSection
        claimId={claim.id}
        dropbox={dropbox}
        isAdmin={isAdmin}
        verifyBusinessFolderAction={verifyNonMotorClaimBusinessFolderAction}
        syncMissingAction={syncMissingNonMotorClaimDocumentsAction}
      />

      <ClaimTimelinePanel
        claimId={claim.id}
        timeline={claim.timeline}
        isOpen={isOpen}
        currentUserId={currentUserId}
        isCreator={isCreator}
        addAction={addNonMotorClaimUpdateAction}
        editAction={editNonMotorClaimUpdateAction}
        deleteAction={deleteNonMotorClaimUpdateAction}
      />

      {showEdit && (
        <NonMotorClaimEditModal
          claim={claim}
          customers={customers}
          insurers={insurers}
          policyOptions={policyOptions}
          onClose={() => setShowEdit(false)}
          onSuccess={() => setShowEdit(false)}
        />
      )}

      {showParticipants && (
        <ClaimParticipantsModal
          claimId={claim.id}
          creatorId={claim.createdById}
          participants={claim.participants}
          activeUsers={activeUsers}
          updateAction={updateNonMotorClaimParticipantsAction}
          onClose={() => setShowParticipants(false)}
          onChanged={() => setShowParticipants(false)}
        />
      )}

      {confirmKind && (
        <ConfirmDialog
          title={confirmTitle[confirmKind]}
          message={confirmMessage[confirmKind]}
          isSubmitting={isConfirmBusy}
          onConfirm={confirmClaimAction}
          onClose={() => setConfirmKind(null)}
        />
      )}
    </div>
  );
}
