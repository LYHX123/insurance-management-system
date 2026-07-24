"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pencil, ExternalLink } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput } from "@/components/ui/money-input";
import { formatMoney } from "@/components/ui/money-input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { updateMotorOverviewAction } from "@/app/(app)/policy/motor/actions";
import { MOTOR_COVER_TYPES } from "@/lib/policy/motorCoverTypes";
import type { MotorDetail, CustomerOption } from "@/components/policy/types";

const ERROR_KEY: Record<string, string> = {
  CUSTOMER_REQUIRED: "customerRequired",
  CUSTOMER_NOT_FOUND: "genericError",
  PROJECT_NOT_BELONG_TO_CUSTOMER: "projectNotBelongToCustomer",
  INSURANCE_TYPE_REQUIRED: "insuranceTypeRequired",
  REGISTRATION_NUMBER_REQUIRED: "registrationNumberRequired",
  EXPIRY_BEFORE_EFFECTIVE: "expiryBeforeEffective",
  RECORD_NOT_FOUND: "recordNotFound",
  FORBIDDEN: "genericError",
  UPDATE_FAILED: "updateFailedError",
};

export function MotorOverviewTab({ detail, customers }: { detail: MotorDetail; customers: CustomerOption[] }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });

  const [editing, setEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [processingDate, setProcessingDate] = useState(detail.processingDate.slice(0, 10));
  const [customerId, setCustomerId] = useState(detail.customerId);
  const [projectId, setProjectId] = useState(detail.projectId ?? "");
  const [insuranceType, setInsuranceType] = useState(detail.insuranceType);
  const [registrationNumber, setRegistrationNumber] = useState(detail.registrationNumber);
  const [vehicleValue, setVehicleValue] = useState(detail.vehicleValue ?? "");
  const [vehicleMake, setVehicleMake] = useState(detail.vehicleMake ?? "");
  const [vehicleModel, setVehicleModel] = useState(detail.vehicleModel ?? "");
  const [insurerName, setInsurerName] = useState(detail.insurerName ?? "");
  const [policyNumber, setPolicyNumber] = useState(detail.policyNumber ?? "");
  const [effectiveDate, setEffectiveDate] = useState(detail.effectiveDate.slice(0, 10));
  const [expiryDate, setExpiryDate] = useState(detail.expiryDate.slice(0, 10));
  const [customerPremium, setCustomerPremium] = useState(detail.customerPremium);
  const [insurerCost, setInsurerCost] = useState(detail.insurerCost);
  const [remarks, setRemarks] = useState(detail.remarks ?? "");

  const availableProjects = useMemo(
    () => customers.find((c) => c.id === customerId)?.projects ?? [],
    [customers, customerId]
  );

  const field = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-secondary">{label}</dt>
      <dd className="font-medium text-zinc-800">{value}</dd>
    </div>
  );

  const submit = async (cancelled: boolean) => {
    setError(null);
    setIsSubmitting(true);
    const result = await updateMotorOverviewAction(detail.id, {
      processingDate,
      customerId,
      projectId: projectId || null,
      insuranceType,
      registrationNumber,
      vehicleValue: vehicleValue || null,
      vehicleMake: vehicleMake || null,
      vehicleModel: vehicleModel || null,
      insurerName: insurerName || null,
      policyNumber: policyNumber || null,
      effectiveDate,
      expiryDate,
      customerPremium,
      insurerCost,
      remarks: remarks || null,
      cancelled,
    });
    setIsSubmitting(false);
    if (!result.success) {
      const key = ERROR_KEY[result.error] ?? "genericError";
      setError(t.policy[key as keyof typeof t.policy]);
      return;
    }
    setShowCancelConfirm(false);
    setEditing(false);
    router.refresh();
  };

  if (!editing) {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <div className="mb-4 flex justify-end">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil size={16} />
              {t.policy.editOverview}
            </Button>
          </div>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {field(t.policy.recordNumber, detail.recordNumber)}
            {field(t.policy.processingDate, dateFormatter.format(new Date(detail.processingDate)))}
            {field(t.policy.customer, detail.customerName)}
            {field(t.policy.project, detail.projectName || "—")}
            {field(t.policy.typeOfCover, detail.insuranceType)}
            {field(t.policy.registrationNumber, detail.registrationNumber)}
            {field(t.policy.vehicleValue, detail.vehicleValue ? formatMoney(detail.vehicleValue) : "—")}
            {field(t.policy.insurer, detail.insurerName || "—")}
            {field(t.policy.policyNumber, detail.policyNumber || "—")}
            {field(t.policy.effectiveDate, dateFormatter.format(new Date(detail.effectiveDate)))}
            {field(t.policy.expiryDate, dateFormatter.format(new Date(detail.expiryDate)))}
            {field(t.policy.source, detail.source === "MANUAL" ? t.policy.sourceManual : t.policy.sourceHistoricalImport)}
          </dl>
          {detail.remarks && (
            <div className="mt-4">
              <dt className="text-secondary">{t.policy.remarks}</dt>
              <dd className="mt-1 whitespace-pre-wrap text-zinc-800">{detail.remarks}</dd>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="section-title mb-4">{t.policy.sourceQuotationTitle}</h2>
          {detail.sourceQuotation ? (
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {field(t.policy.sourceQuotationNumber, detail.sourceQuotation.quotationNumber)}
              {detail.sourceQuotation.revisionCode && field(t.policy.sourceQuotationRevision, detail.sourceQuotation.revisionCode)}
              {field(t.policy.customer, detail.sourceQuotation.customerName)}
              {field(t.policy.project, detail.sourceQuotation.projectName || "—")}
              {field(t.policy.sourceQuotationDate, dateFormatter.format(new Date(detail.sourceQuotation.quotationDate)))}
              {field(t.policy.sourceQuotationTotalPremium, formatMoney(detail.sourceQuotation.grandTotal))}
              <div>
                <dt className="text-secondary">&nbsp;</dt>
                <dd>
                  <Link
                    href={`/quotation/${detail.sourceQuotation.id}`}
                    className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline"
                  >
                    <ExternalLink size={14} />
                    {t.policy.openQuotation}
                  </Link>
                </dd>
              </div>
            </dl>
          ) : detail.sourceQuotationSnapshot ? (
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {field(t.policy.sourceQuotationNumber, detail.sourceQuotationSnapshot.quotationNumber)}
              {detail.sourceQuotationSnapshot.revisionCode &&
                field(t.policy.sourceQuotationRevision, detail.sourceQuotationSnapshot.revisionCode)}
              {field(t.policy.sourceQuotationDate, dateFormatter.format(new Date(detail.sourceQuotationSnapshot.quotationDate)))}
              <div className="sm:col-span-2 lg:col-span-3">
                <p className="text-secondary text-sm">{t.policy.sourceQuotationUnavailable}</p>
              </div>
            </dl>
          ) : (
            <p className="text-secondary text-sm">{t.policy.noLinkedQuotation}</p>
          )}
        </Card>

        {detail.businessStatus !== "CANCELLED" && (
          <div className="flex justify-end">
            <Button variant="destructive" onClick={() => setShowCancelConfirm(true)}>
              {t.policy.cancelPolicy}
            </Button>
          </div>
        )}

        {showCancelConfirm && (
          <ConfirmDialog
            title={t.policy.cancelPolicyConfirmTitle}
            message={error ?? t.policy.cancelPolicyConfirmMessage}
            isSubmitting={isSubmitting}
            onConfirm={() => submit(true)}
            onClose={() => {
              setShowCancelConfirm(false);
              setError(null);
            }}
          />
        )}
      </div>
    );
  }

  return (
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
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.companyName} ({c.customerNumber})</option>
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
            {MOTOR_COVER_TYPES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
            {!MOTOR_COVER_TYPES.includes(insuranceType as (typeof MOTOR_COVER_TYPES)[number]) && (
              <option value={insuranceType}>{insuranceType}</option>
            )}
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

        <FormField label={t.policy.vehicleMake}>
          <Input value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} />
        </FormField>
        <FormField label={t.policy.vehicleModel}>
          <Input value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} />
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

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={isSubmitting}>
          {t.common.cancel}
        </Button>
        <Button type="button" onClick={() => submit(false)} disabled={isSubmitting}>
          {t.policy.saveOverview}
        </Button>
      </div>
    </Card>
  );
}
