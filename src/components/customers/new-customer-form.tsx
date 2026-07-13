"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { createCustomerAction } from "@/app/(app)/customer/actions";
import { uploadDocumentAction } from "@/app/(app)/customer/document-actions";
import { CustomerDocumentType } from "@/generated/prisma/enums";

type ProjectDraft = {
  key: string;
  projectName: string;
  contactPerson: string;
  phoneNumber: string;
  description: string;
};

type DocumentDraft = {
  key: string;
  documentType: (typeof documentTypes)[number];
  customDocumentName: string;
  file: File | null;
};

const documentTypes = [
  CustomerDocumentType.REGISTRATION_CERTIFICATE,
  CustomerDocumentType.PIN_CERTIFICATE,
  CustomerDocumentType.CR12,
  CustomerDocumentType.OTHER,
] as const;

const ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png";

const ERROR_KEY: Record<string, string> = {
  COMPANY_NAME_REQUIRED: "requiredField",
  PIN_NUMBER_REQUIRED: "requiredField",
  COMPANY_NAME_TAKEN: "companyNameTaken",
  PIN_NUMBER_TAKEN: "pinNumberTaken",
  INVALID_PHONE: "invalidPhone",
  PROJECT_NAME_REQUIRED: "requiredField",
  PROJECT_CONTACT_REQUIRED: "requiredField",
};

function emptyProject(): ProjectDraft {
  return {
    key: crypto.randomUUID(),
    projectName: "",
    contactPerson: "",
    phoneNumber: "",
    description: "",
  };
}

function emptyDocument(): DocumentDraft {
  return {
    key: crypto.randomUUID(),
    documentType: CustomerDocumentType.REGISTRATION_CERTIFICATE,
    customDocumentName: "",
    file: null,
  };
}

