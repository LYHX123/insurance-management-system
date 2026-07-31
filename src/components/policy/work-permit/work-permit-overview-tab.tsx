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
import { TypedConfirmDialog } from "@/components/ui/typed-confirm-dialog";
import { RelatedInvoiceCard } from "@/components/policy/related-invoice-card";
import { updateWorkPermitOverviewAction, deleteWorkPermitPolicyAction } from "@/app/(app)/policy/work-permit/actions";
import { WORK_PERMIT_TYPES } from "@/lib/policy/workPermitTypes";
import type { WorkPermitDetail, CustomerOption, WorkPermitType } from "@/components/policy/types";

const ERROR_KEY: Record<string, string> = {
  CUSTOMER_REQUIRED: "customerRequired",
  CUSTOMER_NOT_FOUND: "genericError",
  PROJECT_NOT_BELONG_TO_CUSTOMER: "projectNotBelongToCustomer",
  PERMIT_TYPE_REQUIRED: "permitTypeRequired",
  INVALID_PERMIT_TYPE: "permitTypeRequired",
  OTHER_PERMIT_TYPE_REQUIRED: "otherPermitTypeRequired",
  AGENT_REQUIRED: "agentRequired",
  CLIENT_PREMIUM_INVALID: "clientPremiumInvalid",
  AGENT_COST_INVALID: "agentCostInvalid",
  EXPIRY_BEFORE_EFFECTIVE: "expiryBeforeEffective",
  RECORD_NOT_FOUND: "recordNotFound",
  FORBIDDEN: "genericError",
  UPDATE_FAILED: "updateFailedError",
};

