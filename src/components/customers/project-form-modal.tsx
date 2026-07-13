"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { useLocale } from "@/i18n/locale-provider";
import { createProjectAction, updateProjectAction } from "@/app/(app)/customer/project-actions";
import type { ProjectRow } from "@/components/customers/types";

const statuses = ["ACTIVE", "COMPLETED", "SUSPENDED"] as const;

const ERROR_KEY: Record<string, string> = {
  PROJECT_NAME_REQUIRED: "requiredField",
  PROJECT_CONTACT_REQUIRED: "requiredField",
  INVALID_PHONE: "invalidPhone",
};

export function ProjectFormModal({
  customerId,
  project,
  onClose,
  onSuccess,
}: {
  customerId: string;
  project: ProjectRow | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const { t } = useLocale();
  const isEdit = !!project;

  const [projectName, setProjectName] = useState(project?.projectName ?? "");
  const [contactPerson, setContactPerson] = useState(project?.contactPerson ?? "");
  const [phoneNumber, setPhoneNumber] = useState(project?.phoneNumber ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [status, setStatus] = useState<(typeof statuses)[number]>(project?.status ?? "ACTIVE");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const statusLabel = {
    ACTIVE: t.customers.active,
    COMPLETED: t.customers.completed,
    SUSPENDED: t.customers.suspended,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!projectName.trim() || !contactPerson.trim() || !phoneNumber.trim()) {
      setError(t.customers.requiredField);
      return;
    }

    setIsSubmitting(true);
    const data = { projectName, contactPerson, phoneNumber, description };
    const result = isEdit
      ? await updateProjectAction(project.id, { ...data, status })
      : await createProjectAction(customerId, data);
    setIsSubmitting(false);

    if (!result.success) {
      const key = ERROR_KEY[result.error] ?? "genericError";
      setError(t.customers[key as keyof typeof t.customers]);
      return;
    }

    onSuccess(isEdit ? t.customers.projectUpdateSuccess : t.customers.projectCreateSuccess);
  };

  return (
    <Modal title={isEdit ? t.customers.editProject : t.customers.addProject} onClose={onClose}>
      <form onSubmit={handleSubmit} className="form-stack">
        <FormField label={t.customers.projectName}>
          <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} required />
        </FormField>

        <div className="form-grid">
          <FormField label={t.customers.contactPerson}>
            <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} required />
          </FormField>
          <FormField label={t.customers.phoneNumber}>
            <Input
              type="tel"
              placeholder="0712345678"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              required
            />
          </FormField>
        </div>

        <FormField label={t.customers.description}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </FormField>
        {isEdit && (
          <FormField label={t.common.status}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as (typeof statuses)[number])}>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {statusLabel[s]}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
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
