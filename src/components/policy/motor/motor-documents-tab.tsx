"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Download, Trash2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UploadPolicyDocumentModal } from "@/components/policy/motor/upload-policy-document-modal";
import { PolicyDocumentDropboxStatus } from "@/components/policy/policy-document-dropbox-status";
import { deletePolicyDocumentAction } from "@/app/(app)/policy/motor/documentActions";
import type { PolicyDocumentRow, PolicyDocumentType } from "@/components/policy/types";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MotorDocumentsTab({
  policyRecordId,
  documents,
  isAdmin = false,
}: {
  policyRecordId: string;
  documents: PolicyDocumentRow[];
  isAdmin?: boolean;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });
  const dateTimeFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  const [showUpload, setShowUpload] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PolicyDocumentRow | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const documentTypeLabel: Record<PolicyDocumentType, string> = {
    POLICY_SCHEDULE: t.policy.docTypePolicySchedule,
    CERTIFICATE: t.policy.docTypeCertificate,
    STICKER: t.policy.docTypeSticker,
    DEBIT_NOTE: t.policy.docTypeDebitNote,
    RECEIPT: t.policy.docTypeReceipt,
    ENDORSEMENT: t.policy.docTypeEndorsement,
    CANCELLATION: t.policy.docTypeCancellation,
    OTHER: t.policy.docTypeOther,
  };

  const handleUploadSuccess = () => {
    setShowUpload(false);
    setMessage(t.policy.documentUploadSuccess);
    router.refresh();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsSubmitting(true);
    const result = await deletePolicyDocumentAction(deleteTarget.id);
    setIsSubmitting(false);
    setDeleteTarget(null);
    if (result.success) {
      setMessage(t.policy.documentDeleteSuccess);
      router.refresh();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-title">{t.policy.documentsTab}</h2>
          <Button onClick={() => setShowUpload(true)}>
            <Upload size={16} />
            {t.policy.uploadDocument}
          </Button>
        </div>
      </Card>

      {message && <div className="rounded-control border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}

      {documents.length === 0 ? (
        <div className="rounded-control border border-dashed border-zinc-300 bg-white p-6 text-center text-secondary">
          {t.policy.noDocumentsYet}
        </div>
      ) : (
        <TableWrap scroll>
          <Table>
            <thead>
              <tr>
                <th>{t.policy.documentType}</th>
                <th>{t.policy.fileName}</th>
                <th>{t.policy.issueDate}</th>
                <th>{t.policy.expiryDate}</th>
                <th>{t.policy.uploadedBy}</th>
                <th>{t.policy.uploadedAt}</th>
                <th>{t.policy.fileSize}</th>
                <th>{t.policy.dropboxFilingTitle}</th>
                <th className="text-right">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td>{documentTypeLabel[doc.documentType]}</td>
                  <td className="text-zinc-500">{doc.originalFileName}</td>
                  <td className="text-zinc-500">{doc.issueDate ? dateFormatter.format(new Date(doc.issueDate)) : "—"}</td>
                  <td className="text-zinc-500">{doc.expiryDate ? dateFormatter.format(new Date(doc.expiryDate)) : "—"}</td>
                  <td className="text-zinc-500">{doc.uploadedByName}</td>
                  <td className="text-zinc-500">{dateTimeFormatter.format(new Date(doc.createdAt))}</td>
                  <td className="text-zinc-500">{formatFileSize(doc.fileSize)}</td>
                  <td className="max-w-xs">
                    <PolicyDocumentDropboxStatus policyDocumentId={doc.id} dropbox={doc.dropbox} isAdmin={isAdmin} />
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1">
                      <a href={`/api/policy-documents/${doc.id}?mode=download`}>
                        <IconButton title={t.policy.download}>
                          <Download size={16} />
                        </IconButton>
                      </a>
                      <IconButton tone="danger" title={t.common.delete} onClick={() => setDeleteTarget(doc)}>
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
              {documents.length === 0 && <TableEmpty colSpan={9}>{t.policy.noDocumentsYet}</TableEmpty>}
            </tbody>
          </Table>
        </TableWrap>
      )}

      {showUpload && (
        <UploadPolicyDocumentModal policyRecordId={policyRecordId} onClose={() => setShowUpload(false)} onSuccess={handleUploadSuccess} />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={t.policy.deleteDocumentConfirmTitle}
          message={
            deleteTarget.dropbox.view.state === "synced"
              ? `${t.policy.deleteDocumentConfirmMessage} ${t.policy.dropboxRetentionNote}`
              : t.policy.deleteDocumentConfirmMessage
          }
          isSubmitting={isSubmitting}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
