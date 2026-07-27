// One-time (idempotent) data migration: expands every user's old, coarse
// module-level permissions (policy/ledger/task/users) into the new detailed
// permission keys introduced alongside Full Name login. Never touches
// username, fullName, passwordHash, createdAt, or lastLoginAt — only the
// `permissions` column.
//
// Mapping (see the Full Name / permissions upgrade report):
//   policy -> policy.motor, policy.non_motor, policy.bond, policy.work_permit
//   ledger -> ledger.manual_record, ledger.system_record
//   task   -> task.daily_task, claim.motor, claim.non_motor
//   users  -> dropped (User Management is now ADMIN-only, never a stored
//             permission — an ADMIN role user gets it automatically; a
//             non-admin user who previously had "users" loses that access,
//             per the confirmed migration decision)
//   dashboard/customer/quotation/invoice/settings -> unchanged
//
// Safe to run more than once: recomputes each user's set from whatever old
// broad keys and/or already-migrated detailed keys are present, using a Set
// to avoid duplicates — a second run against already-migrated data is a
// no-op.
//
// Usage:
//   npx tsx scripts/migrate-permissions.ts

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import "dotenv/config";
import { isAdminRole, sanitizePermissions } from "../src/lib/permissions";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const EXPANSION: Record<string, string[]> = {
  policy: ["policy.motor", "policy.non_motor", "policy.bond", "policy.work_permit"],
  ledger: ["ledger.manual_record", "ledger.system_record"],
  task: ["task.daily_task", "claim.motor", "claim.non_motor"],
};

const DROPPED = new Set(["users"]);

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, fullName: true, role: true, permissions: true },
  });

  console.log(`Found ${users.length} user(s) to check.`);

  let changed = 0;
  for (const user of users) {
    const expanded = new Set<string>();
    for (const key of user.permissions) {
      if (DROPPED.has(key)) continue;
      const mapped = EXPANSION[key];
      if (mapped) {
        mapped.forEach((k) => expanded.add(k));
      } else {
        expanded.add(key);
      }
    }

    // ADMIN gets full access automatically via role (see src/lib/permissions
    // .ts's isAdmin) — the stored array is normalized to the full detailed
    // set anyway, purely for consistent display; it is never read as the
    // source of truth for an admin account.
    const next = isAdminRole(user.role)
      ? sanitizePermissions([
          "dashboard", "customer", "quotation", "invoice", "settings",
          "policy.motor", "policy.non_motor", "policy.bond", "policy.work_permit",
          "ledger.manual_record", "ledger.system_record",
          "task.daily_task", "claim.motor", "claim.non_motor",
        ])
      : sanitizePermissions(Array.from(expanded));

    const before = [...user.permissions].sort().join(",");
    const after = [...next].sort().join(",");
    if (before === after) {
      console.log(`- ${user.fullName}: unchanged (${next.length} permissions)`);
      continue;
    }

    await prisma.user.update({ where: { id: user.id }, data: { permissions: next } });
    changed += 1;
    console.log(`- ${user.fullName}: ${user.permissions.length} -> ${next.length} permissions`);
    console.log(`    old: ${user.permissions.join(", ") || "(none)"}`);
    console.log(`    new: ${next.join(", ") || "(none)"}`);
  }

  console.log(`\nDone. ${changed} of ${users.length} user(s) updated.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
