import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";
import "dotenv/config";
import { ALL_MODULE_KEYS } from "../src/lib/permissions";
import { ALL_INSURANCE_TYPES } from "./insuranceTypesData";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash("admin123", 10);

  await prisma.user.upsert({
    where: { username: "admin" },
    update: {
      // Re-grant full permissions and re-activate on every seed run, without
      // touching the password of an admin that already exists.
      permissions: ALL_MODULE_KEYS,
      status: "ACTIVE",
    },
    create: {
      username: "admin",
      fullName: "System Administrator",
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
      preferredLanguage: "en",
      permissions: ALL_MODULE_KEYS,
    },
  });

  console.log("Seeded default admin user (username: admin, password: admin123)");

  // Single authoritative list, shared with scripts/init-insurance-types.ts
  // — see insuranceTypesData.ts's doc comment for why this must never be a
  // second, independently-maintained copy (a "CAR" gap here is exactly what
  // caused every CAR Package quotation save to fail in production).
  for (const insuranceType of ALL_INSURANCE_TYPES) {
    await prisma.insuranceType.upsert({
      where: { code: insuranceType.code },
      update: {},
      create: insuranceType,
    });
  }

  console.log(`Seeded ${ALL_INSURANCE_TYPES.length} insurance types (${ALL_INSURANCE_TYPES.map((t) => t.code).join(", ")})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
