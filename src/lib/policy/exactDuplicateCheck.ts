import type { PrismaClient } from "@/generated/prisma/client";
import type { PolicyCategory } from "@/generated/prisma/enums";

// EXACT_DUPLICATE detection — always against the real PolicyRecord table,
// never just within the current batch (see PolicyImportRowStatus's schema
// comment). Two independent ways a row can collide with something that
// already exists:
//   (a) the exact same source row was already imported before (re-uploading
//       the same workbook, or re-running an import after a partial
//       failure) — keyed by sourceSheet + originalRowNumber, no customer
//       resolution needed.
//   (b) an equivalent policy already exists for a DIFFERENT reason — same
//       customer + registration + cover type + effective + expiry dates —
//       deliberately NOT just registration number, since a renewal or a
//       second cover type on the same vehicle is a legitimate, different
//       policy (see this phase's spec).
// Never used to silently skip a row — only to hard-block it; the caller is
// responsible for surfacing this to the user (see PolicyImportRowStatus
// EXACT_DUPLICATE and confirmMotorImportAction's final gate).
export type ExactDuplicateCandidate = {
  rowNumber: number;
  sourceSheet: string;
  registrationNumber: string | null;
  insuranceType: string | null;
  effectiveDate: Date | null;
  expiryDate: Date | null;
  matchedCustomerId: string | null;
};

function iso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function identityKey(
  customerId: string | null,
  registrationNumber: string | null,
  insuranceType: string | null,
  effectiveDate: Date | null,
  expiryDate: Date | null
): string | null {
  if (!customerId || !registrationNumber || !insuranceType || !effectiveDate || !expiryDate) return null;
  return `${customerId}:${registrationNumber.trim().toUpperCase()}:${insuranceType.trim().toUpperCase()}:${iso(effectiveDate)}:${iso(expiryDate)}`;
}

// Shared across every Policy category by design (see this phase's "Reusable
// Policy import foundation" — category only changes the `where` filter and,
// once Non-Motor/Bond/Work Permit exist, which *PolicyDetail relation is
// selected for the identity key; the source-row check needs no per-category
// change at all).
export async function detectExactDuplicates(
  prisma: PrismaClient,
  category: PolicyCategory,
  candidates: ExactDuplicateCandidate[]
): Promise<Map<number, string>> {
  // motorDetail is the only *PolicyDetail relation today — this select
  // becomes category-conditional once a second category's import lands.
  const existing = await prisma.policyRecord.findMany({
    where: { category, deletedAt: null },
    select: {
      id: true,
      customerId: true,
      effectiveDate: true,
      expiryDate: true,
      sourceSheet: true,
      originalRowNumber: true,
      motorDetail: { select: { registrationNumber: true, insuranceType: true } },
    },
  });

  const bySourceRow = new Map<string, string>();
  const byIdentity = new Map<string, string>();
  for (const record of existing) {
    if (record.sourceSheet && record.originalRowNumber !== null) {
      bySourceRow.set(`${record.sourceSheet}:${record.originalRowNumber}`, record.id);
    }
    const key = identityKey(
      record.customerId,
      record.motorDetail?.registrationNumber ?? null,
      record.motorDetail?.insuranceType ?? null,
      record.effectiveDate,
      record.expiryDate
    );
    if (key) byIdentity.set(key, record.id);
  }

  const result = new Map<number, string>();
  for (const c of candidates) {
    const sourceRowMatch = bySourceRow.get(`${c.sourceSheet}:${c.rowNumber}`);
    if (sourceRowMatch) {
      result.set(c.rowNumber, sourceRowMatch);
      continue;
    }
    const key = identityKey(c.matchedCustomerId, c.registrationNumber, c.insuranceType, c.effectiveDate, c.expiryDate);
    const identityMatch = key ? byIdentity.get(key) : undefined;
    if (identityMatch) result.set(c.rowNumber, identityMatch);
  }
  return result;
}
