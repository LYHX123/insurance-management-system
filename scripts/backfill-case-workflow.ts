// One-time data backfill for Phase 2B's case-status semantics. Purely a
// data update (no schema change) — safe to re-run, only touches rows that
// still need it.
//
// - enquiryDate: didn't exist before Phase 2B. Backfilled from createdAt as
//   the closest honest proxy for pre-existing cases (never fabricated to a
//   different date).
// - status: IN_PROGRESS ("Quotation In Progress") is new to Phase 2B —
//   every case created before this phase that already has a DRAFT current
//   revision was, in the old one-shot flow, always created with
//   status=DRAFT. Under the new semantics DRAFT now specifically means "no
//   revision yet" ("Preparing Documents"), so any DRAFT case that already
//   has a revision is moved to IN_PROGRESS to match what it actually is.
//   Cases already past DRAFT (QUOTED/ACCEPTED/...) are untouched.
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const missingEnquiryDate = await prisma.quotationCase.findMany({
    where: { enquiryDate: null },
    select: { id: true, createdAt: true },
  });
  for (const c of missingEnquiryDate) {
    await prisma.quotationCase.update({ where: { id: c.id }, data: { enquiryDate: c.createdAt } });
  }
  console.log(`enquiryDate backfilled for ${missingEnquiryDate.length} case(s).`);

  const draftWithRevision = await prisma.quotationCase.findMany({
    where: { status: "DRAFT", currentRevisionId: { not: null } },
    select: { id: true, quotationNumber: true },
  });
  for (const c of draftWithRevision) {
    await prisma.quotationCase.update({ where: { id: c.id }, data: { status: "IN_PROGRESS" } });
    console.log(`  ${c.quotationNumber}: DRAFT -> IN_PROGRESS (already has a revision)`);
  }
  console.log(`status backfilled for ${draftWithRevision.length} case(s).`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("Backfill failed:", e);
  process.exit(1);
});
