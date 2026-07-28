"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { useLocale } from "@/i18n/locale-provider";
import { uploadDocumentAction } from "@/app/(app)/customer/document-actions";
import { CustomerDocumentType } from "@/generated/prisma/enums";

const documentTypes = [
  CustomerDocumentType.REGISTRATION_CERTIFICATE,
  CustomerDocumentType.PIN_CERTIFICATE,
  CustomerDocumentType.CR12,
  CustomerDocumentType.OTHER,
] as const;

const ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png";

const ERROR_KEY: Record<string, string> = {
  CUSTOM_DOCUMENT_NAME_REQUIRED: "customDocumentNameRequired",
  FILE_REQUIRED: "fileRequired",
  FILE_TOO_LARGE: "fileTooLarge",
  UNSUPPORTED_FILE_TYPE: "unsupportedFileType",
};

export function UploadDocumentModal({
  customerId,
  projects,
  defaultProjectId,
  onClose,
  onSuccess,
}: {
  customerId: string;
  projects: { id: string; projectName: string }[];
  defaultProjectId?: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const { t } = useLocale();
  const [documentType, setDocumentType] = useState<(typeof documentTypes)[number]>(
    CustomerDocumentType.REGISTRATION_CERTIFICATE
  );
  const [customDocumentName, setCustomDocumentName] = useState("");
  const [scope, setScope] = useState<"company" | "project">(
    defaultProjectId ? "project" : "company"
  );
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const documentTypeLabel: Record<string, string> = {
    REGISTRATION_CERTIFICATE: t.customers.registrationCertificate,
    PIN_CERTIFICATE: t.customers.pinCertificate,
    CR12: t.customers.cr12,
    OTHER: t.customers.otherDocument,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (documentType === CustomerDocumentType.OTHER && !customDocumentName.trim()) {
      setError(t.customers.customDocumentNameRequired);
      return;
    }
    if (scope === "project" && !projectId) {
      setError(t.customers.requiredField);
      return;
    }
    if (!file) {
      setError(t.customers.fileRequired);
      return;
    }

    const formData = new FormData();
    formData.set("customerId", customerId);
    formData.set("projectId", scope === "project" ? projectId : "");
    formData.set("documentType", documentType);
    formData.set("customDocumentName", customDocumentName.trim());
    formData.set("file", file);

    setIsSubmitting(true);
    const result = await uploadDocumentAction(formData);
    setIsSubmitting(false);

    if (!result.success) {
      const key = ERROR_KEY[result.error] ?? "genericError";
      setError(t.customers[key as keyof typeof t.customers]);
      return;
    }

    onSuccess(result.dropboxSyncStatus === "SYNCED" ? t.customers.documentUploadSuccessSynced : t.customers.documentUploadSuccessPending);
  };

  return (
    <Modal title={t.customers.uploadDocument} onClose={onClose}>
      <form onSubmit={handleSubmit} className="form-stack">
        <FormField label={t.customers.documentType}>
          <Select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value as (typeof documentTypes)[number])}
          >
            {documentTypes.map((type) => (
              <option key={type} value={type}>
                {documentTypeLabel[type]}
              </option>
            ))}
          </Select>
        </FormField>

        {documentType === CustomerDocumentType.OTHER && (
          <FormField label={t.customers.customDocumentName}>
            <Input
              value={customDocumentName}
              onChange={(e) => setCustomDocumentName(e.target.value)}
              required
            />
          </FormField>
        )}

        <FormField label={t.customers.scope}>
          <Select
            value={scope}
            onChange={(e) => setScope(e.target.value as "company" | "project")}
          >
            <option value="company">{t.customers.companyLevel}</option>
            <option value="project" disabled={projects.length === 0}>
              {t.customers.projectLevel}
            </option>
          </Select>
        </FormField>

        {scope === "project" && (
          <FormField label={t.customers.selectProject}>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectName}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        <FormField label={t.customers.uploadDocument}>
          <input
            type="file"
            accept={ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="input h-auto py-1.5"
            required
          />
        </FormField>

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
