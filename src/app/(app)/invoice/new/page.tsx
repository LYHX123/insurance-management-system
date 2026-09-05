import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEdit } from "@/lib/permissions";
import {
  POLICY_FOR_INVOICE_INCLUDE,
  checkPolicyInvoiceEligibility,
  getEligiblePoliciesForCustomer,
} from "@/lib/invoice/eligibility";
import { CreateInvoiceForm } from "@/components/invoice/create-invoice-form";
import { isSafeReturnTo } from "@/lib/navigation/returnTo";
import type { PolicyInvoiceEligibility } from "@/lib/invoice/eligibility";
import type { PolicyCategory } from "@/generated/prisma/enums";

// The Invoice creation page always starts from a specific source Policy —
// there is no standalone "start blank" entry point (see this phase's spec:
// "The user-triggered Create Invoice button is the required workflow").
// fromPolicyId is never trusted on its own: the source Policy is re-loaded
// and re-validated server-side here regardless of what the query string
// claims (see checkPolicyInvoiceEligibility, and createInvoiceAction's own
// independent re-validation at confirmation time). Ineligibility / not-found
// states are rendered by the client form component (bilingual via
// useLocale()), same convention as create-bond-record-form.tsx's
// ineligibleQuotation handling — this page only loads and validates data.
export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ fromPolicyId?: string; returnTo?: string }>;
}) {
  const session = await auth();
  if (!session?.user || !canEdit(session.user, "invoice")) {
    redirect("/access-denied");
  }

  const { fromPolicyId, returnTo } = await searchParams;
  if (!fromPolicyId) redirect("/invoice");
  // Phase 8.1 Part 9: the Policy Detail page's own current URL (its own
  // tab/returnTo included), so Cancel and the newly-created Invoice's own
  // Back both return to exactly where the user was, not just the bare
  // Policy URL — validated the same as every other returnTo, never trusted
  // raw.
  const sourcePolicyReturnTo = isSafeReturnTo(returnTo) ? returnTo : null;

  const sourcePolicy = await prisma.policyRecord.findUnique({
    where: { id: fromPolicyId, deletedAt: null },
    include: POLICY_FOR_INVOICE_INCLUDE,
  });

  let blockedReason: PolicyInvoiceEligibility | { eligible: false; reason: "NOT_FOUND" } | null = null;
  let sourceCategory: PolicyCategory | null = null;
  let sourceRecordNumber: string | null = null;

  if (!sourcePolicy) {
    blockedReason = { eligible: false, reason: "NOT_FOUND" };
  } else {
    sourceCategory = sourcePolicy.category;
    sourceRecordNumber = sourcePolicy.recordNumber;
    const eligibility = checkPolicyInvoiceEligibility(sourcePolicy);
    if (!eligibility.eligible) blockedReason = eligibility;
  }

  if (blockedReason || !sourcePolicy) {
    return (
      <CreateInvoiceForm
        blocked={{ reason: blockedReason!.reason, policyId: fromPolicyId, category: sourceCategory, recordNumber: sourceRecordNumber }}
        insuredCustomerId=""
        insuredCustomerName=""
        insuredCustomerPin=""
        billToCustomerOptions={[]}
        policies={[]}
        defaultSelectedPolicyId=""
        sourcePolicyReturnTo={sourcePolicyReturnTo}
      />
    );
  }

  // Eligible policies are ALWAYS the insured/policy customer's — the Bill-To
  // customer never affects which policies can be grouped onto one invoice
  // (Phase 12B spec §10).
  const [eligiblePolicies, billToCustomerOptions] = await Promise.all([
    getEligiblePoliciesForCustomer(sourcePolicy.customerId),
    // Bill-To picker — same "active customers" convention as the Policy
    // create forms (reused via buildCustomerSearchOptions in the form).
    prisma.customer.findMany({
      where: { status: "ACTIVE" },
      orderBy: { companyName: "asc" },
      select: { id: true, companyName: true, customerNumber: true, shortName: true },
    }),
  ]);

  return (
    <CreateInvoiceForm
      blocked={null}
      insuredCustomerId={sourcePolicy.customerId}
      insuredCustomerName={sourcePolicy.customer.companyName}
      insuredCustomerPin={sourcePolicy.customer.pinNumber}
      billToCustomerOptions={billToCustomerOptions}
      policies={eligiblePolicies}
      defaultSelectedPolicyId={sourcePolicy.id}
      sourcePolicy={{ id: sourcePolicy.id, category: sourcePolicy.category }}
      sourcePolicyReturnTo={sourcePolicyReturnTo}
    />
  );
}
