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
  closeMotorClaimAction,
  reopenMotorClaimAction,
  deleteMotorClaimAction,
  addMotorClaimUpdateAction,
  editMotorClaimUpdateAction,
  deleteMotorClaimUpdateAction,
  updateMotorClaimParticipantsAction,
} from "@/app/(app)/task/motor-claim/actions";
import { MOTOR_CLAIM_PROGRESS_TONE } from "@/lib/claims/enums";
import { MotorClaimEditModal } from "@/components/claims/motor-claim-edit-modal";
import { ClaimParticipantsModal } from "@/components/claims/claim-participants-modal";
import { ClaimTimelinePanel } from "@/components/claims/claim-timeline-panel";
import { ClaimDropboxSection } from "@/components/claims/claim-dropbox-section";
import { ClaimDocumentsSection } from "@/components/claims/claim-documents-section";
import {
  uploadMotorClaimDocumentAction,
  deleteMotorClaimDocumentAction,
} from "@/app/(app)/task/motor-claim/documentActions";
import {
  retryMotorClaimDocumentSyncAction,
  verifyMotorClaimDocumentAction,
  verifyMotorClaimBusinessFolderAction,
  syncMissingMotorClaimDocumentsAction,
} from "@/app/(app)/task/motor-claim/dropboxActions";
import { MOTOR_CLAIM_DOCUMENT_TYPES } from "@/lib/claims/enums";
import type {
  MotorClaimDetail,
  MotorClaimNatureValue,
  MotorClaimProgressValue,
  ClaimCustomerOption,
  ActiveUserOption,
  ClaimPolicyOption,
  ClaimDropboxSectionView,
} from "@/components/claims/types";

type ConfirmKind = "close" | "reopen" | "delete";

const DOCUMENT_TYPE_LABEL_KEY: Record<(typeof MOTOR_CLAIM_DOCUMENT_TYPES)[number], string> = {
  CLAIM_FORM: "docTypeClaimForm",
  POLICE_ABSTRACT: "docTypePoliceAbstract",
  DRIVER_LICENSE: "docTypeDriverLicense",
  LOGBOOK: "docTypeLogbook",
  INSURANCE_CERTIFICATE: "docTypeInsuranceCertificate",
  ASSESSMENT_REPORT: "docTypeAssessmentReport",
  REPAIR_ESTIMATE: "docTypeRepairEstimate",
  REPAIR_INVOICE: "docTypeRepairInvoice",
  REINSPECTION_REPORT: "docTypeReinspectionReport",
  DISCHARGE_VOUCHER: "docTypeDischargeVoucher",
  RELEASE_LETTER: "docTypeReleaseLetter",
  PHOTOS: "docTypePhotos",
  OTHER: "docTypeOther",
};

