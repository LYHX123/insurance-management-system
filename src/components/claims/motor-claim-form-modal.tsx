"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { FormField } from "@/components/ui/form-field";
import { createMotorClaimAction } from "@/app/(app)/task/motor-claim/actions";
import { MOTOR_CLAIM_NATURES, MOTOR_CLAIM_PROGRESS_VALUES } from "@/lib/claims/enums";
import { resolveCustomerContact, resolveProjectContact } from "@/lib/claims/contactPrefill";
import type { MotorClaimNatureValue, MotorClaimProgressValue, ClaimCustomerOption, ActiveUserOption } from "@/components/claims/types";

const ERROR_KEY: Record<string, string> = {
  FORBIDDEN: "forbidden",
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
  USER_INACTIVE: "userInactive",
  CREATE_FAILED: "createFailed",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function nowDatetimeLocalValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function MotorClaimFormModal({
  categorySlug,
  customers,
  insurers,
  currentUserId,
  activeUsers,
  onClose,
}: {
  categorySlug: string;
  customers: ClaimCustomerOption[];
  insurers: string[];
  currentUserId: string;
  activeUsers: ActiveUserOption[];
  onClose: () => void;
}) {
  const { t } = useLocale();
  const router = useRouter();

  const [reportedAt, setReportedAt] = useState(nowDatetimeLocalValue());
  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [insurer, setInsurer] = useState("");
  const [numberPlate, setNumberPlate] = useState("");
  const [claimNature, setClaimNature] = useState<MotorClaimNatureValue | "">("");
  const [progress, setProgress] = useState<MotorClaimProgressValue>("PREPARE_CLAIM_DOCUMENT");
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(() => new Set([currentUserId]));

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

  // Clears an invalid Project (see this phase's spec, Part B.3) and
  // prefills contact details from the Customer — never writes back to the
  // Customer record. Changing Customer always discards whatever Project
  // contact was previously loaded (see the Project Contact Prefill Fix
  // task, Part 5).
  const handleCustomerChange = (id: string) => {
    setCustomerId(id);
    setProjectId("");
    const contact = resolveCustomerContact(customers.find((c) => c.id === id));
    setContactName(contact.name);
    setContactPhone(contact.phone);
  };

  // Selecting a Project prefills from that Project's own contact, falling
  // back field-by-field to the Customer's contact when the Project's value
  // is blank; clearing back to "No Project" restores the Customer's
  // contact (see the Project Contact Prefill Fix task, Parts 3–4).
  const handleProjectChange = (id: string) => {
    setProjectId(id);
    const project = availableProjects.find((p) => p.id === id);
    const contact = id ? resolveProjectContact(project, selectedCustomer) : resolveCustomerContact(selectedCustomer);
    setContactName(contact.name);
    setContactPhone(contact.phone);
  };

  const toggleParticipant = (id: string) => {
    if (id === currentUserId) return;
    setSelectedParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    if (!claimNature) return setError(t.claims.claimNatureInvalid);

    setIsSubmitting(true);
    const result = await createMotorClaimAction({
      reportedAt,
      customerId,
      projectId: projectId || null,
      contactName,
      contactPhone,
      insurer,
      numberPlate,
      claimNature,
      progress,
      participantIds: [...selectedParticipants],
    });
    setIsSubmitting(false);

    if (!result.success) {
      setError(t.claims[(ERROR_KEY[result.error] ?? "genericError") as keyof typeof t.claims]);
      return;
    }
    router.push(`/task/${categorySlug}/${result.id}`);
    router.refresh();
  };

  return (
    <Modal title={t.claims.createClaim} onClose={onClose} width="md">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="form-grid">
          <FormField label={t.claims.reportedTime}>
            <Input type="datetime-local" value={reportedAt} onChange={(e) => setReportedAt(e.target.value)} required />
          </FormField>
          <FormField label={t.claims.customer}>
            <Select value={customerId} onChange={(e) => handleCustomerChange(e.target.value)} required>
              <option value="">{t.claims.selectCustomer}</option>
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
              <option value="">{t.claims.selectClaimNature}</option>
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
        </div>

        <FormField label={t.claims.participants}>
          <div className="max-h-56 overflow-y-auto rounded-control border border-zinc-200 divide-y divide-zinc-100">
            {activeUsers.map((u) => {
              const locked = u.id === currentUserId;
              return (
                <label key={u.id} className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${locked ? "bg-zinc-50" : ""}`}>
                  <input
                    type="checkbox"
                    checked={selectedParticipants.has(u.id)}
                    disabled={locked}
                    onChange={() => toggleParticipant(u.id)}
                    className="h-4 w-4 rounded border-zinc-300 disabled:opacity-60"
                  />
                  <span className="flex-1 text-zinc-800">
                    {u.name}
                    {u.role ? <span className="text-zinc-400"> · {u.role}</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
        </FormField>

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
