"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Download, Trash2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { UploadPolicyDocumentModal } from "@/components/policy/motor/upload-policy-document-modal";
import { PolicyDocumentDropboxBadge, PolicyDocumentDropboxDetails } from "@/components/policy/policy-document-dropbox-status";
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
  // At most one row expanded at a time — keeps the table's height bounded
  // and matches the chevron-toggle convention already used elsewhere (see
  // quotation-dropbox-status.tsx's showHistory, historical-import-warning-
  // card.tsx's expanded).
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  const toggleExpanded = (id: string) => setExpandedId((current) => (current === id ? null : id));

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
        <>
          {/* Desktop / wide-viewport: compact table, one row per document.
              Hidden below md — a squeezed 9-column table is unreadable on a
              phone, so mobile gets the card layout below instead (no
              existing responsive-card pattern to reuse elsewhere in this
              codebase, but Card/Badge/IconButton/DropboxPathDisplay are all
              existing primitives). */}
          <div className="hidden md:block">
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
                    <th>{t.policy.dropboxStatusColumnHeader}</th>
                    <th className="text-right">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => {
                    const expanded = expandedId === doc.id;
                    return (
                      <Fragment key={doc.id}>
                        <tr>
                          <td>{documentTypeLabel[doc.documentType]}</td>
                          <td className="max-w-[220px] truncate text-zinc-500" title={doc.originalFileName}>
                            {doc.originalFileName}
                          </td>
                          <td className="text-zinc-500">{doc.issueDate ? dateFormatter.format(new Date(doc.issueDate)) : "—"}</td>
                          <td className="text-zinc-500">{doc.expiryDate ? dateFormatter.format(new Date(doc.expiryDate)) : "—"}</td>
                          <td className="text-zinc-500">{doc.uploadedByName}</td>
                          <td className="text-zinc-500">{dateTimeFormatter.format(new Date(doc.createdAt))}</td>
                          <td className="text-zinc-500">{formatFileSize(doc.fileSize)}</td>
                          <td>
                            <PolicyDocumentDropboxBadge dropbox={doc.dropbox} expanded={expanded} onToggle={() => toggleExpanded(doc.id)} />
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
                        {expanded && (
                          <tr>
                            <td colSpan={9} className="bg-zinc-50/60">
                              <PolicyDocumentDropboxDetails policyDocumentId={doc.id} dropbox={doc.dropbox} isAdmin={isAdmin} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {documents.length === 0 && <TableEmpty colSpan={9}>{t.policy.noDocumentsYet}</TableEmpty>}
                </tbody>
              </Table>
            </TableWrap>
          </div>

          {/* Mobile: one compact card per document. */}
          <div className="flex flex-col gap-3 md:hidden">
            {documents.map((doc) => {
              const expanded = expandedId === doc.id;
              return (
                <Card key={doc.id} className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-800">{documentTypeLabel[doc.documentType]}</div>
                      <div className="truncate text-xs text-zinc-500" title={doc.originalFileName}>
                        {doc.originalFileName}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <a href={`/api/policy-documents/${doc.id}?mode=download`}>
                        <IconButton title={t.policy.download}>
                          <Download size={16} />
                        </IconButton>
                      </a>
                      <IconButton tone="danger" title={t.common.delete} onClick={() => setDeleteTarget(doc)}>
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                    <span>{formatFileSize(doc.fileSize)}</span>
                    <span>{dateTimeFormatter.format(new Date(doc.createdAt))}</span>
                    {doc.expiryDate && <span>{t.policy.expiryDate}: {dateFormatter.format(new Date(doc.expiryDate))}</span>}
                  </div>
                  <PolicyDocumentDropboxBadge dropbox={doc.dropbox} expanded={expanded} onToggle={() => toggleExpanded(doc.id)} />
                  {expanded && (
                    <div className="rounded-control border border-zinc-100 bg-zinc-50/60 p-3">
                      <PolicyDocumentDropboxDetails policyDocumentId={doc.id} dropbox={doc.dropbox} isAdmin={isAdmin} />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
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