export function NewCustomerForm() {
  const { t } = useLocale();
  const router = useRouter();

  const [companyName, setCompanyName] = useState("");
  const [pinNumber, setPinNumber] = useState("");
  const [registeredAddress, setRegisteredAddress] = useState("");
  const [mainContactPerson, setMainContactPerson] = useState("");
  const [mainPhoneNumber, setMainPhoneNumber] = useState("");
  const [projects, setProjects] = useState<ProjectDraft[]>([]);
  const [documents, setDocuments] = useState<DocumentDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const documentTypeLabel: Record<string, string> = {
    REGISTRATION_CERTIFICATE: t.customers.registrationCertificate,
    PIN_CERTIFICATE: t.customers.pinCertificate,
    CR12: t.customers.cr12,
    OTHER: t.customers.otherDocument,
  };

  const updateProject = (key: string, patch: Partial<ProjectDraft>) => {
    setProjects((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  };

  const updateDocument = (key: string, patch: Partial<DocumentDraft>) => {
    setDocuments((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!companyName.trim() || !pinNumber.trim()) {
      setError(t.customers.requiredField);
      return;
    }

    for (const doc of documents) {
      if (doc.documentType === CustomerDocumentType.OTHER && !doc.customDocumentName.trim()) {
        setError(t.customers.customDocumentNameRequired);
        return;
      }
      if (!doc.file) {
        setError(t.customers.fileRequired);
        return;
      }
    }

    setIsSubmitting(true);

    const result = await createCustomerAction({
      company: {
        companyName,
        pinNumber,
        registeredAddress,
        mainContactPerson,
        mainPhoneNumber,
      },
      projects: projects.map((p) => ({
        projectName: p.projectName,
        contactPerson: p.contactPerson,
        phoneNumber: p.phoneNumber,
        description: p.description,
      })),
    });

    if (!result.success) {
      setIsSubmitting(false);
      const key = ERROR_KEY[result.error] ?? "genericError";
      setError(t.customers[key as keyof typeof t.customers]);
      return;
    }

    for (const doc of documents) {
      if (!doc.file) continue;
      const formData = new FormData();
      formData.set("customerId", result.customerId);
      formData.set("projectId", "");
      formData.set("documentType", doc.documentType);
      formData.set("customDocumentName", doc.customDocumentName.trim());
      formData.set("file", doc.file);
      await uploadDocumentAction(formData);
    }

    setIsSubmitting(false);
    router.push(`/customer/${result.customerId}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-section">
      <PageHeader title={t.customers.createCustomerTitle} />

      <Card>
        <h2 className="section-title mb-4">{t.customers.companyInformation}</h2>
        <div className="form-grid">
          <FormField label={t.customers.companyName}>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
          </FormField>
          <FormField label={t.customers.pinNumber}>
            <Input value={pinNumber} onChange={(e) => setPinNumber(e.target.value)} required />
          </FormField>
          <FormField label={t.customers.registeredAddress}>
            <Input value={registeredAddress} onChange={(e) => setRegisteredAddress(e.target.value)} />
          </FormField>
          <FormField label={t.customers.mainContactPerson}>
            <Input value={mainContactPerson} onChange={(e) => setMainContactPerson(e.target.value)} />
          </FormField>
          <FormField label={t.customers.mainPhoneNumber}>
            <Input
              type="tel"
              placeholder="0712345678"
              value={mainPhoneNumber}
              onChange={(e) => setMainPhoneNumber(e.target.value)}
            />
          </FormField>
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="section-title">{t.customers.initialProjectInformation}</h2>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setProjects((prev) => [...prev, emptyProject()])}
          >
            <Plus size={16} />
            {t.customers.addProject}
          </Button>
        </div>

        {projects.length === 0 && (
          <p className="text-secondary">{t.customers.noProjectsYet}</p>
        )}

        <div className="flex flex-col gap-4">
          {projects.map((project, index) => (
            <div key={project.key} className="rounded-control border border-zinc-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="table-title">
                  {t.customers.projectName} #{index + 1}
                </span>
                <button
                  type="button"
                  className="btn-icon text-red-500 hover:bg-red-50"
                  onClick={() => setProjects((prev) => prev.filter((p) => p.key !== project.key))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <FormField label={t.customers.projectName}>
                <Input
                  value={project.projectName}
                  onChange={(e) => updateProject(project.key, { projectName: e.target.value })}
                  required
                />
              </FormField>
              <div className="form-grid mt-field">
                <FormField label={t.customers.contactPerson}>
                  <Input
                    value={project.contactPerson}
                    onChange={(e) => updateProject(project.key, { contactPerson: e.target.value })}
                    required
                  />
                </FormField>
                <FormField label={t.customers.phoneNumber}>
                  <Input
                    type="tel"
                    placeholder="0712345678"
                    value={project.phoneNumber}
                    onChange={(e) => updateProject(project.key, { phoneNumber: e.target.value })}
                    required
                  />
                </FormField>
              </div>
              <div className="mt-field">
                <FormField label={t.customers.description}>
                  <Textarea
                    value={project.description}
                    onChange={(e) => updateProject(project.key, { description: e.target.value })}
                  />
                </FormField>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="section-title">{t.customers.customerDocuments}</h2>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setDocuments((prev) => [...prev, emptyDocument()])}
          >
            <Plus size={16} />
            {t.customers.uploadDocument}
          </Button>
        </div>

        {documents.length === 0 && (
          <p className="text-secondary">{t.customers.noDocumentsYet}</p>
        )}

        <div className="flex flex-col gap-4">
          {documents.map((doc) => (
            <div key={doc.key} className="rounded-control border border-zinc-200 p-4">
              <div className="mb-3 flex justify-end">
                <button
                  type="button"
                  className="btn-icon text-red-500 hover:bg-red-50"
                  onClick={() => setDocuments((prev) => prev.filter((d) => d.key !== doc.key))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="form-grid">
                <FormField label={t.customers.documentType}>
                  <Select
                    value={doc.documentType}
                    onChange={(e) =>
                      updateDocument(doc.key, {
                        documentType: e.target.value as DocumentDraft["documentType"],
                      })
                    }
                  >
                    {documentTypes.map((type) => (
                      <option key={type} value={type}>
                        {documentTypeLabel[type]}
                      </option>
                    ))}
                  </Select>
                </FormField>
                {doc.documentType === CustomerDocumentType.OTHER && (
                  <FormField label={t.customers.customDocumentName}>
                    <Input
                      value={doc.customDocumentName}
                      onChange={(e) => updateDocument(doc.key, { customDocumentName: e.target.value })}
                      required
                    />
                  </FormField>
                )}
                <FormField label={t.customers.uploadDocument}>
                  <input
                    type="file"
                    accept={ACCEPT}
                    className="input h-auto py-1.5"
                    onChange={(e) => updateDocument(doc.key, { file: e.target.files?.[0] ?? null })}
                    required
                  />
                </FormField>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push("/customer")} disabled={isSubmitting}>
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t.common.save}
        </Button>
      </div>
    </form>
  );
}
