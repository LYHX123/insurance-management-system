import { prisma } from "@/lib/prisma";

// The distinct, normalized set of insurer names already stored across the
// app — the only "master list" that exists, since there is no dedicated
// Insurer model (checked before implementing, see this phase's spec, Part
// D.12). Sourced from Motor/Non-Motor/Bond Policy records and existing
// Motor/Non-Motor Claims. Work Permit is deliberately excluded:
// PolicyRecord.insurerName is never populated for that category (Work
// Permit's equivalent field is WorkPermitPolicyDetail.agent, a different
// business concept — see this phase's spec, Part D.12's instruction to
// exclude Work Permit Agent values). Case-insensitive dedup keeps the
// first-seen casing as the clean display value; result is sorted
// alphabetically for the Combobox (src/components/ui/combobox.tsx), which
// is reused as-is rather than building a new component (Part D.13).
export async function getDistinctInsurers(): Promise<string[]> {
  const [policies, motorClaims, nonMotorClaims] = await Promise.all([
    prisma.policyRecord.findMany({
      where: { deletedAt: null, category: { not: "WORK_PERMIT" }, insurerName: { not: null } },
      select: { insurerName: true },
    }),
    prisma.motorClaim.findMany({ where: { deletedAt: null }, select: { insurer: true } }),
    prisma.nonMotorClaim.findMany({ where: { deletedAt: null }, select: { insurer: true } }),
  ]);

  const seen = new Map<string, string>();
  const consider = (raw: string | null | undefined) => {
    const value = raw?.trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (!seen.has(key)) seen.set(key, value);
  };

  for (const p of policies) consider(p.insurerName);
  for (const c of motorClaims) consider(c.insurer);
  for (const c of nonMotorClaims) consider(c.insurer);

  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
