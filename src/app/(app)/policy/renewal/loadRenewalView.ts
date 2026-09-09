import { prisma } from "@/lib/prisma";
import { computeBusinessStatus } from "@/lib/policy/status";
import type { PolicyRenewalView } from "@/components/policy/policy-renewal-card";
import type { RenewalChainMember } from "@/lib/policy/renewal";

// Builds the Renewal History card's view model for one policy PERIOD. The
// chain is fetched via rootPolicyId (an original's own id is its root).
export async function loadRenewalView(record: {
  id: string;
  rootPolicyId: string | null;
  renewalIndex: number;
  renewalDecision: PolicyRenewalView["renewalDecision"];
}): Promise<PolicyRenewalView> {
  const rootId = record.rootPolicyId ?? record.id;

  const members = await prisma.policyRecord.findMany({
    where: { deletedAt: null, OR: [{ id: rootId }, { rootPolicyId: rootId }] },
    orderBy: { renewalIndex: "asc" },
    select: {
      id: true,
      recordNumber: true,
      category: true,
      renewalIndex: true,
      renewalDecision: true,
      effectiveDate: true,
      expiryDate: true,
      businessStatus: true,
    },
  });

  const chain: RenewalChainMember[] = members.map((m) => ({
    id: m.id,
    recordNumber: m.recordNumber,
    category: m.category,
    renewalIndex: m.renewalIndex,
    renewalDecision: m.renewalDecision,
    effectiveDate: m.effectiveDate.toISOString(),
    // Phase 13C — null for an open-ended Security Bond period.
    expiryDate: m.expiryDate ? m.expiryDate.toISOString() : null,
    businessStatus: computeBusinessStatus(m.effectiveDate, m.expiryDate, m.businessStatus),
    isCurrent: m.id === record.id,
  }));

  const hasSuccessor = members.some((m) => m.renewalIndex === record.renewalIndex + 1);

  return {
    renewalIndex: record.renewalIndex,
    renewalDecision: record.renewalDecision,
    hasSuccessor,
    chain,
  };
}
