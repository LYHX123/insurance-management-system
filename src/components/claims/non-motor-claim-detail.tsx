"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, UserCog, XCircle, RotateCcw, Trash2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
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
import type { NonMotorClaimDetail, NonMotorClaimProgressValue, ClaimCustomerOption, ActiveUserOption } from "@/components/claims/types";
import type { NonMotorCoverType } from "@/lib/policy/nonMotorCoverTypes";

type ConfirmKind = "close" | "reopen" | "delete";

export function NonMotorClaimDetailView({
  claim,
  currentUserId,
  customers,
  insurers,
  activeUsers,
}: {
  claim: NonMotorClaimDetail;
  currentUserId: string;
  customers: ClaimCustomerOption[];
  insurers: string[];
  activeUsers: ActiveUserOption[];
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

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
      router.push("/task/non-motor-claim");
    }
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
      <Link href="/task/non-motor-claim" className="inline-flex w-fit items-center gap-1.5 text-sm text-emerald-700 hover:underline">
        <ArrowLeft size={14} />
        {t.task.tabNonMotorClaim}
      </Link>

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
        <NonMotorClaimEditModal claim={claim} customers={customers} insurers={insurers} onClose={() => setShowEdit(false)} onSuccess={() => setShowEdit(false)} />
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
