"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { FormField } from "@/components/ui/form-field";
import { updateNonMotorClaimAction, getNonMotorClaimPolicyOptionsAction } from "@/app/(app)/task/non-motor-claim/actions";
import { NON_MOTOR_CLAIM_PROGRESS_VALUES } from "@/lib/claims/enums";
import { resolveCustomerContact, resolveProjectContact } from "@/lib/claims/contactPrefill";
import { NON_MOTOR_COVER_TYPES } from "@/lib/policy/nonMotorCoverTypes";
import { ClaimPolicyLinkField } from "@/components/claims/claim-policy-link-field";
import type { NonMotorClaimDetail, NonMotorClaimProgressValue, ClaimCustomerOption, ClaimPolicyOption } from "@/components/claims/types";
import type { NonMotorCoverType } from "@/lib/policy/nonMotorCoverTypes";

const ERROR_KEY: Record<string, string> = {
  FORBIDDEN: "forbidden",
  CLAIM_NOT_FOUND: "claimNotFound",
  CLAIM_NOT_OPEN: "claimNotOpen",
  REPORTED_AT_REQUIRED: "reportedTimeRequired",
  CUSTOMER_REQUIRED: "customerRequired",
  CUSTOMER_NOT_FOUND: "customerNotFound",
  PROJECT_NOT_FOUND: "projectNotFound",
  CONTACT_NAME_REQUIRED: "contactNameRequired",
  CONTACT_NAME_TOO_LONG: "genericError",
  CONTACT_PHONE_REQUIRED: "contactPhoneRequired",
  CONTACT_PHONE_TOO_LONG: "genericError",
  INSURER_REQUIRED: "insurerRequired",
  INSURER_TOO_LONG: "genericError",
  INSURANCE_TYPE_INVALID: "insuranceTypeInvalid",
  PROGRESS_INVALID: "progressInvalid",
  UPDATE_FAILED: "updateFailed",
  POLICY_NOT_FOUND: "policyNotFound",
  POLICY_CUSTOMER_MISMATCH: "policyCustomerMismatch",
  POLICY_CATEGORY_MISMATCH: "policyCategoryMismatch",
  CLAIM_POLICY_REASSIGNMENT_BLOCKED: "policyReassignmentBlockedMessage",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function NonMotorClaimEditModal({
  claim,
  customers,
  insurers,
  policyOptions,
  onClose,
  onSuccess,
}: {
  claim: NonMotorClaimDetail;
  customers: ClaimCustomerOption[];
  insurers: string[];
  policyOptions: ClaimPolicyOption[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useLocale();
  const router = useRouter();

  const [reportedAt, setReportedAt] = useState(toDatetimeLocalValue(claim.reportedAt));
  const [customerId, setCustomerId] = useState(claim.customerId);
  const [projectId, setProjectId] = useState(claim.projectId ?? "");
  const [contactName, setContactName] = useState(claim.contactName);
  const [contactPhone, setContactPhone] = useState(claim.contactPhone);
  const [insurer, setInsurer] = useState(claim.insurer);
  const [insuranceType, setInsuranceType] = useState<NonMotorCoverType>(claim.insuranceType);
  const [progress, setProgress] = useState<NonMotorClaimProgressValue>(claim.progress);
  const [policyRecordId, setPolicyRecordId] = useState(claim.policyRecordId ?? "");
  const [policyOptionList, setPolicyOptionList] = useState<ClaimPolicyOption[]>(policyOptions);
  const policyFetchToken = useRef(0);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const availableProjects = selectedCustomer?.projects ?? [];

  const handleCustomerChange = (id: string) => {
    setCustomerId(id);
    setProjectId("");
    const contact = resolveCustomerContact(customers.find((c) => c.id === id));
    setContactName(contact.name);
    setContactPhone(contact.phone);
    // Changing Customer invalidates whatever Policy was selected for the
    // previous Customer — never carried over (see this phase's spec, Part 2).
    setPolicyRecordId("");
    setPolicyOptionList([]);
    const token = ++policyFetchToken.current;
    if (id) {
      getNonMotorClaimPolicyOptionsAction(id).then((options) => {
        if (policyFetchToken.current === token) setPolicyOptionList(options);
      });
    }
  };

  const handleProjectChange = (id: string) => {
    setProjectId(id);
    const project = availableProjects.find((p) => p.id === id);
    const contact = id ? resolveProjectContact(project, selectedCustomer) : resolveCustomerContact(selectedCustomer);
    setContactName(contact.name);
    setContactPhone(contact.phone);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!reportedAt) return setError(t.claims.reportedTimeRequired);
    if (!customerId) return setError(t.claims.customerRequired);
    if (!contactName.trim()) return setError(t.claims.contactNameRequired);
    if (!contactPhone.trim()) return setError(t.claims.contactPhoneRequired);
    if (!insurer.trim()) return setError(t.claims.insurerRequired);

    setIsSubmitting(true);
    const result = await updateNonMotorClaimAction(claim.id, {
      reportedAt,
      customerId,
      projectId: projectId || null,
      contactName,
      contactPhone,
      insurer,
      insuranceType,
      progress,
      policyRecordId: policyRecordId || null,
    });
    setIsSubmitting(false);

    if (!result.success) {
      setError(t.claims[(ERROR_KEY[result.error] ?? "genericError") as keyof typeof t.claims]);
      return;
    }
    router.refresh();
    onSuccess();
  };

  return (
    <Modal title={t.claims.editClaim} onClose={onClose} width="md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="form-grid">
          <FormField label={t.claims.reportedTime}>
            <Input type="datetime-local" value={reportedAt} onChange={(e) => setReportedAt(e.target.value)} required />
          </FormField>
          <FormField label={t.claims.customer}>
            <Select value={customerId} onChange={(e) => handleCustomerChange(e.target.value)} required>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName} ({c.customerNumber})
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <div className="form-grid">
          <FormField label={t.claims.project}>
            <Select value={projectId} onChange={(e) => handleProjectChange(e.target.value)} disabled={!customerId}>
              <option value="">{t.claims.noProject}</option>
              {availableProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.projectName}</option>
              ))}
            </Select>
          </FormField>
          <FormField label={t.claims.contactName}>
            <Input value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={200} required />
          </FormField>
        </div>

        <div className="form-grid">
          <FormField label={t.claims.contactPhone}>
            <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} maxLength={200} required />
          </FormField>
          <FormField label={t.claims.insurer}>
            <Combobox value={insurer} onChange={setInsurer} options={insurers} placeholder={t.claims.selectInsurer} />
          </FormField>
        </div>

        <div className="form-grid">
          <FormField label={t.claims.insuranceType}>
            <Select value={insuranceType} onChange={(e) => setInsuranceType(e.target.value as NonMotorCoverType)} required>
              {NON_MOTOR_COVER_TYPES.map((c) => (
                <option key={c} value={c}>{coverTypeLabel[c]}</option>
              ))}
            </Select>
          </FormField>
          <FormField label={t.claims.progress}>
            <Select value={progress} onChange={(e) => setProgress(e.target.value as NonMotorClaimProgressValue)}>
              {NON_MOTOR_CLAIM_PROGRESS_VALUES.map((p) => (
                <option key={p} value={p}>{progressLabel[p]}</option>
              ))}
            </Select>
          </FormField>
        </div>

        <div className="form-grid">
          <ClaimPolicyLinkField value={policyRecordId} onChange={setPolicyRecordId} options={policyOptionList} disabled={!customerId} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {t.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
