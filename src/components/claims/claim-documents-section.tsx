"use client";

// Dropbox Integration Phase 7, Part 9 — Claim documents table/cards.
// Mirrors motor-documents-tab.tsx's compact-row + expandable-Dropbox-
// details + mobile-card pattern exactly (see that component and Correction
// 3 of this project's history for the tall-row bug this design avoids).
// Shared between Motor and Non-Motor Claim via injected server actions.
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Download, Trash2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ClaimDocumentUploadModal } from "@/components/claims/claim-document-upload-modal";
import { ClaimDocumentDropboxBadge, ClaimDocumentDropboxDetails, type ClaimDocumentDropboxAction } from "@/components/claims/claim-document-dropbox-status";
import type { ClaimDocumentDropboxInfo } from "@/components/claims/types";

export type ClaimDocumentRowLike = {
  id: string;
  documentType: string;
  originalFileName: string;
  fileSize: number;
  notes: string | null;
  uploadedByName: string;
  createdAt: string;
  dropbox: ClaimDocumentDropboxInfo;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ClaimDocumentsSection({
  claimId,
  claimIdFieldName,
  documents,
  isAdmin,
  canEdit,
  isOpen,
  documentTypeOptions,
  documentTypeLabel,
  downloadRoutePrefix,
  uploadAction,
  deleteAction,
  retryAction,
  verifyAction,
}: {
  claimId: string;
  claimIdFieldName: string;
  documents: ClaimDocumentRowLike[];
  isAdmin: boolean;
  canEdit: boolean;
  isOpen: boolean;
  documentTypeOptions: { value: string; label: string }[];
  documentTypeLabel: Record<string, string>;
  downloadRoutePrefix: string;
  uploadAction: (formData: FormData) => Promise<{ success: boolean; error?: string; id?: string }>;
  deleteAction: (documentId: string) => Promise<{ success: boolean; error?: string }>;
  retryAction: ClaimDocumentDropboxAction;
  verifyAction: ClaimDocumentDropboxAction;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateTimeFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  const [showUpload, setShowUpload] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ClaimDocumentRowLike | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleUploadSuccess = () => {
    setShowUpload(false);
    setMessage(t.claims.documentUploadSuccess);
    router.refresh();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsSubmitting(true);
    const result = await deleteAction(deleteTarget.id);
    setIsSubmitting(false);
    setDeleteTarget(null);
    if (result.success) {
      setMessage(t.claims.documentDeleteSuccess);
      router.refresh();
    }
  };

  const toggleExpanded = (id: string) => setExpandedId((current) => (current === id ? null : id));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-title">{t.claims.documentsTitle}</h2>
          {canEdit && isOpen && (
            <Button onClick={() => setShowUpload(true)}>
              <Upload size={16} />
              {t.claims.uploadDocument}
            </Button>
          )}
        </div>
      </Card>

      {message && <div className="rounded-control border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}

      {documents.length === 0 ? (
        <div className="rounded-control border border-dashed border-zinc-300 bg-white p-6 text-center text-secondary">{t.claims.noDocumentsYet}</div>
      ) : (
        <>
          <div className="hidden md:block">
            <TableWrap scroll>
              <Table>
                <thead>
                  <tr>
                    <th>{t.claims.documentType}</th>
                    <th>{t.claims.originalFileName}</th>
                    <th>{t.claims.fileSize}</th>
                    <th>{t.claims.uploadedBy}</th>
                    <th>{t.claims.uploadedAt}</th>
                    <th>{t.claims.dropboxStatusColumnHeader}</th>
                    <th className="text-right">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => {
                    const expanded = expandedId === doc.id;
                    return (
                      <Fragment key={doc.id}>
                        <tr>
                          <td>{documentTypeLabel[doc.documentType] ?? doc.documentType}</td>
                          <td className="max-w-[220px] truncate text-zinc-500" title={doc.originalFileName}>
                            {doc.originalFileName}
                          </td>
                          <td className="text-zinc-500">{formatFileSize(doc.fileSize)}</td>
                          <td className="text-zinc-500">{doc.uploadedByName}</td>
                          <td className="text-zinc-500">{dateTimeFormatter.format(new Date(doc.createdAt))}</td>
                          <td>
                            <ClaimDocumentDropboxBadge dropbox={doc.dropbox} expanded={expanded} onToggle={() => toggleExpanded(doc.id)} />
                          </td>
                          <td>
                            <div className="flex items-center justify-end gap-1">
                              <a href={`${downloadRoutePrefix}/${doc.id}?mode=download`}>
                                <IconButton title={t.claims.download}>
                                  <Download size={16} />
                                </IconButton>
                              </a>
                              {canEdit && isOpen && (
                                <IconButton tone="danger" title={t.common.delete} onClick={() => setDeleteTarget(doc)}>
                                  <Trash2 size={16} />
                                </IconButton>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={7} className="bg-zinc-50/60">
                              <ClaimDocumentDropboxDetails documentId={doc.id} dropbox={doc.dropbox} isAdmin={isAdmin} retryAction={retryAction} verifyAction={verifyAction} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {documents.length === 0 && <TableEmpty colSpan={7}>{t.claims.noDocumentsYet}</TableEmpty>}
                </tbody>
              </Table>
            </TableWrap>
          </div>

          <div className="flex flex-col gap-3 md:hidden">
            {documents.map((doc) => {
              const expanded = expandedId === doc.id;
              return (
                <Card key={doc.id} className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-800">{documentTypeLabel[doc.documentType] ?? doc.documentType}</div>
                      <div className="truncate text-xs text-zinc-500" title={doc.originalFileName}>
                        {doc.originalFileName}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <a href={`${downloadRoutePrefix}/${doc.id}?mode=download`}>
                        <IconButton title={t.claims.download}>
                          <Download size={16} />
                        </IconButton>
                      </a>
                      {canEdit && isOpen && (
                        <IconButton tone="danger" title={t.common.delete} onClick={() => setDeleteTarget(doc)}>
                          <Trash2 size={16} />
                        </IconButton>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                    <span>{formatFileSize(doc.fileSize)}</span>
                    <span>{dateTimeFormatter.format(new Date(doc.createdAt))}</span>
                    <span>{doc.uploadedByName}</span>
                  </div>
                  <ClaimDocumentDropboxBadge dropbox={doc.dropbox} expanded={expanded} onToggle={() => toggleExpanded(doc.id)} />
                  {expanded && (
                    <div className="rounded-control border border-zinc-100 bg-zinc-50/60 p-3">
                      <ClaimDocumentDropboxDetails documentId={doc.id} dropbox={doc.dropbox} isAdmin={isAdmin} retryAction={retryAction} verifyAction={verifyAction} />
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      {showUpload && (
        <ClaimDocumentUploadModal
          claimId={claimId}
          claimIdFieldName={claimIdFieldName}
          documentTypeOptions={documentTypeOptions}
          uploadAction={uploadAction}
          onClose={() => setShowUpload(false)}
          onSuccess={handleUploadSuccess}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={t.claims.deleteDocumentConfirmTitle}
          message={
            deleteTarget.dropbox.view.state === "synced"
              ? `${t.claims.deleteDocumentConfirmMessage} ${t.claims.dropboxRetentionNote}`
              : t.claims.deleteDocumentConfirmMessage
          }
          isSubmitting={isSubmitting}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
