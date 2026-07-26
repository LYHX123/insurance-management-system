import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { PolicyCategory } from "@/generated/prisma/enums";
import { getPolicyClassLabel, type PolicyClassSource } from "./policyClassLabel";

// Self-contained per this project's existing convention (each module keeps
// its own copy rather than importing a shared util — see e.g.
// quotation-detail.tsx's own POLICY_CATEGORY_ROUTE) — used for "Open Policy"
// links and revalidatePath calls anywhere Invoice code needs a Policy's
// list/detail route from just its category.
export const POLICY_CATEGORY_ROUTE: Record<PolicyCategory, string> = {
  MOTOR: "/policy/motor",
  NON_MOTOR: "/policy/non-motor",
  BOND: "/policy/bond",
  WORK_PERMIT: "/policy/work-permit",
};

// Shared, category-agnostic Prisma include used everywhere this module (and
// its callers) need enough of a PolicyRecord to determine Invoice
// eligibility and build a snapshot — one place to keep in sync if a new
// Policy category is ever added.
export const POLICY_FOR_INVOICE_INCLUDE = {
  customer: { select: { companyName: true, pinNumber: true } },
  motorDetail: { select: { insuranceType: true, policyNumber: true } },
  nonMotorDetail: { select: { insuranceType: true, policyNumber: true } },
  bondDetail: { select: { bondType: true, customBondType: true, policyNumber: true } },
  workPermitDetail: { select: { permitType: true, otherPermitType: true, permitNumber: true } },
  invoiceItems: {
    select: {
      invoice: { select: { id: true, invoiceNumber: true, status: true } },
    },
  },
} satisfies Prisma.PolicyRecordInclude;

export type PolicyForInvoice = Prisma.PolicyRecordGetPayload<{ include: typeof POLICY_FOR_INVOICE_INCLUDE }>;

// The actual insurer/agent-issued policy or permit number — never the
// internal PolicyRecord.recordNumber (see this phase's spec: "Do not
// silently use the internal Policy Record Number as the policy number").
export function getActualPolicyNumber(record: PolicyForInvoice): string | null {
  switch (record.category) {
    case "MOTOR":
      return record.motorDetail?.policyNumber?.trim() || null;
    case "NON_MOTOR":
      return record.nonMotorDetail?.policyNumber?.trim() || null;
    case "BOND":
      return record.bondDetail?.policyNumber?.trim() || null;
    case "WORK_PERMIT":
      return record.workPermitDetail?.permitNumber?.trim() || null;
  }
}

export function getPolicyClassSource(record: PolicyForInvoice): PolicyClassSource | null {
  switch (record.category) {
    case "MOTOR":
      return record.motorDetail ? { category: "MOTOR", insuranceType: record.motorDetail.insuranceType } : null;
    case "NON_MOTOR":
      return record.nonMotorDetail ? { category: "NON_MOTOR", insuranceType: record.nonMotorDetail.insuranceType } : null;
    case "BOND":
      return record.bondDetail
        ? { category: "BOND", bondType: record.bondDetail.bondType, customBondType: record.bondDetail.customBondType }
        : null;
    case "WORK_PERMIT":
      return record.workPermitDetail
        ? { category: "WORK_PERMIT", permitType: record.workPermitDetail.permitType, otherPermitType: record.workPermitDetail.otherPermitType }
        : null;
  }
}

// The Invoice this Policy currently belongs to, if any and non-cancelled —
// "already invoiced" per this phase's spec. A Policy may carry InvoiceItem
// rows from earlier CANCELLED invoices (see InvoiceItem's schema comment);
// those never block re-invoicing.
export function getActiveInvoiceRef(record: PolicyForInvoice): { id: string; invoiceNumber: string } | null {
  const active = record.invoiceItems.find((item) => item.invoice.status === "ISSUED");
  return active ? { id: active.invoice.id, invoiceNumber: active.invoice.invoiceNumber } : null;
}

// The most recent Invoice linked to this Policy regardless of status — used
// only for the Policy detail "Related Invoice" card, which per spec must
// still show a CANCELLED invoice's info (not hide it) while independently
// allowing a new one to be created.
export function getMostRecentInvoiceRef(record: PolicyForInvoice): { id: string; invoiceNumber: string; status: "ISSUED" | "CANCELLED" } | null {
  if (record.invoiceItems.length === 0) return null;
  // invoiceItems has no createdAt in this select; ISSUED always wins over
  // CANCELLED as "most relevant" since at most one ISSUED item can exist at
  // a time (enforced by createInvoiceAction) — falling back to the last
  // array entry (insertion/query order) when everything is CANCELLED.
  const active = record.invoiceItems.find((item) => item.invoice.status === "ISSUED");
  const ref = active ?? record.invoiceItems[record.invoiceItems.length - 1];
  return { id: ref.invoice.id, invoiceNumber: ref.invoice.invoiceNumber, status: ref.invoice.status };
}