// Deliberately never shows Insurer or "Insurer Cost" wording anywhere in
// this tab — see WorkPermitDetail's type comment. Agent Cost reads and
// writes the shared PolicyRecord.insurerCost column under the hood.
export function WorkPermitOverviewTab({
  detail,
  customers,
  isAdmin,
}: {
  detail: WorkPermitDetail;
  customers: CustomerOption[];
  isAdmin: boolean;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });

  const [editing, setEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [processingDate, setProcessingDate] = useState(detail.processingDate.slice(0, 10));
  const [customerId, setCustomerId] = useState(detail.customerId);
  const [projectId, setProjectId] = useState(detail.projectId ?? "");
  const [permitType, setPermitType] = useState<string>(detail.permitType);
  const [otherPermitType, setOtherPermitType] = useState(detail.otherPermitType ?? "");
  const [agent, setAgent] = useState(detail.agent);
  const [permitNumber, setPermitNumber] = useState(detail.permitNumber ?? "");
  const [effectiveDate, setEffectiveDate] = useState(detail.effectiveDate.slice(0, 10));
  const [expiryDate, setExpiryDate] = useState(detail.expiryDate.slice(0, 10));
  const [customerPremium, setCustomerPremium] = useState(detail.customerPremium);
  const [agentCost, setAgentCost] = useState(detail.insurerCost);
  const [remarks, setRemarks] = useState(detail.remarks ?? "");

  const availableProjects = useMemo(
    () => customers.find((c) => c.id === customerId)?.projects ?? [],
    [customers, customerId]
  );

  const permitTypeLabel: Record<WorkPermitType, string> = {
    CLASS_D: t.policy.permitClassD,
    CLASS_G: t.policy.permitClassG,
    SPECIAL_PASS: t.policy.permitSpecialPass,
    DEPENDANT_PASS: t.policy.permitDependantPass,
    OTHER: t.policy.permitOther,
  };

  const field = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-secondary">{label}</dt>
      <dd className="font-medium text-zinc-800">{value}</dd>
    </div>
  );

  const handlePermitTypeChange = (value: string) => {
    setPermitType(value);
    if (value !== "OTHER") setOtherPermitType("");
  };

  const submit = async (cancelled: boolean) => {
    setError(null);
    if (!cancelled && permitType === "OTHER" && !otherPermitType.trim()) {
      setError(t.policy.otherPermitTypeRequired);
      return;
    }
    setIsSubmitting(true);
    const result = await updateWorkPermitOverviewAction(detail.id, {
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

  const handleDelete = async (typedRecordNumber: string) => {
    setDeleteError(null);
    setIsDeleting(true);
    const result = await deleteWorkPermitPolicyAction(detail.id, typedRecordNumber);
    setIsDeleting(false);
    if (!result.success) {
      if (result.error === "INVOICE_LINKED") {
        setDeleteError(t.policy.deletePolicyInvoiceLinked.replace("{invoiceNumbers}", (result.invoiceNumbers ?? []).join(", ")));
      } else if (result.error === "FORBIDDEN") {
        setDeleteError(t.policy.genericError);
      } else if (result.error === "CONFIRMATION_MISMATCH") {
        setDeleteError(t.policy.deletePolicyConfirmationMismatch);
      } else {
        setDeleteError(t.policy.deletePolicyDeleteFailedError);
      }
      return;
    }
    router.replace(`/policy/work-permit?deleted=${encodeURIComponent(result.recordNumber)}`);
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
            {field(t.policy.typeOfPermit, permitTypeLabel[detail.permitType])}
            {detail.permitType === "OTHER" && field(t.policy.otherPermitType, detail.otherPermitType || "—")}
            {field(t.policy.agent, detail.agent)}
            {field(t.policy.permitNumber, detail.permitNumber || "—")}
            {field(t.policy.effectiveDate, dateFormatter.format(new Date(detail.effectiveDate)))}
            {field(t.policy.expiryDate, dateFormatter.format(new Date(detail.expiryDate)))}
            {field(t.policy.clientPremium, formatMoney(detail.customerPremium))}
            {field(t.policy.agentCost, formatMoney(detail.insurerCost))}
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

        <RelatedInvoiceCard
          policyRecordId={detail.id}
          businessStatus={detail.businessStatus}
          hasPolicyNumber={!!detail.permitNumber}
          relatedInvoice={detail.relatedInvoice}
        />

        {(detail.businessStatus !== "CANCELLED" || isAdmin) && (
          <div className="flex justify-end gap-2">
            {detail.businessStatus !== "CANCELLED" && (
              <Button variant="destructive" onClick={() => setShowCancelConfirm(true)}>
                {t.policy.cancelPolicy}
              </Button>
            )}
            {isAdmin && (
              <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
                {t.policy.deletePolicy}
              </Button>
            )}
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

        {showDeleteConfirm && (
          <TypedConfirmDialog
            title={t.policy.deletePolicyConfirmTitle}
            message={`${deleteError ?? t.policy.deletePolicyConfirmMessage} ${t.policy.dropboxRetentionNote} ${t.policy.deletePolicyConfirmInstruction.replace("{recordNumber}", detail.recordNumber)}`}
            confirmLabel={t.policy.deletePolicyConfirmButton}
            confirmValue={detail.recordNumber}
            isSubmitting={isDeleting}
            onConfirm={handleDelete}
            onClose={() => {
              setShowDeleteConfirm(false);
              setDeleteError(null);
            }}
          />
        )}
      </div>
    );
  }

  return (
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
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.companyName} ({c.customerNumber})</option>
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
            {WORK_PERMIT_TYPES.map((pt) => (
              <option key={pt} value={pt}>{permitTypeLabel[pt]}</option>
            ))}
          </Select>
        </FormField>

        {/* Row 3: Agent / Permit Number (Other Permit Type inserts when OTHER) */}
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

        {/* Effective / Expiry */}
        <FormField label={t.policy.effectiveDate}>
          <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} required />
        </FormField>
        <FormField label={t.policy.expiryDate}>
          <Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} required />
        </FormField>

        {/* Client Premium / Agent Cost */}
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
