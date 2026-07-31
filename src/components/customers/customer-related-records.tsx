"use client";

// Phase 8.1 Part 2 — Customer Detail's "Related Records" tab body. Pure
// presentation: every row already comes permission-filtered and
// customer-scoped from the server (src/lib/customers/relatedRecords.ts) —
// this component never re-filters or re-fetches, it only renders what it's
// given and builds safe internal links (Part 3/4).
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { formatMoney } from "@/components/ui/money-input";
import type {
  CustomerRelatedRecordsData,
  CustomerRelatedQuotationRow,
  CustomerRelatedPolicyRow,
  CustomerRelatedInvoiceRow,
  CustomerRelatedClaimRow,
} from "@/lib/customers/relatedRecords";
import type { PolicyCategory } from "@/generated/prisma/enums";

const POLICY_CATEGORY_ROUTE: Record<PolicyCategory, string> = {
  MOTOR: "/policy/motor",
  NON_MOTOR: "/policy/non-motor",
  BOND: "/policy/bond",
  WORK_PERMIT: "/policy/work-permit",
};

function withReturnTo(href: string, returnTo: string): string {
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}returnTo=${encodeURIComponent(returnTo)}`;
}

function SectionCard({
  title,
  total,
  viewAllHrefs,
  emptyMessage,
  children,
}: {
  title: string;
  total: number;
  viewAllHrefs: { label: string; href: string }[];
  emptyMessage: string;
  children: React.ReactNode;
}) {
  const { t } = useLocale();
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="section-title">{title}</h2>
          <span className="text-secondary text-sm">{t.customers.relatedTotalRecords.replace("{count}", String(total))}</span>
        </div>
        {viewAllHrefs.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            {viewAllHrefs.map((v) => (
              <Link key={v.href} href={v.href} className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline">
                {v.label}
                <ExternalLink size={13} />
              </Link>
            ))}
          </div>
        )}
      </div>
      {total === 0 ? <p className="text-secondary text-sm">{emptyMessage}</p> : children}
    </Card>
  );
}

export function CustomerRelatedRecords({
  customerId,
  selfReturnTo,
  data,
}: {
  customerId: string;
  selfReturnTo: string;
  data: CustomerRelatedRecordsData;
}) {
  const { t, locale } = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" });

  const quotationCaseStatusLabel: Record<string, string> = {
    DRAFT: t.quotations.caseStatusDraft,
    IN_PROGRESS: t.quotations.caseStatusInProgress,
    QUOTED: t.quotations.caseStatusQuoted,
    ACCEPTED: t.quotations.caseStatusAccepted,
    DECLINED: t.quotations.caseStatusDeclined,
    EXPIRED: t.quotations.caseStatusExpired,
    CONVERTED_TO_POLICY: t.quotations.caseStatusConvertedToPolicy,
  };
  const policyStatusLabel: Record<string, string> = {
    DRAFT: t.policy.statusDraft,
    ACTIVE: t.policy.statusActive,
    EXPIRED: t.policy.statusExpired,
    CANCELLED: t.policy.statusCancelled,
    RENEWED: t.policy.statusRenewed,
  };
  const invoiceStatusLabel: Record<string, string> = { ISSUED: t.invoice.statusIssued, CANCELLED: t.invoice.statusCancelled };
  const claimStatusLabel: Record<string, string> = { OPEN: t.claims.open, CLOSED: t.claims.closed };
  const motorNatureLabel: Record<string, string> = {
    OWN_DAMAGE: t.claims.natureOwnDamage,
    THIRD_PARTY_CLAIM: t.claims.natureThirdPartyClaim,
    WINDSCREEN: t.claims.natureWindscreen,
    ACCIDENT: t.claims.natureAccident,
  };
  const nonMotorTypeLabel: Record<string, string> = {
    CONTRACTORS_ALL_RISKS: t.policy.coverContractorsAllRisks,
    WIBA: t.policy.coverWiba,
    EMPLOYERS_LIABILITY: t.policy.coverEmployersLiability,
    CONTRACTORS_PLANT_MACHINERY: t.policy.coverContractorsPlantMachinery,
    PUBLIC_LIABILITY: t.policy.coverPublicLiability,
    FIRE_ALLIED_PERILS: t.policy.coverFireAlliedPerils,
    BURGLARY: t.policy.coverBurglary,
    GOODS_IN_TRANSIT_SINGLE: t.policy.coverGoodsInTransitSingle,
    GOODS_IN_TRANSIT_ANNUAL: t.policy.coverGoodsInTransitAnnual,
    MARINE: t.policy.coverMarine,
    GROUP_PERSONAL_ACCIDENT: t.policy.coverGroupPersonalAccident,
    GROUP_MEDICAL: t.policy.coverGroupMedical,
  };
  const policyCategoryLabel: Record<PolicyCategory, string> = {
    MOTOR: t.quotations.categoryMotor,
    NON_MOTOR: t.quotations.categoryNonMotor,
    BOND: t.quotations.categoryBond,
    WORK_PERMIT: t.quotations.categoryWorkPermit,
  };

  const quotationRow = (q: CustomerRelatedQuotationRow) => (
    <tr key={q.caseId}>
      <td className="font-medium text-zinc-800">
        <Link
          href={withReturnTo(q.currentRevisionId ? `/quotation/${q.currentRevisionId}` : `/quotation/case/${q.caseId}`, selfReturnTo)}
          className="text-emerald-700 hover:underline"
        >
          {q.quotationNumber}
        </Link>
      </td>
      <td className="text-zinc-500">{q.projectName || "—"}</td>
      <td className="text-zinc-500">{q.insuranceTypeNames.length ? q.insuranceTypeNames.join(", ") : "—"}</td>
      <td className="text-zinc-500">{q.revisionCode || "—"}</td>
      <td className="text-zinc-500">{q.grandTotal ? `${q.currency ?? ""} ${formatMoney(q.grandTotal)}` : "—"}</td>
      <td>
        <Badge tone="neutral">{quotationCaseStatusLabel[q.caseStatus] ?? q.caseStatus}</Badge>
      </td>
      <td className="text-zinc-500">{dateFormatter.format(new Date(q.updatedAt))}</td>
    </tr>
  );

  const policyRow = (p: CustomerRelatedPolicyRow) => (
    <tr key={p.id}>
      <td className="font-medium text-zinc-800">
        <Link href={withReturnTo(`${POLICY_CATEGORY_ROUTE[p.category]}/${p.id}`, selfReturnTo)} className="text-emerald-700 hover:underline">
          {p.recordNumber}
        </Link>
      </td>
      <td>
        <Badge tone="neutral">{policyCategoryLabel[p.category] ?? p.category}</Badge>
      </td>
      <td className="text-zinc-500">{nonMotorTypeLabel[p.typeOfCover] ?? p.typeOfCover}</td>
      <td className="text-zinc-500">{p.insurerOrAgent || "—"}</td>
      <td className="text-zinc-500">
        {dateFormatter.format(new Date(p.effectiveDate))} – {dateFormatter.format(new Date(p.expiryDate))}
      </td>
      <td className="text-zinc-500">{formatMoney(p.clientPremium)}</td>
      <td>
        <Badge tone="neutral">{policyStatusLabel[p.businessStatus] ?? p.businessStatus}</Badge>
      </td>
    </tr>
  );

  const invoiceRow = (inv: CustomerRelatedInvoiceRow) => (
    <tr key={inv.id}>
      <td className="font-medium text-zinc-800">
        <Link href={withReturnTo(`/invoice/${inv.id}`, selfReturnTo)} className="text-emerald-700 hover:underline">
          {inv.invoiceNumber}
        </Link>
      </td>
      <td className="text-zinc-500">{dateFormatter.format(new Date(inv.invoiceDate))}</td>
      <td className="text-zinc-500">{formatMoney(inv.totalPremium)}</td>
      <td>
        <Badge tone={inv.status === "ISSUED" ? "success" : "danger"}>{invoiceStatusLabel[inv.status] ?? inv.status}</Badge>
      </td>
      <td className="text-zinc-500">{inv.policySummary}</td>
    </tr>
  );

  const claimRow = (c: CustomerRelatedClaimRow, categorySlug: "motor-claim" | "non-motor-claim", typeLabel: (v: string) => string) => (
    <tr key={c.id}>
      <td className="font-medium text-zinc-800">
        <Link href={withReturnTo(`/task/${categorySlug}/${c.id}`, selfReturnTo)} className="text-emerald-700 hover:underline">
          {c.claimNumber}
        </Link>
      </td>
      <td className="text-zinc-500">{typeLabel(c.claimType)}</td>
      <td className="text-zinc-500">{dateFormatter.format(new Date(c.reportedAt))}</td>
      <td className="text-zinc-500">{c.linkedPolicyRecordNumber ?? t.claims.noLinkedPolicy}</td>
      <td className="text-zinc-500">{c.progress}</td>
      <td>
        <Badge tone={c.status === "OPEN" ? "brand" : "neutral"}>{claimStatusLabel[c.status] ?? c.status}</Badge>
      </td>
    </tr>
  );

  return (
    <div className="flex flex-col gap-4">
      {data.quotations.visible && (
        <SectionCard
          title={t.customers.relatedQuotationsTitle}
          total={data.quotations.total}
          emptyMessage={t.customers.relatedEmptyQuotations}
          viewAllHrefs={
            data.quotations.total > 0
              ? [{ label: t.customers.relatedViewAll, href: withReturnTo(`/quotation?customerId=${customerId}`, selfReturnTo) }]
              : []
          }
        >
          <TableWrap scroll>
            <Table className="min-w-[900px]">
              <thead>
                <tr>
                  <th>{t.quotations.quotationNumber}</th>
                  <th>{t.quotations.project}</th>
                  <th>{t.quotations.insuranceTypesUsed}</th>
                  <th>{t.quotations.currentRevision}</th>
                  <th>{t.quotations.grandTotal}</th>
                  <th>{t.common.status}</th>
                  <th>{t.quotations.updatedAt}</th>
                </tr>
              </thead>
              <tbody>
                {data.quotations.rows.length === 0 ? (
                  <TableEmpty colSpan={7}>{t.customers.relatedEmptyQuotations}</TableEmpty>
                ) : (
                  data.quotations.rows.map(quotationRow)
                )}
              </tbody>
            </Table>
          </TableWrap>
        </SectionCard>
      )}

      {data.policies.visible && (
        <SectionCard
          title={t.customers.relatedPoliciesTitle}
          total={data.policies.total}
          emptyMessage={t.customers.relatedEmptyPolicies}
          viewAllHrefs={data.policies.categoryTotals.map((c) => ({
            label: `${t.customers.relatedViewAll} — ${policyCategoryLabel[c.category]}`,
            href: withReturnTo(`${POLICY_CATEGORY_ROUTE[c.category]}?customerId=${customerId}`, selfReturnTo),
          }))}
        >
          <TableWrap scroll>
            <Table className="min-w-[960px]">
              <thead>
                <tr>
                  <th>{t.policy.recordNumber}</th>
                  <th>{t.quotations.policyCategory}</th>
                  <th>{t.policy.typeOfCover}</th>
                  <th>{t.customers.relatedColInsurerAgent}</th>
                  <th>{t.policy.effectiveDate} – {t.policy.expiryDate}</th>
                  <th>{t.policy.clientPremium}</th>
                  <th>{t.common.status}</th>
                </tr>
              </thead>
              <tbody>
                {data.policies.rows.length === 0 ? (
                  <TableEmpty colSpan={7}>{t.customers.relatedEmptyPolicies}</TableEmpty>
                ) : (
                  data.policies.rows.map(policyRow)
                )}
              </tbody>
            </Table>
          </TableWrap>
        </SectionCard>
      )}

      {data.invoices.visible && (
        <SectionCard
          title={t.customers.relatedInvoicesTitle}
          total={data.invoices.total}
          emptyMessage={t.customers.relatedEmptyInvoices}
          viewAllHrefs={
            data.invoices.total > 0
              ? [{ label: t.customers.relatedViewAll, href: withReturnTo(`/invoice?customerId=${customerId}`, selfReturnTo) }]
              : []
          }
        >
          <TableWrap scroll>
            <Table className="min-w-[760px]">
              <thead>
                <tr>
                  <th>{t.invoice.invoiceNumber}</th>
                  <th>{t.invoice.invoiceDate}</th>
                  <th>{t.invoice.totalPremium}</th>
                  <th>{t.common.status}</th>
                  <th>{t.customers.relatedColPolicySummary}</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.rows.length === 0 ? (
                  <TableEmpty colSpan={5}>{t.customers.relatedEmptyInvoices}</TableEmpty>
                ) : (
                  data.invoices.rows.map(invoiceRow)
                )}
              </tbody>
            </Table>
          </TableWrap>
        </SectionCard>
      )}

      {data.motorClaims.visible && (
        <SectionCard
          title={t.customers.relatedMotorClaimsTitle}
          total={data.motorClaims.total}
          emptyMessage={t.customers.relatedEmptyMotorClaims}
          viewAllHrefs={
            data.motorClaims.total > 0
              ? [{ label: t.customers.relatedViewAll, href: withReturnTo(`/task/motor-claim?customerId=${customerId}`, selfReturnTo) }]
              : []
          }
        >
          <TableWrap scroll>
            <Table className="min-w-[860px]">
              <thead>
                <tr>
                  <th>{t.claims.claimRecordNumber}</th>
                  <th>{t.claims.claimNature}</th>
                  <th>{t.claims.reportedTime}</th>
                  <th>{t.claims.linkedPolicy}</th>
                  <th>{t.claims.progress}</th>
                  <th>{t.common.status}</th>
                </tr>
              </thead>
              <tbody>
                {data.motorClaims.rows.length === 0 ? (
                  <TableEmpty colSpan={6}>{t.customers.relatedEmptyMotorClaims}</TableEmpty>
                ) : (
                  data.motorClaims.rows.map((c) => claimRow(c, "motor-claim", (v) => motorNatureLabel[v] ?? v))
                )}
              </tbody>
            </Table>
          </TableWrap>
        </SectionCard>
      )}

      {data.nonMotorClaims.visible && (
        <SectionCard
          title={t.customers.relatedNonMotorClaimsTitle}
          total={data.nonMotorClaims.total}
          emptyMessage={t.customers.relatedEmptyNonMotorClaims}
          viewAllHrefs={
            data.nonMotorClaims.total > 0
              ? [{ label: t.customers.relatedViewAll, href: withReturnTo(`/task/non-motor-claim?customerId=${customerId}`, selfReturnTo) }]
              : []
          }
        >
          <TableWrap scroll>
            <Table className="min-w-[860px]">
              <thead>
                <tr>
                  <th>{t.claims.claimRecordNumber}</th>
                  <th>{t.claims.insuranceType}</th>
                  <th>{t.claims.reportedTime}</th>
                  <th>{t.claims.linkedPolicy}</th>
                  <th>{t.claims.progress}</th>
                  <th>{t.common.status}</th>
                </tr>
              </thead>
              <tbody>
                {data.nonMotorClaims.rows.length === 0 ? (
                  <TableEmpty colSpan={6}>{t.customers.relatedEmptyNonMotorClaims}</TableEmpty>
                ) : (
                  data.nonMotorClaims.rows.map((c) => claimRow(c, "non-motor-claim", (v) => nonMotorTypeLabel[v] ?? v))
                )}
              </tbody>
            </Table>
          </TableWrap>
        </SectionCard>
      )}
    </div>
  );
}
