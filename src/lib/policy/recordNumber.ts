import type { Prisma } from "@/generated/prisma/client";
import type { PolicyCategory } from "@/generated/prisma/enums";

// Same atomic INSERT ... ON CONFLICT DO UPDATE pattern as
// generateQuotationNumber (see quotation-utils.ts) — the per-category,
// per-year-month counter key keeps Motor/Non-Motor/Bond/Work Permit
// sequences independent of each other.
const RECORD_NUMBER_PREFIX: Record<PolicyCategory, string> = {
  MOTOR: "PM",
  NON_MOTOR: "PN",
  BOND: "PB",
  WORK_PERMIT: "PW",
};

export async function generatePolicyRecordNumber(
  tx: Prisma.TransactionClient,
  category: PolicyCategory
): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const key = `${category}-${yearMonth}`;

  const rows = await tx.$queryRaw<{ lastSequence: number }[]>`
    INSERT INTO "PolicyRecordNumberCounter" ("key", "lastSequence")
    VALUES (${key}, 1)
    ON CONFLICT ("key")
    DO UPDATE SET "lastSequence" = "PolicyRecordNumberCounter"."lastSequence" + 1
    RETURNING "lastSequence"
  `;

  const sequence = Number(rows[0].lastSequence);
  return `${RECORD_NUMBER_PREFIX[category]}${yearMonth}-${String(sequence).padStart(4, "0")}`;
}
