// Idempotent SystemSettings singleton-row initialization. Safe to run any
// number of times: getSystemSettings() upserts against the fixed
// "singleton" id, so a second run only confirms the row already exists —
// it never creates a duplicate.
//
// Usage:
//   npx tsx scripts/init-system-settings.ts

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import "dotenv/config";
import { SYSTEM_SETTINGS_ID } from "../src/lib/settings/constants";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const before = await prisma.systemSettings.count();

  const row = await prisma.systemSettings.upsert({
    where: { id: SYSTEM_SETTINGS_ID },
    update: {},
    create: { id: SYSTEM_SETTINGS_ID },
  });

  const after = await prisma.systemSettings.count();

  console.log(`SystemSettings row count before: ${before}, after: ${after}`);
  console.log(`Singleton row id: ${row.id}`);
  console.log(
    after === 1
      ? "OK: exactly one SystemSettings row exists."
      : `WARNING: expected exactly 1 row, found ${after}.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
