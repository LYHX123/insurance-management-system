import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import {
  POLICY_FOR_INVOICE_INCLUDE,
  checkPolicyInvoiceEligibility,
  getEligiblePoliciesForCustomer,
} from "@/lib/invoice/eligibility";
import { CreateInvoiceForm } from "@/components/invoice/create-invoice-form";
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
  searchParams: Promise<{ fromPolicyId?: string }>;
}) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "invoice")) {
    redirect("/access-denied");
  }

  const { fromPolicyId } = await searchParams;
  if (!fromPolicyId) redirect("/invoice");

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
        customerId=""
        customerName=""
        customerPin=""
        policies={[]}
        defaultSelectedPolicyId=""
      />
    );
  }

  const eligiblePolicies = await getEligiblePoliciesForCustomer(sourcePolicy.customerId);

  return (
    <CreateInvoiceForm
      blocked={null}
      customerId={sourcePolicy.customerId}
      customerName={sourcePolicy.customer.companyName}
      customerPin={sourcePolicy.customer.pinNumber}
      policies={eligiblePolicies}
      defaultSelectedPolicyId={sourcePolicy.id}
    />
  );
}
