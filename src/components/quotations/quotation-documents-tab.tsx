"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Eye, Download, Pencil, Trash2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { SearchBar } from "@/components/ui/search-bar";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { UploadQuotationDocumentsModal } from "@/components/quotations/upload-quotation-documents-modal";
import { EditQuotationDocumentModal } from "@/components/quotations/edit-quotation-document-modal";
import { deleteQuotationDocumentAction } from "@/app/(app)/quotation/documentActions";
import type { QuotationDocumentRow, QuotationDocumentType, DocumentSyncStatus } from "@/components/quotations/types";

const DOCUMENT_TYPE_ORDER: QuotationDocumentType[] = [
  "AWARD_LETTER",
  "TENDER_DOCUMENT",
  "BOQ",
  "CONTRACT_DOCUMENT",
  "EMPLOYEE_SCHEDULE",
  "VEHICLE_SCHEDULE",
  "EQUIPMENT_SCHEDULE",
  "ASSET_SCHEDULE",
  "STOCK_SCHEDULE",
  "GOODS_SCHEDULE",
  "MEDICAL_CENSUS",
  "CLAIMS_HISTORY",
  "PREVIOUS_POLICY",
  "INSURER_QUOTATION",
  "PIN_CERTIFICATE",
  "REGISTRATION_CERTIFICATE",
  "CR12",
  "ID_DOCUMENT",
  "APPLICATION_FORM",
  "OTHER",
];

const SYNC_TONE: Record<DocumentSyncStatus, "neutral" | "brand" | "success" | "danger"> = {
  NOT_APPLICABLE: "neutral",
  PENDING: "brand",
  SYNCED: "success",
  FAILED: "danger",
};

