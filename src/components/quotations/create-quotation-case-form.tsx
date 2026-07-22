"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { createQuotationCaseAction } from "@/app/(app)/quotation/actions";
import type { CustomerOption } from "@/components/quotations/types";

const ERROR_KEY: Record<string, string> = {
  CUSTOMER_REQUIRED: "customerRequired",
  CUSTOMER_NOT_FOUND: "genericError",
  PROJECT_NOT_BELONG_TO_CUSTOMER: "projectNotBelongToCustomer",
  ENQUIRY_DATE_REQUIRED: "enquiryDateRequiredError",
  FORBIDDEN: "genericError",
  CREATE_FAILED: "caseCreateFailedError",
};

export function CreateQuotationCaseForm({ customers }: { customers: CustomerOption[] }) {
  const { t } = useLocale();
  const router = useRouter();

  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [enquiryDate, setEnquiryDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableProjects = useMemo(
    () => customers.find((c) => c.id === customerId)?.projects ?? [],
    [customers, customerId]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!customerId) {
      setError(t.quotations.customerRequired);
      return;
    }
    if (!enquiryDate) {
      setError(t.quotations.enquiryDateRequiredError);
      return;
    }

    setIsSubmitting(true);
    const result = await createQuotationCaseAction({
      customerId,
      projectId: projectId || null,
      enquiryDate,
    });
    setIsSubmitting(false);

    if (!result.success) {
      const key = ERROR_KEY[result.error] ?? "genericError";
      setError(t.quotations[key as keyof typeof t.quotations]);
      return;
    }
    router.push(`/quotation/case/${result.id}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-section">
      <PageHeader title={t.quotations.createCaseTitle} description={t.quotations.createCaseDescription} />

      <Card>
        <div className="form-grid">
          <FormField label={t.quotations.customer}>
            <Select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setProjectId("");
              }}
              required
            >
              <option value="">{t.quotations.selectCustomer}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName} ({c.customerNumber})
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t.quotations.project}>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!customerId}>
              <option value="">{t.quotations.noProject}</option>
              {availableProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.projectName}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t.quotations.enquiryDate}>
            <Input type="date" value={enquiryDate} onChange={(e) => setEnquiryDate(e.target.value)} required />
          </FormField>
        </div>

        <p className="text-secondary mt-4 text-sm">{t.quotations.insuranceTypesSelectedLaterHint}</p>

        {error && (
          <p role="alert" className="form-error mt-3">
            {error}
          </p>
        )}
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push("/quotation")} disabled={isSubmitting}>
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t.quotations.createCase}
        </Button>
      </div>
    </form>
  );
}
