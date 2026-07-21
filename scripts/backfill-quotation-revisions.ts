// One-time data backfill for Phase 1 quotation revisions: creates exactly
// one QuotationCase per pre-existing Quotation row (as revision "R01"),
// without touching any insurance section, coverage item, or structured
// detail row — those already point at the Quotation id, which never
// changes.
//
// Safety:
// - Repeat-safe: only operates on Quotation rows where quotationCaseId IS
//   NULL. Running this script again after a full or partial previous run
//   only processes whatever is still un-migrated; already-migrated rows are
//   never touched again.
// - Transaction-safe: each quotation is migrated inside its own
//   transaction (QuotationCase create + Quotation update happen together or
//   not at all), and re-checks quotationCaseId inside that transaction so
//   two concurrent runs can never double-create a case for the same
//   quotation.
// - Never deletes, resets, or reseeds anything. Never touches
//   quotationNumber, customerId, projectId, createdBy, totals, or any
//   insurance section/detail row.
//
// Old QuotationStatus -> new RevisionStatus / QuotationCaseStatus mapping
// (documented here since there is no exact 1:1 equivalence):
//   DRAFT     -> revision DRAFT,     case DRAFT
//   ISSUED    -> revision ISSUED,    case QUOTED
//   ACCEPTED  -> revision ACCEPTED,  case ACCEPTED
//   REJECTED  -> revision CANCELLED, case DECLINED   (no "rejected" concept
//                                                      in the new enums;
//                                                      closest match)
//   EXPIRED   -> revision ISSUED,    case EXPIRED     (the document itself
//                                                      was validly issued;
//                                                      expiry is a case-
//                                                      level lifecycle
//                                                      concept, not a defect
//                                                      of the revision)
//   CANCELLED -> revision CANCELLED, case DECLINED
//
// issuedAt/acceptedAt/issuedById/acceptedById/cancelledById/cancelledAt are
// deliberately left null for backfilled rows: the old schema never recorded
// exactly when/by whom a status changed, and inventing a timestamp/actor
// would fabricate audit data that was never actually captured.
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import type { QuotationStatus } from "../src/generated/prisma/enums";
import type { RevisionStatus, QuotationCaseStatus } from "../src/generated/prisma/enums";

const REVISION_STATUS_MAP: Record<QuotationStatus, RevisionStatus> = {
  DRAFT: "DRAFT",
  ISSUED: "ISSUED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "CANCELLED",
  EXPIRED: "ISSUED",
  CANCELLED: "CANCELLED",
};

const CASE_STATUS_MAP: Record<QuotationStatus, QuotationCaseStatus> = {
  DRAFT: "DRAFT",
  ISSUED: "QUOTED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "DECLINED",
  EXPIRED: "EXPIRED",
  CANCELLED: "DECLINED",
};

async function main() {
  const unmigrated = await prisma.quotation.findMany({
    where: { quotationCaseId: null },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${unmigrated.length} quotation(s) needing backfill.`);

  let migrated = 0;
  let failed = 0;

  for (const q of unmigrated) {
    try {
      await prisma.$transaction(async (tx) => {
        // Re-check inside the transaction: safe if this script (or another
        // instance of it) already migrated this row between the findMany
        // above and this point.
        const fresh = await tx.quotation.findUnique({
          where: { id: q.id },
          select: { quotationCaseId: true },
        });
        if (fresh?.quotationCaseId) return;

        const revisionStatus = REVISION_STATUS_MAP[q.status];
        const caseStatus = CASE_STATUS_MAP[q.status];

        const quotationCase = await tx.quotationCase.create({
          data: {
            quotationNumber: q.quotationNumber,
            customerId: q.customerId,
            projectId: q.projectId,
            status: caseStatus,
            createdById: q.createdBy,
            currentRevisionId: q.id,
            acceptedRevisionId: revisionStatus === "ACCEPTED" ? q.id : null,
          },
        });

        await tx.quotation.update({
          where: { id: q.id },
          data: {
            quotationCaseId: quotationCase.id,
            revisionNumber: 1,
            revisionCode: "R01",
            revisionReason: "Initial quotation",
            revisionStatus,
            isCurrentRevision: true,
          },
        });
      });
      migrated++;
      console.log(`  OK: ${q.quotationNumber} (${q.id}) -> R01, revisionStatus=${REVISION_STATUS_MAP[q.status]}, caseStatus=${CASE_STATUS_MAP[q.status]}`);
    } catch (e) {
      failed++;
      console.error(`  FAILED: ${q.quotationNumber} (${q.id}):`, e);
    }
  }

  const remaining = await prisma.quotation.count({ where: { quotationCaseId: null } });
  console.log(`\nBackfill run complete. Migrated this run: ${migrated}, failed: ${failed}, still un-migrated: ${remaining}`);
  if (remaining > 0) {
    console.log("Re-run this script to retry the remaining rows (safe — already-migrated rows are skipped).");
  }
}

main()
  .catch((e) => {
    console.error("Backfill script failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
