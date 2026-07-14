"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Plus, Eye, Trash2, Download, Upload } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
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
import { deleteProjectAction } from "@/app/(app)/customer/project-actions";
import { deleteDocumentAction } from "@/app/(app)/customer/document-actions";
import type { CustomerDetail, ProjectRow, DocumentRow } from "@/components/customers/types";

type TabKey = "overview" | "projects" | "documents" | "related";

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
}: {
  customer: CustomerDetail;
  projects: ProjectRow[];
  documents: DocumentRow[];
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("overview");
  const [modal, setModal] = useState<ModalState>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      <Table className="min-w-[860px]">
        <thead>
          <tr>
            <th>{t.customers.documentType}</th>
            <th>{t.customers.fileName}</th>
            {rows.some((r) => r.projectId) && <th>{t.customers.relatedProject}</th>}
            <th>{t.customers.fileSize}</th>
            <th>{t.customers.uploadedBy}</th>
            <th>{t.customers.uploadedDate}</th>
            <th className="text-right">{t.common.actions}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <TableEmpty colSpan={7}>{emptyMessage}</TableEmpty>}
          {rows.map((doc) => (
            <tr key={doc.id}>
              <td>{documentDisplayName(doc)}</td>
              <td className="text-zinc-500">{doc.originalFileName}</td>
              {rows.some((r) => r.projectId) && <td>{doc.projectName || "—"}</td>}
              <td className="text-zinc-500">{formatFileSize(doc.fileSize)}</td>
              <td className="text-zinc-500">{doc.uploadedByName}</td>
              <td className="text-zinc-500">{dateFormatter.format(new Date(doc.createdAt))}</td>
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
                  <IconButton
                    tone="danger"
                    title={t.common.delete}
                    onClick={() => setModal({ type: "delete-document", document: doc })}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );

  return (
    <div className="flex flex-col gap-section">
      <div>
        <Link href="/customer" className="mb-2 inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline">
          <ArrowLeft size={14} />
          {t.customers.backToList}
        </Link>
        <PageHeader
          title={customer.companyName}
          description={customer.customerNumber}
          actions={
            <Button variant="secondary" onClick={() => setModal({ type: "edit-customer" })}>
              <Pencil size={16} />
              {t.common.edit}
            </Button>
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
        onChange={(key) => setTab(key as TabKey)}
        tabs={[
          { key: "overview", label: t.customers.overview },
          { key: "projects", label: `${t.customers.projects} (${projects.length})` },
          { key: "documents", label: `${t.customers.customerDocuments} (${documents.length})` },
          { key: "related", label: t.customers.relatedRecords },
        ]}
      />

      {tab === "overview" && (
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
      )}

      {tab === "projects" && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">
            <Button onClick={() => setModal({ type: "add-project" })}>
              <Plus size={16} />
              {t.customers.addProject}
            </Button>
          </div>

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
          <div className="flex justify-end">
            <Button onClick={() => setModal({ type: "upload-document" })}>
              <Plus size={16} />
              {t.customers.uploadDocument}
            </Button>
          </div>

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

      {tab === "related" && (
        <Card>
          <p className="text-secondary">{t.customers.relatedRecordsPlaceholder}</p>
        </Card>
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
