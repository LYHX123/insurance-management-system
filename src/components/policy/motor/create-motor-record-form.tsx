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
import { createMotorRecordAction } from "@/app/(app)/policy/motor/actions";
import { MOTOR_COVER_TYPES } from "@/lib/policy/motorCoverTypes";
import { MOTOR_TAX_CLASSES } from "@/lib/policy/motorTaxClasses";
import type { CustomerOption } from "@/components/policy/types";

// Phase 2A: passed only when this form is reached via the quotation detail
// page's "Create Policy" action (see policy/motor/new/page.tsx's
// "fromQuotationId" handling). insuranceType/customerPremium are prefilled
// "where applicable" — null whenever the quotation doesn't have exactly one
// Motor-kind section, leaving those two fields for the user to fill in same
// as a fully manual creation.
export type CreateMotorRecordPrefill = {
  quotationId: string;
  quotationNumber: string;
  customerId: string;
  projectId: string | null;
  insuranceType: string | null;
  customerPremium: string | null;
};

const ERROR_KEY: Record<string, string> = {
  CUSTOMER_REQUIRED: "customerRequired",
  CUSTOMER_NOT_FOUND: "genericError",
  PROJECT_NOT_BELONG_TO_CUSTOMER: "projectNotBelongToCustomer",
  INSURANCE_TYPE_REQUIRED: "insuranceTypeRequired",
  REGISTRATION_NUMBER_REQUIRED: "registrationNumberRequired",
  PROCESSING_DATE_REQUIRED: "processingDateRequired",
  DATES_REQUIRED: "datesRequired",
  EXPIRY_BEFORE_EFFECTIVE: "expiryBeforeEffective",
  CLIENT_PREMIUM_INVALID: "clientPremiumInvalid",
  INSURER_COST_INVALID: "insurerCostInvalid",
  TAX_CLASS_REQUIRED: "taxClassRequired",
  INVALID_TAX_CLASS: "taxClassRequired",
  FORBIDDEN: "genericError",
  CREATE_FAILED: "createFailedError",
  QUOTATION_NOT_ELIGIBLE: "quotationNotEligibleError",
};

const today = () => new Date().toISOString().slice(0, 10);

export function CreateMotorRecordForm({
  customers,
  prefill = null,
  ineligibleQuotation = null,
}: {
  customers: CustomerOption[];
  prefill?: CreateMotorRecordPrefill | null;
  // Phase 2B: set when ?fromQuotationId= pointed at a real quotation that is
  // not in an eligible finalized state (ISSUED/ACCEPTED) — blocks the form
  // entirely rather than silently falling back to a blank manual form, so
  // the restriction can't be defeated by simply ignoring the failed prefill.
  ineligibleQuotation?: { quotationId: string; quotationNumber: string } | null;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const { cancelHref, buildSuccessHref } = useCreateFlowNavigation("/policy/motor");

  const taxClassLabel: Record<string, string> = {
    PRIVATE: t.policy.taxClassPrivate,
    COMMERCIAL: t.policy.taxClassCommercial,
    SPV: t.policy.taxClassSpv,
    SPECIAL_USE: t.policy.taxClassSpecialUse,
  };

  const [processingDate, setProcessingDate] = useState(today());
  const [customerId, setCustomerId] = useState(prefill?.customerId ?? "");
  const [projectId, setProjectId] = useState(prefill?.projectId ?? "");
  const [insuranceType, setInsuranceType] = useState(prefill?.insuranceType ?? "");
  const [registrationNumber, setRegistrationNumber] = useState("");
  // Phase 2B: never prefilled from a quotation — no quotation section has a
  // directly equivalent, reliable Tax Class field (see
  // CreateMotorRecordPrefill's doc comment) — always starts blank and the
  // user must choose, for both manual and quotation-linked creation alike.
  const [taxClass, setTaxClass] = useState("");
  const [vehicleValue, setVehicleValue] = useState("");
  const [insurerName, setInsurerName] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [expiryDate, setExpiryDate] = useState("");
  const [customerPremium, setCustomerPremium] = useState(prefill?.customerPremium ?? "");
  const [insurerCost, setInsurerCost] = useState("");
  const [remarks, setRemarks] = useState("");

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
      setError(t.policy.customerRequired);
      return;
    }
    if (!insuranceType) {
      setError(t.policy.insuranceTypeRequired);
      return;
    }
    if (!registrationNumber.trim()) {
      setError(t.policy.registrationNumberRequired);
      return;
    }
    if (!taxClass) {
      setError(t.policy.taxClassRequired);
      return;
    }
    if (!effectiveDate || !expiryDate) {
      setError(t.policy.datesRequired);
      return;
    }

    setIsSubmitting(true);
    const result = await createMotorRecordAction({
      processingDate,
      customerId,
      projectId: projectId || null,
      insuranceType,
      registrationNumber,
      taxClass,
      vehicleValue: vehicleValue || null,
      insurerName: insurerName || null,
      policyNumber: policyNumber || null,
      effectiveDate,
      expiryDate,
      customerPremium,
      insurerCost,
      remarks: remarks || null,
      sourceQuotationId: prefill?.quotationId ?? null,
    });
    setIsSubmitting(false);

    if (!result.success) {
      const key = ERROR_KEY[result.error] ?? "genericError";
      setError(t.policy[key as keyof typeof t.policy]);
      return;
    }
    router.push(buildSuccessHref(`/policy/motor/${result.id}`));
  };

  if (ineligibleQuotation) {
    return (
      <div className="flex flex-col gap-section">
        <PageHeader title={t.policy.createTitle} description={t.policy.createDescription} />
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
      <PageHeader title={t.policy.createTitle} description={t.policy.createDescription} />

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
          <FormField label={t.policy.typeOfCover}>
            <Select value={insuranceType} onChange={(e) => setInsuranceType(e.target.value)} required>
              <option value="">{t.policy.selectTypeOfCover}</option>
              {MOTOR_COVER_TYPES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </FormField>

          {/* Row 3 */}
          <FormField label={t.policy.registrationNumber}>
            <Input value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value.toUpperCase())} required />
          </FormField>
          <FormField label={t.policy.taxClass}>
            <Select value={taxClass} onChange={(e) => setTaxClass(e.target.value)} required>
              <option value="">{t.policy.selectTaxClass}</option>
              {MOTOR_TAX_CLASSES.map((c) => (
                <option key={c} value={c}>{taxClassLabel[c]}</option>
              ))}
            </Select>
          </FormField>

          {/* Row 4 */}
          <FormField label={t.policy.vehicleValueOptional}>
            <MoneyInput value={vehicleValue} onChange={setVehicleValue} />
          </FormField>
          <FormField label={t.policy.policyNumberOptional}>
            <Input value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
          </FormField>

          {/* Row 5 */}
          <FormField label={t.policy.insurerOptional}>
            <Input value={insurerName} onChange={(e) => setInsurerName(e.target.value)} />
          </FormField>
          <FormField label={t.policy.effectiveDate}>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
          </FormField>

          {/* Row 6 */}
          <FormField label={t.policy.expiryDate}>
            <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} required />
          </FormField>
          <FormField label={t.policy.clientPremium}>
            <MoneyInput value={customerPremium} onChange={setCustomerPremium} required />
          </FormField>

          {/* Row 7 */}
          <FormField label={t.policy.insurerCost}>
            <MoneyInput value={insurerCost} onChange={setInsurerCost} required />
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
