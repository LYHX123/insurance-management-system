"use client";

import { useState, Fragment } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Pencil, Plus, Eye, Trash2, Download, Upload, ChevronDown, ChevronRight } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { SmartBackLink } from "@/components/ui/smart-back-link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs } from "@/components/ui/tabs";
import { Modal } from "@/components/ui/modal";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EditCustomerModal } from "@/components/customers/edit-customer-modal";
import { ProjectFormModal } from "@/components/customers/project-form-modal";
import { UploadDocumentModal } from "@/components/customers/upload-document-modal";
import { CustomerDropboxCard, type CustomerDropboxFolderView } from "@/components/customers/customer-dropbox-card";
import { DocumentDropboxStatus } from "@/components/customers/document-dropbox-status";
import { DropboxPathDisplay } from "@/components/dropbox/dropbox-path-display";
import { CustomerRelatedRecords } from "@/components/customers/customer-related-records";
import { deleteProjectAction } from "@/app/(app)/customer/project-actions";
import { deleteDocumentAction } from "@/app/(app)/customer/document-actions";
import { buildReturnTo } from "@/lib/navigation/returnTo";
import type { CustomerDetail, ProjectRow, DocumentRow, DropboxPathViewPlain } from "@/components/customers/types";
import type { CustomerRelatedRecordsData } from "@/lib/customers/relatedRecords";

type TabKey = "overview" | "projects" | "documents" | "relatedRecords";