const PREVIEWABLE_INLINE = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function QuotationDocumentsTab({
  quotationCaseId,
  documents,
}: {
  quotationCaseId: string;
  documents: QuotationDocumentRow[];
}) {
  const { t, locale } = useLocale();
  const router = useRouter();

  const [showUpload, setShowUpload] = useState(false);
  const [editTarget, setEditTarget] = useState<QuotationDocumentRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QuotationDocumentRow | null>(null);
  const [previewTarget, setPreviewTarget] = useState<QuotationDocumentRow | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<"ALL" | QuotationDocumentType>("ALL");
  const [search, setSearch] = useState("");
  const [uploadedBySearch, setUploadedBySearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

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

  const syncStatusLabel: Record<DocumentSyncStatus, string> = {
    NOT_APPLICABLE: t.quotations.syncNotApplicable,
    PENDING: t.quotations.syncPending,
    SYNCED: t.quotations.syncSynced,
    FAILED: t.quotations.syncFailed,
  };

  const documentDisplayType = (doc: QuotationDocumentRow) =>
    doc.documentType === "OTHER" && doc.customTypeName ? doc.customTypeName : documentTypeLabel[doc.documentType];

  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });
  const dateTimeFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const uploaderTerm = uploadedBySearch.trim().toLowerCase();
    return documents
      .filter((d) => {
        const matchesType = typeFilter === "ALL" || d.documentType === typeFilter;
        const matchesTerm = !term || d.originalFileName.toLowerCase().includes(term);
        const matchesUploader = !uploaderTerm || d.uploadedByName.toLowerCase().includes(uploaderTerm);
        const uploadedDate = d.uploadedAt.slice(0, 10);
        const matchesFrom = !dateFrom || uploadedDate >= dateFrom;
        const matchesTo = !dateTo || uploadedDate <= dateTo;
        return matchesType && matchesTerm && matchesUploader && matchesFrom && matchesTo;
      })
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  }, [documents, typeFilter, search, uploadedBySearch, dateFrom, dateTo]);

  const totalSize = documents.reduce((sum, d) => sum + d.fileSize, 0);
  const lastUploaded = documents.length
    ? documents.reduce((latest, d) => (new Date(d.uploadedAt) > new Date(latest.uploadedAt) ? d : latest), documents[0])
    : null;

  const refresh = () => {
    router.refresh();
  };

  const handleUploadSuccess = () => {
    setShowUpload(false);
    setMessage(t.quotations.documentUploadSuccess);
    refresh();
  };

  const handleEditSuccess = () => {
    setEditTarget(null);
    refresh();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsSubmitting(true);
    const result = await deleteQuotationDocumentAction(deleteTarget.id);
    setIsSubmitting(false);
    setDeleteTarget(null);
    if (result.success) {
      setMessage(t.quotations.documentDeleteSuccess);
      refresh();
    }
  };

  const handlePreview = (doc: QuotationDocumentRow) => {
    if (PREVIEWABLE_INLINE.has(doc.mimeType)) {
      window.open(`/api/quotation-documents/${doc.id}?mode=view`, "_blank", "noopener,noreferrer");
      return;
    }
    setPreviewTarget(doc);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="section-title">{t.quotations.underwritingDocuments}</h2>
            <p className="text-secondary">{t.quotations.underwritingDocumentsSubtitle}</p>
          </div>
          <Button onClick={() => setShowUpload(true)}>
            <Upload size={16} />
            {t.quotations.uploadDocuments}
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-control border border-zinc-200 p-3">
            <p className="text-xs text-zinc-500">{t.quotations.totalDocuments}</p>
            <p className="text-lg font-semibold text-zinc-800">{documents.length}</p>
          </div>
          <div className="rounded-control border border-zinc-200 p-3">
            <p className="text-xs text-zinc-500">{t.quotations.totalSize}</p>
            <p className="text-lg font-semibold text-zinc-800">{formatFileSize(totalSize)}</p>
          </div>
          <div className="rounded-control border border-zinc-200 p-3">
            <p className="text-xs text-zinc-500">{t.quotations.lastUploaded}</p>
            <p className="text-lg font-semibold text-zinc-800">
              {lastUploaded ? dateFormatter.format(new Date(lastUploaded.uploadedAt)) : "—"}
            </p>
          </div>
        </div>
      </Card>

      {message && <div className="rounded-control border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder={t.quotations.documentSearchPlaceholder} className="w-full max-w-sm" />
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)} className="w-auto max-w-[220px]">
          <option value="ALL">{t.quotations.allDocumentTypes}</option>
          {DOCUMENT_TYPE_ORDER.map((type) => (
            <option key={type} value={type}>
              {documentTypeLabel[type]}
            </option>
          ))}
        </Select>
        <Input
          value={uploadedBySearch}
          onChange={(e) => setUploadedBySearch(e.target.value)}
          placeholder={t.quotations.uploadedBy}
          className="w-auto max-w-[180px]"
        />
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto" aria-label={t.quotations.dateFrom} />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-auto" aria-label={t.quotations.dateTo} />
      </div>

      <TableWrap scroll>
        <Table className="min-w-[1100px]">
          <thead>
            <tr>
              <th>{t.quotations.documentType}</th>
              <th>{t.quotations.fileName}</th>
              <th>{t.quotations.documentDescription}</th>
              <th>{t.quotations.fileSize}</th>
              <th>{t.quotations.uploadedBy}</th>
              <th>{t.quotations.uploadedAt}</th>
              <th>{t.quotations.syncStatus}</th>
              <th className="text-right">{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <TableEmpty colSpan={8}>{t.quotations.noDocumentsYet}</TableEmpty>}
            {filtered.map((doc) => (
              <tr key={doc.id}>
                <td>{documentDisplayType(doc)}</td>
                <td className="text-zinc-500">{doc.originalFileName}</td>
                <td className="max-w-[220px] truncate text-zinc-500">{doc.description || "—"}</td>
                <td className="text-zinc-500">{formatFileSize(doc.fileSize)}</td>
                <td className="text-zinc-500">{doc.uploadedByName}</td>
                <td className="text-zinc-500">{dateTimeFormatter.format(new Date(doc.uploadedAt))}</td>
                <td>
                  <Badge tone={SYNC_TONE[doc.syncStatus]}>{syncStatusLabel[doc.syncStatus]}</Badge>
                </td>
                <td>
                  <div className="flex items-center justify-end gap-1">
                    <IconButton title={t.quotations.preview} onClick={() => handlePreview(doc)}>
                      <Eye size={16} />
                    </IconButton>
                    <a href={`/api/quotation-documents/${doc.id}?mode=download`}>
                      <IconButton title={t.quotations.download}>
                        <Download size={16} />
                      </IconButton>
                    </a>
                    <IconButton title={t.quotations.editDocumentDetails} onClick={() => setEditTarget(doc)}>
                      <Pencil size={16} />
                    </IconButton>
                    <IconButton tone="danger" title={t.common.delete} onClick={() => setDeleteTarget(doc)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>

      {showUpload && (
        <UploadQuotationDocumentsModal
          quotationCaseId={quotationCaseId}
          onClose={() => setShowUpload(false)}
          onSuccess={handleUploadSuccess}
        />
      )}

      {editTarget && <EditQuotationDocumentModal document={editTarget} onClose={() => setEditTarget(null)} onSuccess={handleEditSuccess} />}

      {deleteTarget && (
        <ConfirmDialog
          title={t.quotations.deleteDocumentConfirmTitle}
          message={t.quotations.deleteDocumentConfirmMessage}
          isSubmitting={isSubmitting}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {previewTarget && (
        <Modal title={documentDisplayType(previewTarget)} onClose={() => setPreviewTarget(null)}>
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-zinc-500">{t.quotations.documentPreviewUnavailable}</p>
            <div className="rounded-control border border-zinc-200 p-3">
              <p className="font-medium text-zinc-800">{previewTarget.originalFileName}</p>
              <p className="text-zinc-500">{formatFileSize(previewTarget.fileSize)}</p>
              {previewTarget.description && <p className="mt-1 text-zinc-500">{previewTarget.description}</p>}
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPreviewTarget(null)}>
              {t.common.cancel}
            </Button>
            <a href={`/api/quotation-documents/${previewTarget.id}?mode=download`}>
              <Button>
                <Download size={16} />
                {t.quotations.download}
              </Button>
            </a>
          </div>
        </Modal>
      )}
    </div>
  );
}
