"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale } from "@/i18n/locale-provider";
import { useCreateFlowNavigation } from "@/lib/navigation/useCreateFlowNavigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput } from "@/components/ui/money-input";
import { createWorkPermitRecordAction } from "@/app/(app)/policy/work-permit/actions";
import { WORK_PERMIT_TYPES } from "@/lib/policy/workPermitTypes";
import type { CustomerOption, WorkPermitType } from "@/components/policy/types";

// See work-permit/new/page.tsx's comment — no quotation data source exists
// for Type of Permit or Client Premium, so only customer/project/snapshot
// are ever prefilled.
export type CreateWorkPermitRecordPrefill = {
  quotationId: string;
  quotationNumber: string;
  customerId: string;
  projectId: string | null;
};

const ERROR_KEY: Record<string, string> = {
  CUSTOMER_REQUIRED: "customerRequired",
  CUSTOMER_NOT_FOUND: "genericError",
  PROJECT_NOT_BELONG_TO_CUSTOMER: "projectNotBelongToCustomer",
  PERMIT_TYPE_REQUIRED: "permitTypeRequired",
  INVALID_PERMIT_TYPE: "permitTypeRequired",
  OTHER_PERMIT_TYPE_REQUIRED: "otherPermitTypeRequired",
  AGENT_REQUIRED: "agentRequired",
  PROCESSING_DATE_REQUIRED: "processingDateRequired",
  DATES_REQUIRED: "datesRequired",
  EXPIRY_BEFORE_EFFECTIVE: "expiryBeforeEffective",
  CLIENT_PREMIUM_INVALID: "clientPremiumInvalid",
  AGENT_COST_INVALID: "agentCostInvalid",
  FORBIDDEN: "genericError",
  CREATE_FAILED: "createFailedError",
  QUOTATION_NOT_ELIGIBLE: "quotationNotEligibleError",
  QUOTATION_CUSTOMER_MISMATCH: "genericError",
};

const today = () => new Date().toISOString().slice(0, 10);

