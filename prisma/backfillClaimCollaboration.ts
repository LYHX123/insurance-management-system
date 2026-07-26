// Phase 6C one-time data backfill: adds the existing creator as a
// participant and creates one initial timeline entry for any MotorClaim/
// NonMotorClaim row that predates the Phase 6C collaboration/timeline
// upgrade (i.e. has zero participants). Idempotent — checks each claim's
// current participant count before acting, so it is always safe to re-run
// (locally, or again after deploying this phase to a separate environment
// that has its own pre-existing Claim rows). Never invents a Project,
// never touches progress/insurer/any other existing field — see this
// phase's spec, Part L.46.
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import "dotenv/config";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function backfillMotorClaims() {
  const claims = await prisma.motorClaim.findMany({
    where: { participants: { none: {} } },
    select: { id: true, createdById: true, progress: true },
  });
  for (const claim of claims) {
    await prisma.$transaction(async (tx) => {
      await tx.motorClaimParticipant.create({
        data: { motorClaimId: claim.id, userId: claim.createdById, addedById: claim.createdById },
      });
      await tx.motorClaimUpdate.create({
        data: {
          motorClaimId: claim.id,
          content: "Claim existed prior to collaboration and timeline tracking being added.",
          isInitial: true,
          createdById: claim.createdById,
        },
      });
    });
    console.log(`Backfilled MotorClaim ${claim.id}`);
  }
  return claims.length;
}

async function backfillNonMotorClaims() {
  const claims = await prisma.nonMotorClaim.findMany({
    where: { participants: { none: {} } },
    select: { id: true, createdById: true },
  });
  for (const claim of claims) {
    await prisma.$transaction(async (tx) => {
      await tx.nonMotorClaimParticipant.create({
        data: { nonMotorClaimId: claim.id, userId: claim.createdById, addedById: claim.createdById },
      });
      await tx.nonMotorClaimUpdate.create({
        data: {
          nonMotorClaimId: claim.id,
          content: "Claim existed prior to collaboration and timeline tracking being added.",
          isInitial: true,
          createdById: claim.createdById,
        },
      });
    });
    console.log(`Backfilled NonMotorClaim ${claim.id}`);
  }
  return claims.length;
}

async function main() {
  const motorCount = await backfillMotorClaims();
  const nonMotorCount = await backfillNonMotorClaims();
  console.log(`Done. Motor Claims backfilled: ${motorCount}. Non-Motor Claims backfilled: ${nonMotorCount}.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