type ModalState =
  | { type: "edit-customer" }
  | { type: "add-project" }
  | { type: "edit-project"; project: ProjectRow }
  | { type: "view-project"; project: ProjectRow }
  | { type: "delete-project"; project: ProjectRow }
  | { type: "upload-document"; projectId?: string }
  | { type: "delete-document"; document: DocumentRow }
  | null;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CustomerDetailView({
  customer,
  projects,
  documents,
  dropboxFolder,
  dropboxConnected,
  isAdmin,
  canEdit,
  dropboxPaths,
  relatedRecords,
}: {
  customer: CustomerDetail;
  projects: ProjectRow[];
  documents: DocumentRow[];
  dropboxFolder: CustomerDropboxFolderView;
  dropboxConnected: boolean;
  isAdmin: boolean;
  canEdit: boolean;
  dropboxPaths: { customerFolder: DropboxPathViewPlain; customerDocumentsFolder: DropboxPathViewPlain; generalDocumentsFolder: DropboxPathViewPlain };
  relatedRecords: CustomerRelatedRecordsData;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<TabKey>(() => {
    const requested = searchParams.get("tab");
    const valid: TabKey[] = ["overview", "projects", "documents", "relatedRecords"];
    return valid.includes(requested as TabKey) ? (requested as TabKey) : "overview";
  });
  // Phase 8.1 Part 3: this page's own current URL (including whatever
  // returnTo it itself was reached with), always pinned to tab=relatedRecords
  // regardless of which tab is actually active — this is only ever used as
  // the returnTo handed to a Quotation/Policy/Invoice/Claim opened FROM the
  // Related Records tab, so coming back always lands back on that tab.
  const selfReturnTo = (() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "relatedRecords");
    return buildReturnTo(pathname, params.toString());
  })();
  const [modal, setModal] = useState<ModalState>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Which document rows have their full Dropbox path expanded — collapsed
  // by default so a long path never stretches the whole table row (Phase 8
  // Part 7.2), matching the Policy/Claim documents tables' existing pattern.
  const [expandedDropboxDocIds, setExpandedDropboxDocIds] = useState<Set<string>>(new Set());
  const toggleDropboxDetails = (docId: string) => {
    setExpandedDropboxDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  // Keeps the tab in the URL (replace, never push) so refreshing, sharing,
  // or a smart-back returnTo capture always restores the tab the user was
  // actually looking at (Phase 8 Part 6.5).
  const handleTabChange = (key: string) => {
    setTab(key as TabKey);
    const params = new URLSearchParams(searchParams.toString());
    if (key === "overview") params.delete("tab");
    else params.set("tab", key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const projectStatusLabel = {
    ACTIVE: t.customers.active,
    COMPLETED: t.customers.completed,
    SUSPENDED: t.customers.suspended,
  };

  const documentTypeLabel: Record<string, string> = {
    REGISTRATION_CERTIFICATE: t.customers.registrationCertificate,
    PIN_CERTIFICATE: t.customers.pinCertificate,
    CR12: t.customers.cr12,
    OTHER: t.customers.otherDocument,
  };

  const documentDisplayName = (doc: DocumentRow) =>
    doc.documentType === "OTHER" && doc.customDocumentName
      ? doc.customDocumentName
      : documentTypeLabel[doc.documentType];

  const companyDocuments = documents.filter((d) => !d.projectId);
  const projectDocuments = documents.filter((d) => d.projectId);

  const handleSuccess = (successMessage: string) => {
    setModal(null);
    setMessage(successMessage);
    router.refresh();
  };

  const handleDeleteProject = async () => {
    if (modal?.type !== "delete-project") return;
    setIsSubmitting(true);
    const result = await deleteProjectAction(modal.project.id);
    setIsSubmitting(false);
    if (result.success) {
      handleSuccess(t.customers.projectDeleteSuccess);
    } else if (result.error === "PROJECT_HAS_QUOTATIONS") {
      setModal(null);
      setMessage(t.customers.projectHasQuotations);
    }
  };

  const handleDeleteDocument = async () => {
    if (modal?.type !== "delete-document") return;
    setIsSubmitting(true);
    const result = await deleteDocumentAction(modal.document.id);
    setIsSubmitting(false);
    if (result.success) handleSuccess(t.customers.documentDeleteSuccess);
  };

  const renderDocumentTable = (rows: DocumentRow[], emptyMessage: string) => (
    <TableWrap scroll>
      <Table className="min-w-[1020px]">
        <thead>
          <tr>
            <th>{t.customers.documentType}</th>
            <th>{t.customers.fileName}</th>
            {rows.some((r) => r.projectId) && <th>{t.customers.relatedProject}</th>}
            <th>{t.customers.fileSize}</th>
            <th>{t.customers.uploadedBy}</th>
            <th>{t.customers.uploadedDate}</th>
            <th>{t.customers.dropboxDocumentStatusLabel}</th>
            <th>{t.dropbox.pathLabel}</th>
            <th className="text-right">{t.common.actions}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <TableEmpty colSpan={9}>{emptyMessage}</TableEmpty>}
          {rows.map((doc) => {
            const expanded = expandedDropboxDocIds.has(doc.id);
            return (
              <Fragment key={doc.id}>
                <tr>
                  <td>{documentDisplayName(doc)}</td>
                  <td className="max-w-[220px] truncate text-zinc-500" title={doc.originalFileName}>
                    {doc.originalFileName}
                  </td>
                  {rows.some((r) => r.projectId) && <td>{doc.projectName || "—"}</td>}
                  <td className="text-zinc-500">{formatFileSize(doc.fileSize)}</td>
                  <td className="text-zinc-500">{doc.uploadedByName}</td>
                  <td className="text-zinc-500">{dateFormatter.format(new Date(doc.createdAt))}</td>
                  <td>
                    <DocumentDropboxStatus
                      documentId={doc.id}
                      dropboxSync={doc.dropboxSync}
                      dropboxConnected={dropboxConnected}
                      isAdmin={isAdmin}
                    />
                  </td>
                  <td className="max-w-[140px]">
                    <button
                      type="button"
                      onClick={() => toggleDropboxDetails(doc.id)}
                      aria-expanded={expanded}
                      className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    >
                      {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {expanded ? t.dropbox.hideFullPath : t.dropbox.showFullPath}
                    </button>
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <a href={`/api/customer-documents/${doc.id}?mode=view`} target="_blank" rel="noopener noreferrer">
                        <IconButton title={t.customers.view}>
                          <Eye size={16} />
                        </IconButton>
                      </a>
                      <a href={`/api/customer-documents/${doc.id}?mode=download`}>
                        <IconButton title={t.customers.download}>
                          <Download size={16} />
                        </IconButton>
                      </a>
                      {canEdit && (
                        <IconButton
                          tone="danger"
                          title={t.common.delete}
                          onClick={() => setModal({ type: "delete-document", document: doc })}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      )}
                    </div>
                  </td>
                </tr>
                {expanded && (
                  <tr>
                    <td colSpan={rows.some((r) => r.projectId) ? 9 : 8} className="bg-zinc-50">
                      <DropboxPathDisplay label={t.dropbox.pathLabel} view={doc.dropboxPath} className="w-full" />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </Table>
    </TableWrap>
  );

  return (
    <div className="flex flex-col gap-section">
      <div>
        <SmartBackLink fallbackHref="/customer" label={t.customers.backToList} />
        <PageHeader
          title={customer.companyName}
          description={customer.customerNumber}
          actions={
            canEdit ? (
              <Button variant="secondary" onClick={() => setModal({ type: "edit-customer" })}>
                <Pencil size={16} />
                {t.common.edit}
              </Button>
            ) : undefined
          }
        />
      </div>

      {message && (
        <div className="flex items-center justify-between rounded-control border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {message}
          <button type="button" onClick={() => setMessage(null)}>
            ×
          </button>
        </div>
      )}

      <Tabs
        active={tab}
        onChange={handleTabChange}
        tabs={[
          { key: "overview", label: t.customers.overview },
          { key: "projects", label: `${t.customers.projects} (${projects.length})` },
          { key: "documents", label: `${t.customers.customerDocuments} (${documents.length})` },
          { key: "relatedRecords", label: t.customers.relatedRecords },
        ]}
      />

      {tab === "overview" && (
        <div className="flex flex-col gap-4">
          <Card>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-secondary">{t.customers.customerNumber}</dt>
                <dd className="text-body font-medium">{customer.customerNumber}</dd>
              </div>
              <div>
                <dt className="text-secondary">{t.customers.pinNumber}</dt>
                <dd className="text-body font-medium">{customer.pinNumber}</dd>
              </div>
              <div>
                <dt className="text-secondary">{t.customers.registeredAddress}</dt>
                <dd className="text-body">{customer.registeredAddress || "—"}</dd>
              </div>
              <div>
                <dt className="text-secondary">{t.customers.mainContactPerson}</dt>
                <dd className="text-body">{customer.mainContactPerson || "—"}</dd>
              </div>
              <div>
                <dt className="text-secondary">{t.customers.mainPhoneNumber}</dt>
                <dd className="text-body">{customer.mainPhoneNumber || "—"}</dd>
              </div>
              <div>
                <dt className="text-secondary">{t.customers.shortName}</dt>
                <dd className="text-body">{customer.shortName || "—"}</dd>
              </div>
              <div>
                <dt className="text-secondary">{t.common.status}</dt>
                <dd>
                  <StatusBadge
                    active={customer.status === "ACTIVE"}
                    activeLabel={t.customers.active}
                    inactiveLabel={t.customers.inactive}
                  />
                </dd>
              </div>
            </dl>
          </Card>

          <CustomerDropboxCard
            customerId={customer.id}
            dropboxFolder={dropboxFolder}
            dropboxConnected={dropboxConnected}
            isAdmin={isAdmin}
            dropboxPaths={dropboxPaths}
          />
        </div>
      )}

      {tab === "projects" && (
        <div className="flex flex-col gap-4">
          {canEdit && (
            <div className="flex justify-end">
              <Button onClick={() => setModal({ type: "add-project" })}>
                <Plus size={16} />
                {t.customers.addProject}
              </Button>
            </div>
          )}

          <TableWrap scroll>
            <Table className="min-w-[700px]">
              <thead>
                <tr>
                  <th>{t.customers.projectName}</th>
                  <th>{t.customers.contactPerson}</th>
                  <th>{t.customers.phoneNumber}</th>
                  <th>{t.common.status}</th>
                  <th className="text-right">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {projects.length === 0 && <TableEmpty colSpan={5}>{t.customers.noProjectsYet}</TableEmpty>}
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td className="font-medium text-zinc-800">{project.projectName}</td>
                    <td>{project.contactPerson}</td>
                    <td className="text-zinc-500">{project.phoneNumber}</td>
                    <td>
                      <Badge tone={project.status === "ACTIVE" ? "success" : project.status === "SUSPENDED" ? "warning" : "neutral"}>
                        {projectStatusLabel[project.status]}
                      </Badge>
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        <IconButton title={t.customers.viewProject} onClick={() => setModal({ type: "view-project", project })}>
                          <Eye size={16} />
                        </IconButton>
                        {canEdit && (
                          <>
                            <IconButton title={t.customers.editProject} onClick={() => setModal({ type: "edit-project", project })}>
                              <Pencil size={16} />
                            </IconButton>
                            <IconButton
                              title={t.customers.uploadDocument}
                              onClick={() => setModal({ type: "upload-document", projectId: project.id })}
                            >
                              <Upload size={16} />
                            </IconButton>
                            <IconButton
                              tone="danger"
                              title={t.customers.deleteProject}
                              onClick={() => setModal({ type: "delete-project", project })}
                            >
                              <Trash2 size={16} />
                            </IconButton>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </div>
      )}

      {tab === "documents" && (
        <div className="flex flex-col gap-6">
          {canEdit && (
            <div className="flex justify-end">
              <Button onClick={() => setModal({ type: "upload-document" })}>
                <Plus size={16} />
                {t.customers.uploadDocument}
              </Button>
            </div>
          )}

          <div>
            <h2 className="section-title mb-3">{t.customers.companyDocuments}</h2>
            {renderDocumentTable(companyDocuments, t.customers.noDocumentsYet)}
          </div>

          <div>
            <h2 className="section-title mb-3">{t.customers.projectDocuments}</h2>
            {renderDocumentTable(projectDocuments, t.customers.noDocumentsYet)}
          </div>
        </div>
      )}

      {tab === "relatedRecords" && (
        <CustomerRelatedRecords customerId={customer.id} selfReturnTo={selfReturnTo} data={relatedRecords} />
      )}

      {modal?.type === "edit-customer" && (
        <EditCustomerModal customer={customer} onClose={() => setModal(null)} onSuccess={handleSuccess} />
      )}

      {modal?.type === "add-project" && (
        <ProjectFormModal customerId={customer.id} project={null} onClose={() => setModal(null)} onSuccess={handleSuccess} />
      )}

      {modal?.type === "edit-project" && (
        <ProjectFormModal
          customerId={customer.id}
          project={modal.project}
          onClose={() => setModal(null)}
          onSuccess={handleSuccess}
        />
      )}

      {modal?.type === "view-project" && (
        <Modal title={modal.project.projectName} onClose={() => setModal(null)}>
          <dl className="flex flex-col gap-3">
            <div>
              <dt className="text-secondary">{t.customers.contactPerson}</dt>
              <dd className="text-body">{modal.project.contactPerson}</dd>
            </div>
            <div>
              <dt className="text-secondary">{t.customers.phoneNumber}</dt>
              <dd className="text-body">{modal.project.phoneNumber}</dd>
            </div>
            <div>
              <dt className="text-secondary">{t.customers.description}</dt>
              <dd className="text-body whitespace-pre-wrap">{modal.project.description || "—"}</dd>
            </div>
            <div>
              <dt className="text-secondary">{t.common.status}</dt>
              <dd className="text-body">{projectStatusLabel[modal.project.status]}</dd>
            </div>
          </dl>
          <div className="mt-6 flex justify-end">
            <Button variant="secondary" onClick={() => setModal(null)}>
              {t.common.close}
            </Button>
          </div>
        </Modal>
      )}

      {modal?.type === "delete-project" && (
        <ConfirmDialog
          title={t.customers.confirmDeleteProject}
          message={t.customers.confirmDeleteProjectMessage}
          isSubmitting={isSubmitting}
          onConfirm={handleDeleteProject}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === "upload-document" && (
        <UploadDocumentModal
          customerId={customer.id}
          projects={projects.map((p) => ({ id: p.id, projectName: p.projectName }))}
          defaultProjectId={modal.projectId}
          onClose={() => setModal(null)}
          onSuccess={handleSuccess}
        />
      )}

      {modal?.type === "delete-document" && (
        <ConfirmDialog
          title={t.customers.confirmDeleteDocument}
          message={t.customers.confirmDeleteDocumentMessage}
          isSubmitting={isSubmitting}
          onConfirm={handleDeleteDocument}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
