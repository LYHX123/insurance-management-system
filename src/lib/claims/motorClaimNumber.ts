import type { Prisma } from "@/generated/prisma/client";

// Same per-yearMonth atomic INSERT ... ON CONFLICT DO UPDATE pattern as
// generateInvoiceNumber (src/lib/invoice/recordNumber.ts) and
// generatePolicyRecordNumber (src/lib/policy/recordNumber.ts) — backed by
// its own dedicated MotorClaimNumberCounter table so this sequence is
// independent of Policy/Invoice/Non-Motor-Claim numbering.
export async function generateMotorClaimNumber(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

  const rows = await tx.$queryRaw<{ lastSequence: number }[]>`
    INSERT INTO "MotorClaimNumberCounter" ("yearMonth", "lastSequence")
    VALUES (${yearMonth}, 1)
    ON CONFLICT ("yearMonth")
    DO UPDATE SET "lastSequence" = "MotorClaimNumberCounter"."lastSequence" + 1
    RETURNING "lastSequence"
  `;

  const sequence = Number(rows[0].lastSequence);
  return `MC${yearMonth}-${String(sequence).padStart(4, "0")}`;
}
