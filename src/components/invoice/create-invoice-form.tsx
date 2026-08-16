"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

const OTHER_GROUP_KEY = "__other__";

// Phase 5 "Combined Invoice grouping" — one group per distinct
// quotationCaseId among the eligible/already-invoiced policies for this
// customer, plus one final group (OTHER_GROUP_KEY) for every policy with no
// quotation source at all (quotationCaseId === null — manual/historical
// records). Never groups by Revision (Part 11 of this phase's spec: the
// business view is the whole Quotation Case, not R01/R02/R03 individually)
// — quotationCaseId is already the right granularity for that.
type PolicyGroup = {
  key: string;
  quotationNumber: string | null;
  rows: EligiblePolicyRow[];
};

function buildGroups(policies: EligiblePolicyRow[], sourcePolicyId: string): PolicyGroup[] {
  const byCase = new Map<string, PolicyGroup>();
  const other: EligiblePolicyRow[] = [];
  for (const p of policies) {
    if (p.quotationCaseId) {
      const existing = byCase.get(p.quotationCaseId);
      if (existing) existing.rows.push(p);
      else byCase.set(p.quotationCaseId, { key: p.quotationCaseId, quotationNumber: p.quotationNumber, rows: [p] });
    } else {
      other.push(p);
    }
  }

  const sourceCaseId = policies.find((p) => p.id === sourcePolicyId)?.quotationCaseId ?? null;
  const groups = [...byCase.values()].sort((a, b) => {
    if (a.key === sourceCaseId) return -1;
    if (b.key === sourceCaseId) return 1;
    return (a.quotationNumber ?? "").localeCompare(b.quotationNumber ?? "");
  });
  if (other.length > 0) groups.push({ key: OTHER_GROUP_KEY, quotationNumber: null, rows: other });
  return groups;
}

// Phase 3 Part 6 default-selection rule: the launching Policy is always
// selected; every OTHER eligible policy that shares its quotationCaseId is
// also default-selected (the "same Quotation Case, batch-generated
// together" case this phase exists for). Everything else — other quotation
// cases, and every policy with no quotation source — starts unselected but
// remains fully selectable (Part 3: "不要做硬性限制…因为真实业务可能需要跨报价组合
// Invoice").
function defaultSelection(policies: EligiblePolicyRow[], sourcePolicyId: string): Set<string> {
  const selected = new Set<string>();
  if (sourcePolicyId) selected.add(sourcePolicyId);
  const sourceRow = policies.find((p) => p.id === sourcePolicyId);
  if (sourceRow?.quotationCaseId) {
    for (const p of policies) {
      if (p.quotationCaseId === sourceRow.quotationCaseId && p.isEligible) selected.add(p.id);
    }
  }
  return selected;
}

