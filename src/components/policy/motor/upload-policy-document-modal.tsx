"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { useLocale } from "@/i18n/locale-provider";
import { uploadPolicyDocumentAction } from "@/app/(app)/policy/motor/documentActions";
import { PolicyDocumentType } from "@/generated/prisma/enums";

const DOCUMENT_TYPES = Object.values(PolicyDocumentType);
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx";

const ERROR_KEY: Record<string, string> = {
  NO_FILE: "documentFileRequired",
  FILE_TOO_LARGE: "documentFileTooLarge",
  FILE_EMPTY: "documentFileTooLarge",
  UNSUPPORTED_FILE_TYPE: "documentFileTypeNotAllowed",
  FILE_SIGNATURE_MISMATCH: "documentFileTypeNotAllowed",
  DANGEROUS_FILE_CONTENT: "documentFileTypeNotAllowed",
  UNSAFE_FILE_NAME: "documentFileTypeNotAllowed",
  RECORD_NOT_FOUND: "recordNotFound",
  INVALID_DOCUMENT_TYPE: "genericError",
  FORBIDDEN: "genericError",
  UPLOAD_FAILED: "documentUploadFailed",
  SAVE_FAILED: "documentUploadFailed",
};

export function UploadPolicyDocumentModal({
  policyRecordId,
  onClose,
  onSuccess,
}: {
  policyRecordId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useLocale();
  const [documentType, setDocumentType] = useState<(typeof DOCUMENT_TYPES)[number]>(PolicyDocumentType.POLICY_SCHEDULE);
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const documentTypeLabel: Record<string, string> = {
    POLICY_SCHEDULE: t.policy.docTypePolicySchedule,
    CERTIFICATE: t.policy.docTypeCertificate,
    STICKER: t.policy.docTypeSticker,
    DEBIT_NOTE: t.policy.docTypeDebitNote,
    RECEIPT: t.policy.docTypeReceipt,
    ENDORSEMENT: t.policy.docTypeEndorsement,
    CANCELLATION: t.policy.docTypeCancellation,
    OTHER: t.policy.docTypeOther,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError(t.policy.documentFileRequired);
      return;
    }

    setIsSubmitting(true);
    const formData = new FormData();
    formData.set("policyRecordId", policyRecordId);
    formData.set("documentType", documentType);
    formData.set("issueDate", issueDate);
    formData.set("expiryDate", expiryDate);
    formData.set("notes", notes.trim());
    formData.set("file", file);

    const result = await uploadPolicyDocumentAction(formData);
    setIsSubmitting(false);

    if (!result.success) {
      setError(t.policy[(ERROR_KEY[result.error] ?? "genericError") as keyof typeof t.policy]);
      return;
    }
    onSuccess();
  };

  return (
    <Modal title={t.policy.uploadDocument} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <FormField label={t.policy.documentType}>
          <Select value={documentType} onChange={(e) => setDocumentType(e.target.value as (typeof DOCUMENT_TYPES)[number])} disabled={isSubmitting}>
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {documentTypeLabel[type]}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label={t.policy.uploadDocument}>
          <input
            type="file"
            accept={ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="input h-auto py-1.5"
            disabled={isSubmitting}
          />
          <p className="text-xs text-zinc-500">{t.policy.documentUploadHint}</p>
        </FormField>

        <FormField label={t.policy.issueDateOptional}>
          <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} disabled={isSubmitting} />
        </FormField>
        <FormField label={t.policy.expiryDateOptional}>
          <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} disabled={isSubmitting} />
        </FormField>
        <FormField label={t.policy.notesOptional}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} disabled={isSubmitting} />
        </FormField>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {t.policy.uploadDocument}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