// For the Policy detail "Related Invoice" card, which needs invoiceDate and
// totalPremium in addition to id/invoiceNumber/status — a plain, minimal
// shape so callers can select() exactly this from Prisma without pulling in
// the rest of POLICY_FOR_INVOICE_INCLUDE.
export type InvoiceItemForDisplay = {
  invoice: { id: string; invoiceNumber: string; invoiceDate: Date; status: "ISSUED" | "CANCELLED"; totalPremium: Prisma.Decimal };
};

export type RelatedInvoiceForDisplay = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  status: "ISSUED" | "CANCELLED";
  totalPremium: string;
};

// Same ISSUED-over-CANCELLED precedence as getMostRecentInvoiceRef, but
// returns the full display shape (invoiceDate/totalPremium included) the
// "Related Invoice" card needs — see RelatedInvoiceInfo's doc comment in
// components/policy/types.ts.
export function pickRelatedInvoiceForDisplay(items: InvoiceItemForDisplay[]): RelatedInvoiceForDisplay | null {
  if (items.length === 0) return null;
  const active = items.find((item) => item.invoice.status === "ISSUED");
  const chosen = active ?? items[items.length - 1];
  return {
    id: chosen.invoice.id,
    invoiceNumber: chosen.invoice.invoiceNumber,
    invoiceDate: chosen.invoice.invoiceDate.toISOString(),
    status: chosen.invoice.status,
    totalPremium: chosen.invoice.totalPremium.toString(),
  };
}

export type PolicyInvoiceEligibility =
  | { eligible: true }
  | { eligible: false; reason: "CANCELLED_POLICY" | "MISSING_POLICY_NUMBER" | "ALREADY_INVOICED" | "MISSING_DETAIL" };

// Independently re-checked by every server action (see this phase's spec:
// "Server actions must independently revalidate all rules" /
// "Do not rely only on hidden or disabled UI controls") — this is the one
// place both the UI (via server components) and the server actions call, so
// the two can never silently disagree.
export function checkPolicyInvoiceEligibility(record: PolicyForInvoice): PolicyInvoiceEligibility {
  if (record.businessStatus === "CANCELLED") return { eligible: false, reason: "CANCELLED_POLICY" };
  const classSource = getPolicyClassSource(record);
  if (!classSource) return { eligible: false, reason: "MISSING_DETAIL" };
  if (!getActualPolicyNumber(record)) return { eligible: false, reason: "MISSING_POLICY_NUMBER" };
  if (getActiveInvoiceRef(record)) return { eligible: false, reason: "ALREADY_INVOICED" };
  return { eligible: true };
}

export type EligiblePolicyRow = {
  id: string;
  recordNumber: string;
  category: PolicyForInvoice["category"];
  customerId: string;
  customerName: string;
  processingDate: string;
  policyClass: string;
  policyNumber: string;
  effectiveDate: string;
  expiryDate: string;
  clientPremium: string;
};

// Every currently-eligible, uninvoiced Policy for one Customer, across all
// four categories — the data source for both the Invoice creation page's
// selectable list and (indirectly, via checkPolicyInvoiceEligibility) the
// Policy detail "Create Invoice" button. Sorted by processing date then
// record number per this phase's spec.
export async function getEligiblePoliciesForCustomer(customerId: string): Promise<EligiblePolicyRow[]> {
  const records = await prisma.policyRecord.findMany({
    where: { customerId, deletedAt: null, businessStatus: { not: "CANCELLED" } },
    include: POLICY_FOR_INVOICE_INCLUDE,
    orderBy: [{ processingDate: "asc" }, { recordNumber: "asc" }],
  });

  const rows: EligiblePolicyRow[] = [];
  for (const record of records) {
    const eligibility = checkPolicyInvoiceEligibility(record);
    if (!eligibility.eligible) continue;
    const classSource = getPolicyClassSource(record)!;
    const policyNumber = getActualPolicyNumber(record)!;
    rows.push({
      id: record.id,
      recordNumber: record.recordNumber,
      category: record.category,
      customerId: record.customerId,
      customerName: record.customer.companyName,
      processingDate: record.processingDate.toISOString(),
      policyClass: getPolicyClassLabel(classSource),
      policyNumber,
      effectiveDate: record.effectiveDate.toISOString(),
      expiryDate: record.expiryDate.toISOString(),
      clientPremium: record.customerPremium.toString(),
    });
  }
  return rows;
}
