// One-time production hot-fix: grant the "admin" user full module permissions.
//
// Background: prisma/seed.ts historically created the admin user without
// setting `permissions`, so it defaulted to an empty array. That admin can
// still log in (permissions don't gate authentication), but sees an empty
// sidebar and gets redirected to /access-denied everywhere, since every
// module route requires a matching permission key.
//
// This script only touches the single user named "admin": it does not
// create a new user, does not change the password or any other profile
// field, and does not touch any other user, customer, project, or document.
// Safe to run multiple times — it always sets permissions to the same full
// list rather than appending, so re-running produces no duplicates.
//
// Usage (production):
//   docker compose --profile production run --rm migrate npx tsx prisma/grant-admin-all-permissions.ts

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import "dotenv/config";
import { ALL_MODULE_KEYS } from "../src/lib/permissions";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const admin = await prisma.user.findUnique({ where: { username: "admin" } });

  if (!admin) {
    console.error(
      'No user with username "admin" was found. This script only fixes an ' +
        "existing admin account; run prisma/seed.ts to create one."
    );
    process.exitCode = 1;
    return;
  }

  const updated = await prisma.user.update({
    where: { username: "admin" },
    data: {
      permissions: ALL_MODULE_KEYS,
      status: "ACTIVE",
    },
  });

  console.log(
    `Granted full permissions to "admin" (role: ${updated.role}, status: ${updated.status}).`
  );
  console.log(`Permissions: ${updated.permissions.join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