export function MotorClaimDetailView({
  claim,
  currentUserId,
  customers,
  insurers,
  activeUsers,
  policyOptions,
  dropbox,
  isAdmin,
  canEdit,
}: {
  claim: MotorClaimDetail;
  currentUserId: string;
  customers: ClaimCustomerOption[];
  insurers: string[];
  activeUsers: ActiveUserOption[];
  policyOptions: ClaimPolicyOption[];
  dropbox: ClaimDropboxSectionView;
  isAdmin: boolean;
  canEdit: boolean;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });
  // Phase 8.1 Part 4 — same resolution SmartBackLink uses below: the
  // validated `returnTo` this page was opened with (a filtered list URL),
  // falling back to the bare category route only when none was supplied.
  const backHref = useSmartBackHref("/task/motor-claim");

  const isCreator = claim.createdById === currentUserId;
  const isOpen = claim.status === "OPEN";

  const natureLabel: Record<MotorClaimNatureValue, string> = {
    OWN_DAMAGE: t.claims.natureOwnDamage,
    THIRD_PARTY_CLAIM: t.claims.natureThirdPartyClaim,
    WINDSCREEN: t.claims.natureWindscreen,
    ACCIDENT: t.claims.natureAccident,
  };
  const progressLabel: Record<MotorClaimProgressValue, string> = {
    PREPARE_CLAIM_DOCUMENT: t.claims.progressPrepareClaimDocument,
    ASSESSMENT_PROCESS: t.claims.progressAssessmentProcess,
    APPROVAL_AND_REPAIR: t.claims.progressApprovalAndRepair,
    RE_INSPECTION_AND_RELEASE: t.claims.progressReInspectionAndRelease,
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
      confirmKind === "close" ? await closeMotorClaimAction(claim.id) : confirmKind === "reopen" ? await reopenMotorClaimAction(claim.id) : await deleteMotorClaimAction(claim.id);
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
  // Part 11: a bilingual retention note is added to the delete confirmation
  // only when at least one document has actually synced to Dropbox — never
  // implies retained files exist when none do.
  const hasSyncedDocuments = claim.documents.some((d) => d.dropbox.view.state === "synced");
  const confirmMessage: Record<ConfirmKind, string> = {
    close: t.claims.confirmCloseMessage,
    reopen: t.claims.confirmReopenMessage,
    delete: hasSyncedDocuments ? `${t.claims.confirmDeleteMessage} ${t.claims.dropboxRetentionNote}` : t.claims.confirmDeleteMessage,
  };

  const documentTypeOptions = MOTOR_CLAIM_DOCUMENT_TYPES.map((value) => ({ value, label: t.claims[DOCUMENT_TYPE_LABEL_KEY[value] as keyof typeof t.claims] as string }));
  const documentTypeLabel: Record<string, string> = Object.fromEntries(documentTypeOptions.map((o) => [o.value, o.label]));

  return (
    <div className="flex flex-col gap-section">
      <SmartBackLink fallbackHref="/task/motor-claim" label={t.task.tabMotorClaim} />

      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {claim.claimNumber}
            <Badge tone={isOpen ? "brand" : "neutral"}>{isOpen ? t.claims.open : t.claims.closed}</Badge>
            <Badge tone={MOTOR_CLAIM_PROGRESS_TONE[claim.progress]}>{progressLabel[claim.progress]}</Badge>
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
            <dt className="text-secondary text-sm">{t.claims.numberPlate}</dt>
            <dd className="font-medium text-zinc-800">{claim.numberPlate}</dd>
          </div>
          <div>
            <dt className="text-secondary text-sm">{t.claims.claimNature}</dt>
            <dd className="font-medium text-zinc-800">{natureLabel[claim.claimNature]}</dd>
          </div>
          <div>
            <dt className="text-secondary text-sm">{t.claims.linkedPolicy}</dt>
            <dd className="font-medium text-zinc-800">
              {claim.linkedPolicy ? (
                <Link href={`/policy/motor/${claim.linkedPolicy.id}`} className="text-emerald-700 hover:underline">
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

        {canEdit && isCreator && (
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
        claimIdFieldName="motorClaimId"
        documents={claim.documents}
        isAdmin={isAdmin}
        canEdit={canEdit}
        isOpen={isOpen}
        documentTypeOptions={documentTypeOptions}
        documentTypeLabel={documentTypeLabel}
        downloadRoutePrefix="/api/motor-claim-documents"
        uploadAction={uploadMotorClaimDocumentAction}
        deleteAction={deleteMotorClaimDocumentAction}
        retryAction={retryMotorClaimDocumentSyncAction}
        verifyAction={verifyMotorClaimDocumentAction}
      />

      <ClaimDropboxSection
        claimId={claim.id}
        dropbox={dropbox}
        isAdmin={isAdmin}
        verifyBusinessFolderAction={verifyMotorClaimBusinessFolderAction}
        syncMissingAction={syncMissingMotorClaimDocumentsAction}
      />

      <ClaimTimelinePanel
        claimId={claim.id}
        timeline={claim.timeline}
        isOpen={isOpen}
        currentUserId={currentUserId}
        isCreator={isCreator}
        canEdit={canEdit}
        addAction={addMotorClaimUpdateAction}
        editAction={editMotorClaimUpdateAction}
        deleteAction={deleteMotorClaimUpdateAction}
      />

      {showEdit && (
        <MotorClaimEditModal
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
          updateAction={updateMotorClaimParticipantsAction}
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
