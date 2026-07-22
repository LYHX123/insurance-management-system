"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { useLocale } from "@/i18n/locale-provider";
import { updateQuotationDocumentAction } from "@/app/(app)/quotation/documentActions";
import { QuotationDocumentType } from "@/generated/prisma/enums";
import type { QuotationDocumentRow } from "@/components/quotations/types";

const DOCUMENT_TYPES = Object.values(QuotationDocumentType);

export function EditQuotationDocumentModal({
  document,
  onClose,
  onSuccess,
}: {
  document: QuotationDocumentRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useLocale();
  const [documentType, setDocumentType] = useState<(typeof DOCUMENT_TYPES)[number]>(document.documentType);
  const [customTypeName, setCustomTypeName] = useState(document.customTypeName ?? "");
  const [description, setDescription] = useState(document.description ?? "");
  const [documentDate, setDocumentDate] = useState(document.documentDate ? document.documentDate.slice(0, 10) : "");
  const [error, setError] = useState<string | null>(null);
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
    FINANCIAL_STATEMENTS: t.quotations.docTypeFinancialStatements,
    OTHER: t.quotations.docTypeOther,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (documentType === QuotationDocumentType.OTHER && !customTypeName.trim()) {
      setError(t.quotations.documentCustomTypeRequired);
      return;
    }

    setIsSubmitting(true);
    const result = await updateQuotationDocumentAction(document.id, {
      documentType,
      customTypeName,
      description,
      documentDate,
    });
    setIsSubmitting(false);

    if (!result.success) {
      setError(t.quotations.genericError);
      return;
    }
    onSuccess();
  };

  return (
    <Modal title={t.quotations.editDocumentDetails} onClose={onClose}>
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
            <Input value={customTypeName} onChange={(e) => setCustomTypeName(e.target.value)} disabled={isSubmitting} required />
          </FormField>
        )}

        <FormField label={t.quotations.documentDescription}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} disabled={isSubmitting} />
        </FormField>

        <FormField label={t.quotations.documentDate}>
          <Input type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} disabled={isSubmitting} />
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
