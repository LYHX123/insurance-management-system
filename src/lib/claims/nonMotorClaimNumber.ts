import type { Prisma } from "@/generated/prisma/client";

// Same pattern as generateMotorClaimNumber — a dedicated
// NonMotorClaimNumberCounter table, independent of every other numbering
// sequence in the app.
export async function generateNonMotorClaimNumber(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

  const rows = await tx.$queryRaw<{ lastSequence: number }[]>`
    INSERT INTO "NonMotorClaimNumberCounter" ("yearMonth", "lastSequence")
    VALUES (${yearMonth}, 1)
    ON CONFLICT ("yearMonth")
    DO UPDATE SET "lastSequence" = "NonMotorClaimNumberCounter"."lastSequence" + 1
    RETURNING "lastSequence"
  `;

  const sequence = Number(rows[0].lastSequence);
  return `NC${yearMonth}-${String(sequence).padStart(4, "0")}`;
}