export function CreateWorkPermitRecordForm({
  customers,
  prefill = null,
  ineligibleQuotation = null,
}: {
  customers: CustomerOption[];
  prefill?: CreateWorkPermitRecordPrefill | null;
  ineligibleQuotation?: { quotationId: string; quotationNumber: string } | null;
}) {
  const { t } = useLocale();
  const { cancelHref, buildSuccessHref } = useCreateFlowNavigation("/policy/work-permit");
  const router = useRouter();

  const permitTypeLabel: Record<WorkPermitType, string> = {
    CLASS_D: t.policy.permitClassD,
    CLASS_G: t.policy.permitClassG,
    SPECIAL_PASS: t.policy.permitSpecialPass,
    DEPENDANT_PASS: t.policy.permitDependantPass,
    OTHER: t.policy.permitOther,
  };

  const [processingDate, setProcessingDate] = useState(today());
  const [customerId, setCustomerId] = useState(prefill?.customerId ?? "");
  const [projectId, setProjectId] = useState(prefill?.projectId ?? "");
  const [permitType, setPermitType] = useState<string>("");
  const [otherPermitType, setOtherPermitType] = useState("");
  const [agent, setAgent] = useState("");
  const [permitNumber, setPermitNumber] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [expiryDate, setExpiryDate] = useState("");
  const [customerPremium, setCustomerPremium] = useState("");
  const [agentCost, setAgentCost] = useState("");
  const [remarks, setRemarks] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableProjects = useMemo(
    () => customers.find((c) => c.id === customerId)?.projects ?? [],
    [customers, customerId]
  );

  const handlePermitTypeChange = (value: string) => {
    setPermitType(value);
    if (value !== "OTHER") setOtherPermitType("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!customerId) {
      setError(t.policy.customerRequired);
      return;
    }
    if (!permitType) {
      setError(t.policy.permitTypeRequired);
      return;
    }
    if (permitType === "OTHER" && !otherPermitType.trim()) {
      setError(t.policy.otherPermitTypeRequired);
      return;
    }
    if (!agent.trim()) {
      setError(t.policy.agentRequired);
      return;
    }
    if (!effectiveDate || !expiryDate) {
      setError(t.policy.datesRequired);
      return;
    }

    setIsSubmitting(true);
    const result = await createWorkPermitRecordAction({
      processingDate,
      customerId,
      projectId: projectId || null,
      permitType,
      otherPermitType: permitType === "OTHER" ? otherPermitType : null,
      agent,
      permitNumber: permitNumber || null,
      effectiveDate,
      expiryDate,
      customerPremium,
      agentCost,
      remarks: remarks || null,
      sourceQuotationId: prefill?.quotationId ?? null,
    });
    setIsSubmitting(false);

    if (!result.success) {
      const key = ERROR_KEY[result.error] ?? "genericError";
      setError(t.policy[key as keyof typeof t.policy]);
      return;
    }
    router.push(buildSuccessHref(`/policy/work-permit/${result.id}`));
  };

  if (ineligibleQuotation) {
    return (
      <div className="flex flex-col gap-section">
        <PageHeader title={t.policy.createWorkPermitTitle} description={t.policy.createWorkPermitDescription} />
        <div className="rounded-control border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {t.quotations.policyCreationIneligibleHint}
        </div>
        <div>
          <Link href={`/quotation/${ineligibleQuotation.quotationId}`} className="text-sm font-medium text-emerald-700 hover:underline">
            {t.quotations.view} — {ineligibleQuotation.quotationNumber}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-section">
      <PageHeader title={t.policy.createWorkPermitTitle} description={t.policy.createWorkPermitDescription} />

      {prefill && (
        <div className="rounded-control border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {t.policy.creatingFromQuotation.replace("{number}", prefill.quotationNumber)}{" "}
          <Link href={`/quotation/${prefill.quotationId}`} className="font-medium underline">
            {t.quotations.view}
          </Link>
        </div>
      )}

      <Card>
        <div className="form-grid">
          {/* Row 1 */}
          <FormField label={t.policy.processingDate}>
            <Input type="date" value={processingDate} onChange={(e) => setProcessingDate(e.target.value)} required />
          </FormField>
          <FormField label={t.policy.customer}>
            <Select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setProjectId("");
              }}
              required
            >
              <option value="">{t.policy.selectCustomer}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName} ({c.customerNumber})
                </option>
              ))}
            </Select>
          </FormField>

          {/* Row 2 */}
          <FormField label={t.policy.projectOptional}>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!customerId}>
              <option value="">{t.policy.noProject}</option>
              {availableProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.projectName}</option>
              ))}
            </Select>
          </FormField>
          <FormField label={t.policy.typeOfPermit}>
            <Select value={permitType} onChange={(e) => handlePermitTypeChange(e.target.value)} required>
              <option value="">{t.policy.selectTypeOfPermit}</option>
              {WORK_PERMIT_TYPES.map((pt) => (
                <option key={pt} value={pt}>{permitTypeLabel[pt]}</option>
              ))}
            </Select>
          </FormField>

          {/* Row 3: Agent / Permit Number (Other Permit Type inserts here when
              permitType = OTHER, then Permit Number auto-flows to the next
              slot — same auto-flow grid behavior as Bond's conditional row) */}
          <FormField label={t.policy.agent}>
            <Input value={agent} onChange={(e) => setAgent(e.target.value)} required />
          </FormField>
          {permitType === "OTHER" && (
            <FormField label={t.policy.otherPermitType}>
              <Input value={otherPermitType} onChange={(e) => setOtherPermitType(e.target.value)} required />
            </FormField>
          )}
          <FormField label={t.policy.permitNumberOptional}>
            <Input value={permitNumber} onChange={(e) => setPermitNumber(e.target.value)} />
          </FormField>

          {/* Row 4 */}
          <FormField label={t.policy.effectiveDate}>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
          </FormField>
          <FormField label={t.policy.expiryDate}>
            <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} required />
          </FormField>

          {/* Row 5 */}
          <FormField label={t.policy.clientPremium}>
            <MoneyInput value={customerPremium} onChange={setCustomerPremium} required />
          </FormField>
          <FormField label={t.policy.agentCost}>
            <MoneyInput value={agentCost} onChange={setAgentCost} required />
          </FormField>
        </div>

        <div className="mt-4">
          <FormField label={t.policy.remarks}>
            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} />
          </FormField>
        </div>

        {error && (
          <p role="alert" className="form-error mt-3">
            {error}
          </p>
        )}
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push(cancelHref)} disabled={isSubmitting}>
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t.policy.createRecord}
        </Button>
      </div>
    </form>
  );
}
