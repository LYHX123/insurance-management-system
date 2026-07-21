"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { useLocale } from "@/i18n/locale-provider";
import { uploadQuotationDocumentAction } from "@/app/(app)/quotation/documentActions";
import { QuotationDocumentType } from "@/generated/prisma/enums";
import type { Dictionary } from "@/i18n/dictionaries/en";

const DOCUMENT_TYPES = Object.values(QuotationDocumentType);
const MAX_FILES_PER_UPLOAD = 10;
const ACCEPT = ".pdf,.xls,.xlsx,.doc,.docx,.csv,.jpg,.jpeg,.png,.webp,.txt";

const ERROR_KEY: Record<string, keyof Dictionary["quotations"]> = {
  NO_FILE: "documentFileRequired",
  FILE_TOO_LARGE: "documentFileTooLarge",
  FILE_EMPTY: "documentFileTooLarge",
  UNSUPPORTED_FILE_TYPE: "documentFileTypeNotAllowed",
  FILE_SIGNATURE_MISMATCH: "documentFileTypeNotAllowed",
  DANGEROUS_FILE_CONTENT: "documentFileTypeNotAllowed",
  UNSAFE_FILE_NAME: "documentFileTypeNotAllowed",
  CASE_NOT_FOUND: "genericError",
  INVALID_DOCUMENT_TYPE: "genericError",
  CUSTOM_TYPE_REQUIRED: "documentCustomTypeRequired",
  FORBIDDEN: "genericError",
  UPLOAD_FAILED: "documentUploadFailed",
  SAVE_FAILED: "documentUploadFailed",
};

type FileResult = { name: string; status: "pending" | "success" | "error"; errorLabel?: string };

export function UploadQuotationDocumentsModal({
  quotationCaseId,
  onClose,
  onSuccess,
}: {
  quotationCaseId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useLocale();
  const [documentType, setDocumentType] = useState<(typeof DOCUMENT_TYPES)[number]>(QuotationDocumentType.AWARD_LETTER);
  const [customTypeName, setCustomTypeName] = useState("");
  const [description, setDescription] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<FileResult[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const documentTypeLabel: Record<string, string> = {
    AWARD_LETTER: t.quotations.docTypeAwardLetter,
    TENDER_DOCUMENT: t.quotations.docTypeTenderDocument,
    BOQ: t.quotations.docTypeBoq,
    CONTRACT_DOCUMENT: t.quotations.docTypeContractDocument,
    EMPLOYEE_SCHEDULE: t.quotations.docTypeEmployeeSchedule,
    VEHICLE_SCHEDULE: t.quotations.docTypeVehicleSchedule,
    EQUIPMENT_SCHEDULE: t.quotations.docTypeEquipmentSchedule,
    ASSET_SCHEDULE: t.quotations.docTypeAssetSchedule,
    STOCK_SCHEDULE: t.quotations.docTypeStockSchedule,
    GOODS_SCHEDULE: t.quotations.docTypeGoodsSchedule,
    MEDICAL_CENSUS: t.quotations.docTypeMedicalCensus,
    CLAIMS_HISTORY: t.quotations.docTypeClaimsHistory,
    PREVIOUS_POLICY: t.quotations.docTypePreviousPolicy,
    INSURER_QUOTATION: t.quotations.docTypeInsurerQuotation,
    PIN_CERTIFICATE: t.quotations.docTypePinCertificate,
    REGISTRATION_CERTIFICATE: t.quotations.docTypeRegistrationCertificate,
    CR12: t.quotations.docTypeCr12,
    ID_DOCUMENT: t.quotations.docTypeIdDocument,
    APPLICATION_FORM: t.quotations.docTypeApplicationForm,
    OTHER: t.quotations.docTypeOther,
  };

  const handleFilesChange = (list: FileList | null) => {
    const picked = list ? Array.from(list) : [];
    setFiles(picked.slice(0, MAX_FILES_PER_UPLOAD));
    setResults([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (files.length === 0) {
      setFormError(t.quotations.documentFileRequired);
      return;
    }
    if (documentType === QuotationDocumentType.OTHER && !customTypeName.trim()) {
      setFormError(t.quotations.documentCustomTypeRequired);
      return;
    }

    setIsSubmitting(true);
    const nextResults: FileResult[] = files.map((f) => ({ name: f.name, status: "pending" }));
    setResults(nextResults);

    let successCount = 0;
    for (let i = 0; i < files.length; i++) {
      const formData = new FormData();
      formData.set("quotationCaseId", quotationCaseId);
      formData.set("documentType", documentType);
      formData.set("customTypeName", customTypeName.trim());
      formData.set("description", description.trim());
      formData.set("documentDate", documentDate);
      formData.set("file", files[i]);

      const result = await uploadQuotationDocumentAction(formData);
      nextResults[i] = result.success
        ? { name: files[i].name, status: "success" }
        : {
            name: files[i].name,
            status: "error",
            errorLabel: t.quotations[ERROR_KEY[result.error] ?? "genericError"],
          };
      if (result.success) successCount++;
      setResults([...nextResults]);
    }

    setIsSubmitting(false);
    if (successCount > 0) onSuccess();
  };

  return (
    <Modal title={t.quotations.uploadDocuments} onClose={onClose}>
      <form onSubmit={handleSubmit} className="form-stack">
        <FormField label={t.quotations.documentType}>
          <Select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value as (typeof DOCUMENT_TYPES)[number])}
            disabled={isSubmitting}
          >
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {documentTypeLabel[type]}
              </option>
            ))}
          </Select>
        </FormField>

        {documentType === QuotationDocumentType.OTHER && (
          <FormField label={t.quotations.customDocumentType}>
            <Input
              value={customTypeName}
              onChange={(e) => setCustomTypeName(e.target.value)}
              disabled={isSubmitting}
              required
            />
          </FormField>
        )}

        <FormField label={t.quotations.documentDescription}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} disabled={isSubmitting} />
        </FormField>

        <FormField label={t.quotations.documentDate}>
          <Input type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} disabled={isSubmitting} />
        </FormField>

        <FormField label={t.quotations.uploadDocuments}>
          <input
            type="file"
            multiple
            accept={ACCEPT}
            onChange={(e) => handleFilesChange(e.target.files)}
            className="input h-auto py-1.5"
            disabled={isSubmitting}
          />
          <p className="text-xs text-zinc-500">{t.quotations.documentUploadHint}</p>
        </FormField>

        {results.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {results.map((r, idx) => (
              <li key={`${r.name}-${idx}`} className="flex items-center justify-between gap-2">
                <span className="truncate text-zinc-700">{r.name}</span>
                {r.status === "pending" && <span className="text-zinc-400">…</span>}
                {r.status === "success" && <span className="text-emerald-700">{t.quotations.documentUploadedShort}</span>}
                {r.status === "error" && <span className="text-red-600">{r.errorLabel}</span>}
              </li>
            ))}
          </ul>
        )}

        {formError && (
          <p role="alert" className="form-error">
            {formError}
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {t.quotations.uploadDocuments}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
