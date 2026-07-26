import type { Prisma } from "@/generated/prisma/client";

// Same per-yearMonth atomic upsert pattern as generateQuotationNumber (see
// src/lib/quotation-utils.ts) and generatePolicyRecordNumber (see
// src/lib/policy/recordNumber.ts) — backed by its own dedicated
// InvoiceNumberCounter table (see that model's schema comment for why a
// third counter table, not a reuse of the other two).
export async function generateInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

  const rows = await tx.$queryRaw<{ lastSequence: number }[]>`
    INSERT INTO "InvoiceNumberCounter" ("yearMonth", "lastSequence")
    VALUES (${yearMonth}, 1)
    ON CONFLICT ("yearMonth")
    DO UPDATE SET "lastSequence" = "InvoiceNumberCounter"."lastSequence" + 1
    RETURNING "lastSequence"
  `;

  const sequence = Number(rows[0].lastSequence);
  return `INV${yearMonth}-${String(sequence).padStart(4, "0")}`;
}
