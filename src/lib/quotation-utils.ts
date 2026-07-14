import type { Prisma } from "@/generated/prisma/client";

// Atomic, concurrency-safe QT{YYYYMM}-{seq} generator. The INSERT ... ON
// CONFLICT DO UPDATE is a single statement, so Postgres serializes
// concurrent calls for the same year-month via row-level locking — two
// quotations created at the same instant can never receive the same number.
export async function generateQuotationNumber(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

  const rows = await tx.$queryRaw<{ lastSequence: number }[]>`
    INSERT INTO "QuotationNumberCounter" ("yearMonth", "lastSequence")
    VALUES (${yearMonth}, 1)
    ON CONFLICT ("yearMonth")
    DO UPDATE SET "lastSequence" = "QuotationNumberCounter"."lastSequence" + 1
    RETURNING "lastSequence"
  `;

  const sequence = Number(rows[0].lastSequence);
  return `QT${yearMonth}-${String(sequence).padStart(3, "0")}`;
}
