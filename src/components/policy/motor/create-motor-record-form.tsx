"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
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
import type { CustomerOption } from "@/components/policy/types";

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
  COMMISSION_AMOUNT_INVALID: "commissionAmountInvalid",
  COMMISSION_DATE_REQUIRED: "commissionDateRequired",
  FORBIDDEN: "genericError",
  CREATE_FAILED: "createFailedError",
};

const today = () => new Date().toISOString().slice(0, 10);

export function CreateMotorRecordForm({ customers }: { customers: CustomerOption[] }) {
  const { t } = useLocale();
  const router = useRouter();

  const [processingDate, setProcessingDate] = useState(today());
  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [insuranceType, setInsuranceType] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [vehicleValue, setVehicleValue] = useState("");
  const [insurerName, setInsurerName] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [expiryDate, setExpiryDate] = useState("");
  const [customerPremium, setCustomerPremium] = useState("");
  const [insurerCost, setInsurerCost] = useState("");
  const [commissionReceived, setCommissionReceived] = useState(false);
  const [commissionAmount, setCommissionAmount] = useState("");
  const [commissionReceivedDate, setCommissionReceivedDate] = useState("");
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
    if (!effectiveDate || !expiryDate) {
      setError(t.policy.datesRequired);
      return;
    }
    if (commissionReceived && (!commissionAmount || Number(commissionAmount) < 0)) {
      setError(t.policy.commissionAmountInvalid);
      return;
    }
    if (commissionReceived && !commissionReceivedDate) {
      setError(t.policy.commissionDateRequired);
      return;
    }

    setIsSubmitting(true);
    const result = await createMotorRecordAction({
      processingDate,
      customerId,
      projectId: projectId || null,
      insuranceType,
      registrationNumber,
      vehicleValue: vehicleValue || null,
      insurerName: insurerName || null,
      policyNumber: policyNumber || null,
      effectiveDate,
      expiryDate,
      customerPremium,
      insurerCost,
      commissionReceived,
      commissionAmount: commissionReceived ? commissionAmount : null,
      commissionReceivedDate: commissionReceived ? commissionReceivedDate || null : null,
      remarks: remarks || null,
    });
    setIsSubmitting(false);

    if (!result.success) {
      const key = ERROR_KEY[result.error] ?? "genericError";
      setError(t.policy[key as keyof typeof t.policy]);
      return;
    }
    router.push(`/policy/motor/${result.id}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-section">
      <PageHeader title={t.policy.createTitle} description={t.policy.createDescription} />

      <Card>
        <div className="form-grid">
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
          <FormField label={t.policy.registrationNumber}>
            <Input value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value.toUpperCase())} required />
          </FormField>
          <FormField label={t.policy.vehicleValueOptional}>
            <MoneyInput value={vehicleValue} onChange={setVehicleValue} />
          </FormField>

          <FormField label={t.policy.insurerOptional}>
            <Input value={insurerName} onChange={(e) => setInsurerName(e.target.value)} />
          </FormField>
          <FormField label={t.policy.policyNumberOptional}>
            <Input value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
          </FormField>
          <div />

          <FormField label={t.policy.effectiveDate}>
            <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
          </FormField>
          <FormField label={t.policy.expiryDate}>
            <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} required />
          </FormField>
          <div />

          <FormField label={t.policy.clientPremium}>
            <MoneyInput value={customerPremium} onChange={setCustomerPremium} required />
          </FormField>
          <FormField label={t.policy.insurerCost}>
            <MoneyInput value={insurerCost} onChange={setInsurerCost} required />
          </FormField>
          <div />
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={commissionReceived}
              onChange={(e) => setCommissionReceived(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300"
            />
            {t.policy.commissionReceived}
          </label>
          {commissionReceived && (
            <>
              <FormField label={t.policy.commissionAmount}>
                <MoneyInput value={commissionAmount} onChange={setCommissionAmount} />
              </FormField>
              <FormField label={t.policy.commissionReceivedDateConditional}>
                <Input
                  type="date"
                  value={commissionReceivedDate}
                  onChange={(e) => setCommissionReceivedDate(e.target.value)}
                />
              </FormField>
            </>
          )}
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
        <Button type="button" variant="secondary" onClick={() => router.push("/policy/motor")} disabled={isSubmitting}>
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t.policy.createRecord}
        </Button>
      </div>
    </form>
  );
}
