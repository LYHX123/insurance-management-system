"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { formatMoney } from "@/components/ui/money-input";
import { createInvoiceAction } from "@/app/(app)/invoice/actions";
import type { EligiblePolicyRow } from "@/lib/invoice/eligibility";
import type { PolicyCategory } from "@/generated/prisma/enums";

const POLICY_CATEGORY_ROUTE: Record<PolicyCategory, string> = {
  MOTOR: "/policy/motor",
  NON_MOTOR: "/policy/non-motor",
  BOND: "/policy/bond",
  WORK_PERMIT: "/policy/work-permit",
};

export type CreateInvoiceBlockedReason =
  | "NOT_FOUND"
  | "CANCELLED_POLICY"
  | "MISSING_POLICY_NUMBER"
  | "ALREADY_INVOICED"
  | "MISSING_DETAIL";

const ERROR_KEY: Record<string, string> = {
  CUSTOMER_REQUIRED: "customerRequired",
  CUSTOMER_NOT_FOUND: "customerNotFound",
  NO_POLICIES_SELECTED: "noPoliciesSelected",
  INVOICE_DATE_REQUIRED: "invoiceDateRequired",
  POLICY_NOT_FOUND: "policyNotFound",
  POLICY_CUSTOMER_MISMATCH: "policyCustomerMismatch",
  TEMPLATE_INVALID: "templateInvalid",
  GENERATION_FAILED: "generationFailed",
  CREATE_FAILED: "createFailed",
  FILE_SAVE_FAILED: "fileSaveFailed",
  FORBIDDEN: "genericError",
};

const today = () => new Date().toISOString().slice(0, 10);

export function CreateInvoiceForm({
  blocked,
  customerId,
  customerName,
  customerPin,
  policies,
  defaultSelectedPolicyId,
}: {
  blocked: { reason: CreateInvoiceBlockedReason; policyId: string; category: PolicyCategory | null; recordNumber: string | null } | null;
  customerId: string;
  customerName: string;
  customerPin: string;
  policies: EligiblePolicyRow[];
  defaultSelectedPolicyId: string;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });

  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelectedPolicyId ? [defaultSelectedPolicyId] : []));
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedPolicies = useMemo(() => policies.filter((p) => selected.has(p.id)), [policies, selected]);
  const totalPremium = useMemo(
    () => selectedPolicies.reduce((sum, p) => sum + Number(p.clientPremium), 0),
    [selectedPolicies]
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (selected.size === 0) {
      setError(t.invoice.atLeastOnePolicyRequired);
      return;
    }
    if (!invoiceDate) {
      setError(t.invoice.invoiceDateRequired);
      return;
    }
    setIsSubmitting(true);
    const result = await createInvoiceAction({
      customerId,
      policyRecordIds: [...selected],
      invoiceDate,
    });
    setIsSubmitting(false);
    if (!result.success) {
      const key = result.error.startsWith("POLICY_NOT_ELIGIBLE_") ? "policyNotEligible" : ERROR_KEY[result.error] ?? "genericError";
      setError(t.invoice[key as keyof typeof t.invoice]);
      return;
    }
    router.push(`/invoice/${result.id}`);
  };

  if (blocked) {
    const backRoute = blocked.category ? `${POLICY_CATEGORY_ROUTE[blocked.category]}/${blocked.policyId}` : "/invoice";
    const reasonText: Record<CreateInvoiceBlockedReason, string> = {
      NOT_FOUND: t.invoice.policyNotFound,
      CANCELLED_POLICY: t.invoice.createInvoiceBlockedCancelled,
      MISSING_POLICY_NUMBER: t.invoice.createInvoiceBlockedMissingNumber,
      ALREADY_INVOICED: t.invoice.createInvoiceBlockedAlreadyInvoiced,
      MISSING_DETAIL: t.invoice.genericError,
    };
    return (
      <div className="flex flex-col gap-section">
        <PageHeader title={t.invoice.createTitle} />
        <div className="rounded-control border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{reasonText[blocked.reason]}</div>
        <div>
          <Link href={backRoute} className="text-sm font-medium text-emerald-700 hover:underline">
            {t.invoice.backToList}
            {blocked.recordNumber ? ` — ${blocked.recordNumber}` : ""}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-section">
      <PageHeader title={t.invoice.createTitle} description={t.invoice.createDescription} />

      <Card>
        <dl className="form-grid">
          <div>
            <dt className="text-secondary">{t.invoice.customer}</dt>
            <dd className="font-medium text-zinc-800">{customerName}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.invoice.customerPin}</dt>
            <dd className="font-medium text-zinc-800">{customerPin}</dd>
          </div>
        </dl>
        <div className="mt-4 max-w-xs">
          <label className="mb-1 block text-sm font-medium text-zinc-700">{t.invoice.invoiceDate}</label>
          <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
        </div>
      </Card>

      <Card>
        <h2 className="section-title mb-4">{t.invoice.selectPoliciesTitle}</h2>
        <TableWrap scroll>
          <Table className="min-w-[900px]">
            <thead>
              <tr>
                <th>{t.invoice.colSelect}</th>
                <th>{t.policy.recordNumber}</th>
                <th>{t.invoice.colPolicyClass}</th>
                <th>{t.invoice.colPolicyNumber}</th>
                <th>{t.invoice.colEffectiveDate}</th>
                <th>{t.invoice.colExpiryDate}</th>
                <th>{t.invoice.colClientPremium}</th>
              </tr>
            </thead>
            <tbody>
              {policies.length === 0 && <TableEmpty colSpan={7}>{t.invoice.noEligiblePolicies}</TableEmpty>}
              {policies.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                  </td>
                  <td className="font-medium text-zinc-800">{p.recordNumber}</td>
                  <td className="text-zinc-500">{p.policyClass}</td>
                  <td className="text-zinc-500">{p.policyNumber}</td>
                  <td className="text-zinc-500">{dateFormatter.format(new Date(p.effectiveDate))}</td>
                  <td className="text-zinc-500">{dateFormatter.format(new Date(p.expiryDate))}</td>
                  <td className="text-zinc-500">{formatMoney(p.clientPremium)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-700">{t.invoice.totalPremium}</span>
          <span className="text-lg font-semibold text-zinc-800">{formatMoney(totalPremium.toFixed(2))}</span>
        </div>
      </Card>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push("/invoice")} disabled={isSubmitting}>
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t.invoice.generateInvoice}
        </Button>
      </div>
    </form>
  );
}
