"use client";

// Dropbox Integration Phase 7 — shared upload modal for Motor/Non-Motor
// Claim documents. Mirrors upload-policy-document-modal.tsx, minus the
// issue/expiry date fields (not part of the Claim document schema — a
// Claim document has no such concept, unlike a Policy document).
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { useLocale } from "@/i18n/locale-provider";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx";

const ERROR_KEY: Record<string, string> = {
  NO_FILE: "documentFileRequired",
  FILE_TOO_LARGE: "documentFileTooLarge",
  FILE_EMPTY: "documentFileTooLarge",
  UNSUPPORTED_FILE_TYPE: "documentFileTypeNotAllowed",
  FILE_SIGNATURE_MISMATCH: "documentFileTypeNotAllowed",
  DANGEROUS_FILE_CONTENT: "documentFileTypeNotAllowed",
  UNSAFE_FILE_NAME: "documentFileTypeNotAllowed",
  CLAIM_NOT_FOUND: "genericError",
  CLAIM_NOT_OPEN: "claimNotOpen",
  INVALID_DOCUMENT_TYPE: "genericError",
  FORBIDDEN: "genericError",
  UPLOAD_FAILED: "documentUploadFailed",
};

export function ClaimDocumentUploadModal({
  claimId,
  claimIdFieldName,
  documentTypeOptions,
  uploadAction,
  onClose,
  onSuccess,
}: {
  claimId: string;
  claimIdFieldName: string;
  documentTypeOptions: { value: string; label: string }[];
  uploadAction: (formData: FormData) => Promise<{ success: boolean; error?: string; id?: string }>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useLocale();
  const [documentType, setDocumentType] = useState<string>(documentTypeOptions[0]?.value ?? "");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError(t.claims.documentFileRequired);
      return;
    }

    setIsSubmitting(true);
    const formData = new FormData();
    formData.set(claimIdFieldName, claimId);
    formData.set("documentType", documentType);
    formData.set("notes", notes.trim());
    formData.set("file", file);

    const result = await uploadAction(formData);
    setIsSubmitting(false);

    if (!result.success) {
      setError(t.claims[(ERROR_KEY[result.error ?? ""] ?? "genericError") as keyof typeof t.claims]);
      return;
    }
    onSuccess();
  };

  return (
    <Modal title={t.claims.uploadDocument} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <FormField label={t.claims.documentType}>
          <Select value={documentType} onChange={(e) => setDocumentType(e.target.value)} disabled={isSubmitting}>
            {documentTypeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label={t.claims.uploadDocument}>
          <input type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="input h-auto py-1.5" disabled={isSubmitting} />
          <p className="text-xs text-zinc-500">{t.claims.documentUploadHint}</p>
        </FormField>

        <FormField label={t.claims.notesOptional}>
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
            {t.claims.uploadDocument}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
