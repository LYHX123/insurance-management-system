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
import { createBondRecordAction } from "@/app/(app)/policy/bond/actions";
import { BOND_TYPES } from "@/lib/policy/bondTypes";
import type { CustomerOption, BondType } from "@/components/policy/types";

// Passed only when this form is reached via the quotation detail page's
// "Create Policy" action (see policy/bond/new/page.tsx's "fromQuotationId"
// handling). bondType/customerPremium are prefilled "where reliable" — null
// whenever the quotation doesn't have exactly one matching structured Bond
// section, leaving those fields for the user to fill in same as a fully
// manual creation. Bond Amount is never prefilled — no single uniform amount
// field exists across the four structured Bond section-detail models (see
// new/page.tsx's comment), so it always requires manual entry/confirmation.
export type CreateBondRecordPrefill = {
  quotationId: string;
  quotationNumber: string;
  customerId: string;
  projectId: string | null;
  bondType: BondType | null;
  customerPremium: string | null;
};

const ERROR_KEY: Record<string, string> = {
  CUSTOMER_REQUIRED: "customerRequired",
  CUSTOMER_NOT_FOUND: "genericError",
  PROJECT_NOT_BELONG_TO_CUSTOMER: "projectNotBelongToCustomer",
  BOND_TYPE_REQUIRED: "bondTypeRequired",
  INVALID_BOND_TYPE: "bondTypeRequired",
  CUSTOM_BOND_TYPE_REQUIRED: "typeOfCustomBondRequired",
  BOND_AMOUNT_INVALID: "bondAmountInvalid",
  PROCESSING_DATE_REQUIRED: "processingDateRequired",
  DATES_REQUIRED: "datesRequired",
  EXPIRY_BEFORE_EFFECTIVE: "expiryBeforeEffective",
  CLIENT_PREMIUM_INVALID: "clientPremiumInvalid",
  INSURER_COST_INVALID: "insurerCostInvalid",
  FORBIDDEN: "genericError",
  CREATE_FAILED: "createFailedError",
  QUOTATION_NOT_ELIGIBLE: "quotationNotEligibleError",
  QUOTATION_CUSTOMER_MISMATCH: "genericError",
};

const today = () => new Date().toISOString().slice(0, 10);

export function CreateBondRecordForm({
  customers,
  prefill = null,
  ineligibleQuotation = null,
}: {
  customers: CustomerOption[];
  prefill?: CreateBondRecordPrefill | null;
  ineligibleQuotation?: { quotationId: string; quotationNumber: string } | null;
}) {
  const { t } = useLocale();
  const { cancelHref, buildSuccessHref } = useCreateFlowNavigation("/policy/bond");
  const router = useRouter();

  const bondTypeLabel: Record<BondType, string> = {
    TENDER_BOND: t.policy.bondTenderBond,
    PERFORMANCE_BOND: t.policy.bondPerformanceBond,
    ADVANCE_PAYMENT_GUARANTEE: t.policy.bondAdvancePaymentGuarantee,
    CUSTOM_BOND: t.policy.bondCustomBond,
  };

  const [processingDate, setProcessingDate] = useState(today());
  const [customerId, setCustomerId] = useState(prefill?.customerId ?? "");
  const [projectId, setProjectId] = useState(prefill?.projectId ?? "");
  const [bondType, setBondType] = useState<string>(prefill?.bondType ?? "");
  const [customBondType, setCustomBondType] = useState("");
  const [bondAmount, setBondAmount] = useState("");
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

  const handleBondTypeChange = (value: string) => {
    setBondType(value);
    // Cleared whenever the user switches away from CUSTOM_BOND, per spec —
    // never silently carried over to a different bond type.
    if (value !== "CUSTOM_BOND") setCustomBondType("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!customerId) {
      setError(t.policy.customerRequired);
      return;
    }
    if (!bondType) {
      setError(t.policy.bondTypeRequired);
      return;
    }
    if (bondType === "CUSTOM_BOND" && !customBondType.trim()) {
      setError(t.policy.typeOfCustomBondRequired);
      return;
    }
    if (!bondAmount || Number(bondAmount) <= 0) {
      setError(t.policy.bondAmountInvalid);
      return;
    }
    if (!effectiveDate || !expiryDate) {
      setError(t.policy.datesRequired);
      return;
    }

    setIsSubmitting(true);
    const result = await createBondRecordAction({
      processingDate,
      customerId,
      projectId: projectId || null,
      bondType,
      customBondType: bondType === "CUSTOM_BOND" ? customBondType : null,
      bondAmount,
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
    router.push(buildSuccessHref(`/policy/bond/${result.id}`));
  };

  if (ineligibleQuotation) {
    return (
      <div className="flex flex-col gap-section">
        <PageHeader title={t.policy.createBondTitle} description={t.policy.createBondDescription} />
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
      <PageHeader title={t.policy.createBondTitle} description={t.policy.createBondDescription} />

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
          <FormField label={t.policy.typeOfBond}>
            <Select value={bondType} onChange={(e) => handleBondTypeChange(e.target.value)} required>
              <option value="">{t.policy.selectTypeOfBond}</option>
              {BOND_TYPES.map((bt) => (
                <option key={bt} value={bt}>{bondTypeLabel[bt]}</option>
              ))}
            </Select>
          </FormField>

          {/* Conditional row: Type of Custom Bond (only for CUSTOM_BOND) + Bond Amount.
              When Type of Custom Bond is hidden, Bond Amount naturally flows into
              the grid's next slot (form-grid is a plain 2-col auto-flow grid) —
              no empty cell is left behind. */}
          {bondType === "CUSTOM_BOND" && (
            <FormField label={t.policy.typeOfCustomBond}>
              <Input value={customBondType} onChange={(e) => setCustomBondType(e.target.value)} required />
            </FormField>
          )}
          <FormField label={t.policy.bondAmount}>
            <MoneyInput value={bondAmount} onChange={setBondAmount} required />
          </FormField>

          {/* Insurer / Policy Number */}
          <FormField label={t.policy.insurerOptional}>
            <Input value={insurerName} onChange={(e) => setInsurerName(e.target.value)} />
          </FormField>
          <FormField label={t.policy.policyNumberOptional}>
            <Input value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
          </FormField>

          {/* Effective / Expiry */}
          <FormField label={t.policy.effectiveDate}>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
          </FormField>
          <FormField label={t.policy.expiryDate}>
            <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} required />
          </FormField>

          {/* Client Premium / Insurer Cost */}
          <FormField label={t.policy.clientPremium}>
            <MoneyInput value={customerPremium} onChange={setCustomerPremium} required />
          </FormField>
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
