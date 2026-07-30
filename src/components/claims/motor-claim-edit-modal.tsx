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
import { updateMotorClaimAction, getMotorClaimPolicyOptionsAction } from "@/app/(app)/task/motor-claim/actions";
import { MOTOR_CLAIM_NATURES, MOTOR_CLAIM_PROGRESS_VALUES } from "@/lib/claims/enums";
import { resolveCustomerContact, resolveProjectContact } from "@/lib/claims/contactPrefill";
import { ClaimPolicyLinkField } from "@/components/claims/claim-policy-link-field";
import type { MotorClaimDetail, MotorClaimNatureValue, MotorClaimProgressValue, ClaimCustomerOption, ClaimPolicyOption } from "@/components/claims/types";

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
  NUMBER_PLATE_REQUIRED: "numberPlateRequired",
  NUMBER_PLATE_TOO_LONG: "genericError",
  CLAIM_NATURE_INVALID: "claimNatureInvalid",
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

export function MotorClaimEditModal({
  claim,
  customers,
  insurers,
  policyOptions,
  onClose,
  onSuccess,
}: {
  claim: MotorClaimDetail;
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
  const [numberPlate, setNumberPlate] = useState(claim.numberPlate);
  const [claimNature, setClaimNature] = useState<MotorClaimNatureValue>(claim.claimNature);
  const [progress, setProgress] = useState<MotorClaimProgressValue>(claim.progress);
  const [policyRecordId, setPolicyRecordId] = useState(claim.policyRecordId ?? "");
  const [policyOptionList, setPolicyOptionList] = useState<ClaimPolicyOption[]>(policyOptions);
  const policyFetchToken = useRef(0);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      getMotorClaimPolicyOptionsAction(id).then((options) => {
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
    if (!numberPlate.trim()) return setError(t.claims.numberPlateRequired);

    setIsSubmitting(true);
    const result = await updateMotorClaimAction(claim.id, {
      reportedAt,
      customerId,
      projectId: projectId || null,
      contactName,
      contactPhone,
      insurer,
      numberPlate,
      claimNature,
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
          <FormField label={t.claims.numberPlate}>
            <Input value={numberPlate} onChange={(e) => setNumberPlate(e.target.value)} maxLength={50} required />
          </FormField>
          <FormField label={t.claims.claimNature}>
            <Select value={claimNature} onChange={(e) => setClaimNature(e.target.value as MotorClaimNatureValue)} required>
              {MOTOR_CLAIM_NATURES.map((n) => (
                <option key={n} value={n}>{natureLabel[n]}</option>
              ))}
            </Select>
          </FormField>
        </div>

        <div className="form-grid">
          <FormField label={t.claims.progress}>
            <Select value={progress} onChange={(e) => setProgress(e.target.value as MotorClaimProgressValue)}>
              {MOTOR_CLAIM_PROGRESS_VALUES.map((p) => (
                <option key={p} value={p}>{progressLabel[p]}</option>
              ))}
            </Select>
          </FormField>
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
