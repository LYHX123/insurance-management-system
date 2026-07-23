import { randomBytes } from "crypto";
import type { Prisma } from "@/generated/prisma/client";
import { formatCustomerNumber } from "@/lib/customer-utils";

// TEMP-HISTORICAL-<6 hex chars>, e.g. TEMP-HISTORICAL-A83F21 (Phase 1A.2).
// Replaces the earlier "PENDING-<customerNumber>" convention, which could be
// mistaken for a real customer PIN reference — this prefix is unambiguous,
// and deliberately does NOT embed customerNumber (that's a different,
// internal identifier, not something to expose as if it were part of a PIN).
// pinNumber is required + unique at the DB level (a pre-Phase-1A constraint
// this task does not touch), so the random suffix must be unique too; the
// tiny collision chance (1 in 16.7M) is handled with a short retry loop
// against the real constraint rather than a pre-check race.
function generatePlaceholderPin(): string {
  return `TEMP-HISTORICAL-${randomBytes(3).toString("hex").toUpperCase()}`;
}

const MAX_PIN_ATTEMPTS = 5;

// Creates a Customer directly from a historical import name — never
// invents PIN/contact/phone/address/email (see Customer.isIncomplete's
// schema comment). Reuses the exact same atomic sequenceNumber-based
// generation as createCustomerAction (src/app/(app)/customer/actions.ts) so
// historical and manually-created customers share one numbering sequence.
export async function createHistoricalCustomer(
  tx: Prisma.TransactionClient,
  params: {
    companyName: string;
    importBatchId: string;
    sourceSheet: string;
    originalRowNumber: number;
  }
) {
  const [{ nextval }] = await tx.$queryRaw<{ nextval: bigint }[]>`
    SELECT nextval(pg_get_serial_sequence('"Customer"', 'sequenceNumber')) as nextval
  `;
  const sequenceNumber = Number(nextval);
  const customerNumber = formatCustomerNumber(sequenceNumber);

  for (let attempt = 1; attempt <= MAX_PIN_ATTEMPTS; attempt++) {
    try {
      return await tx.customer.create({
        data: {
          customerNumber,
          companyName: params.companyName,
          pinNumber: generatePlaceholderPin(),
          status: "ACTIVE",
          source: "HISTORICAL_IMPORT",
          isIncomplete: true,
          importBatchId: params.importBatchId,
          sourceSheet: params.sourceSheet,
          originalRowNumber: params.originalRowNumber,
        },
      });
    } catch (err) {
      const isUniqueViolation = err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002";
      if (isUniqueViolation && attempt < MAX_PIN_ATTEMPTS) continue;
      throw err;
    }
  }
  throw new Error("Failed to generate a unique historical placeholder PIN after several attempts");
}