export function CreateInvoiceForm({
  blocked,
  customerId,
  customerName,
  customerPin,
  policies,
  defaultSelectedPolicyId,
  sourcePolicy,
  sourcePolicyReturnTo,
}: {
  blocked: { reason: CreateInvoiceBlockedReason; policyId: string; category: PolicyCategory | null; recordNumber: string | null } | null;
  customerId: string;
  customerName: string;
  customerPin: string;
  policies: EligiblePolicyRow[];
  defaultSelectedPolicyId: string;
  // The Policy this invoice creation was launched from — Cancel and the
  // newly-created invoice's own back button both return here instead of
  // the generic /invoice list (Phase 8 Part 2.B fix: this used to always
  // send Cancel to /invoice regardless of where the user came from).
  sourcePolicy?: { id: string; category: PolicyCategory } | null;
  // Phase 8.1 Part 9 — the Policy Detail page's own current URL (its own
  // tab/returnTo included), validated server-side. When present, this is
  // used instead of the bare category route so the round trip doesn't
  // strand the user on a Policy Detail page that's forgotten how to get
  // back to whatever list/tab it was itself reached from.
  sourcePolicyReturnTo?: string | null;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });
  const sourcePolicyHref = sourcePolicyReturnTo ?? (sourcePolicy ? `${POLICY_CATEGORY_ROUTE[sourcePolicy.category]}/${sourcePolicy.id}` : "/invoice");

  const [selected, setSelected] = useState<Set<string>>(() => defaultSelection(policies, defaultSelectedPolicyId));
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const groups = useMemo(() => buildGroups(policies, defaultSelectedPolicyId), [policies, defaultSelectedPolicyId]);

  const selectedPolicies = useMemo(() => policies.filter((p) => selected.has(p.id)), [policies, selected]);
  const totalPremium = useMemo(
    () => selectedPolicies.reduce((sum, p) => sum + Number(p.clientPremium), 0),
    [selectedPolicies]
  );

  const toggle = (row: EligiblePolicyRow) => {
    if (!row.isEligible) return; // Part 7: an already-invoiced row can never be (de)selected
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
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
    // Server Action re-validates every selected Policy's eligibility from
    // scratch under a row lock (Part 15 of this phase's spec) — the
    // default-selection/grouping above is a UX convenience only, never
    // trusted as the authoritative check.
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
    router.push(`/invoice/${result.id}?returnTo=${encodeURIComponent(sourcePolicyHref)}`);
  };

  if (blocked) {
    const backRoute = sourcePolicyReturnTo ?? (blocked.category ? `${POLICY_CATEGORY_ROUTE[blocked.category]}/${blocked.policyId}` : "/invoice");
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

        {groups.length === 0 && (
          <TableWrap scroll>
            <Table className="min-w-[900px]">
              <thead>
                <tr>
                  <th>{t.invoice.colSelect}</th>
                </tr>
              </thead>
              <tbody>
                <TableEmpty colSpan={1}>{t.invoice.noEligiblePolicies}</TableEmpty>
              </tbody>
            </Table>
          </TableWrap>
        )}

        <div className="flex flex-col gap-6">
          {groups.map((group) => {
            const groupSubtotal = group.rows.filter((p) => selected.has(p.id)).reduce((sum, p) => sum + Number(p.clientPremium), 0);
            return (
              <div key={group.key}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-medium text-zinc-800">
                    {group.key === OTHER_GROUP_KEY
                      ? t.invoice.otherEligiblePoliciesTitle
                      : t.invoice.quotationGroupTitle.replace("{number}", group.quotationNumber ?? "—")}
                  </h3>
                  <span className="text-secondary text-sm">{t.invoice.eligiblePoliciesCount.replace("{count}", String(group.rows.length))}</span>
                </div>
                <TableWrap scroll>
                  <Table className="min-w-[980px]">
                    <thead>
                      <tr>
                        <th>{t.invoice.colSelect}</th>
                        <th>{t.policy.recordNumber}</th>
                        <th>{t.invoice.colPolicyClass}</th>
                        <th>{t.invoice.colPolicyNumber}</th>
                        <th>{t.invoice.colSourceQuotation}</th>
                        <th>{t.invoice.colEffectiveDate}</th>
                        <th>{t.invoice.colExpiryDate}</th>
                        <th>{t.invoice.colClientPremium}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((p) => (
                        <tr key={p.id} className={!p.isEligible ? "opacity-60" : undefined}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selected.has(p.id)}
                              disabled={!p.isEligible}
                              onChange={() => toggle(p)}
                              aria-label={p.recordNumber}
                              className="h-4 w-4 rounded border-zinc-300"
                            />
                          </td>
                          <td className="font-medium text-zinc-800">{p.recordNumber}</td>
                          <td className="text-zinc-500">{p.policyClass}</td>
                          <td className="text-zinc-500">{p.policyNumber}</td>
                          <td className="text-zinc-500">{p.quotationNumber ?? "—"}</td>
                          <td className="text-zinc-500">{dateFormatter.format(new Date(p.effectiveDate))}</td>
                          <td className="text-zinc-500">{dateFormatter.format(new Date(p.expiryDate))}</td>
                          <td className="text-zinc-500">
                            {!p.isEligible && p.activeInvoiceRef ? (
                              <div className="text-right">
                                <Badge tone="warning">{t.invoice.alreadyInvoicedShort}</Badge>
                                <div className="text-secondary mt-1 text-xs">{p.activeInvoiceRef.invoiceNumber}</div>
                              </div>
                            ) : (
                              formatMoney(p.clientPremium)
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </TableWrap>
                <div className="mt-2 flex justify-end gap-2 text-sm">
                  <span className="text-secondary">{t.invoice.groupSubtotal}:</span>
                  <span className="font-medium text-zinc-800">{formatMoney(groupSubtotal.toFixed(2))}</span>
                </div>
              </div>
            );
          })}
        </div>
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
        <Button type="button" variant="secondary" onClick={() => router.push(sourcePolicyHref)} disabled={isSubmitting}>
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t.invoice.generateInvoice}
        </Button>
      </div>
    </form>
  );
}
