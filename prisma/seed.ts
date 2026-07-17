import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";
import "dotenv/config";
import { ALL_MODULE_KEYS } from "../src/lib/permissions";

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

  const phase1InsuranceTypes = [
    { name: "WIBA", code: "WIBA", description: "Work Injury Benefits Act" },
    { name: "Employer's Liability", code: "EL", description: "Employer's Liability" },
    { name: "CPM", code: "CPM", description: "Standalone Contractor's Plant & Machinery" },
  ];

  for (const insuranceType of phase1InsuranceTypes) {
    await prisma.insuranceType.upsert({
      where: { code: insuranceType.code },
      update: {},
      create: insuranceType,
    });
  }

  console.log("Seeded Phase 1 insurance types (WIBA, EL, CPM)");

  const phase2aInsuranceTypes = [
    { name: "Public Liability", code: "PL", description: "Public Liability" },
    { name: "Fire & Perils", code: "FIRE", description: "Fire & Perils" },
    { name: "Burglary", code: "BURGLARY", description: "Burglary" },
    { name: "Goods in Transit - Single", code: "GIT_SINGLE", description: "Goods in Transit - Single" },
    { name: "Goods in Transit - Annual", code: "GIT_ANNUAL", description: "Goods in Transit - Annual" },
    { name: "Marine Cover", code: "MARINE", description: "Marine Cover" },
  ];

  for (const insuranceType of phase2aInsuranceTypes) {
    await prisma.insuranceType.upsert({
      where: { code: insuranceType.code },
      update: {},
      create: insuranceType,
    });
  }

  console.log("Seeded Phase 2A insurance types (PL, FIRE, BURGLARY, GIT_SINGLE, GIT_ANNUAL, MARINE)");

  const phase2bInsuranceTypes = [
    { name: "Motor Comprehensive - Private", code: "MOTOR_COMP_PRIVATE", description: "Motor Comprehensive - Private" },
    { name: "Motor Comprehensive - Commercial", code: "MOTOR_COMP_COMMERCIAL", description: "Motor Comprehensive - Commercial" },
    { name: "Motor TPO - Private", code: "MOTOR_TPO_PRIVATE", description: "Motor Third Party Only - Private" },
    { name: "Motor TPO - Commercial", code: "MOTOR_TPO_COMMERCIAL", description: "Motor Third Party Only - Commercial" },
    { name: "Group Personal Accident", code: "GPA", description: "Group Personal Accident" },
    { name: "Group Medical Insurance", code: "MEDICAL", description: "Group Medical Insurance" },
    { name: "Tender Security", code: "TENDER_SECURITY", description: "Tender Security Bond" },
    { name: "Performance Bond", code: "PERFORMANCE_BOND", description: "Performance Bond" },
    { name: "Advance Payment Guarantee", code: "APG", description: "Advance Payment Guarantee" },
    { name: "Customs Bond", code: "CUSTOMS_BOND", description: "Customs Bond" },
  ];

  for (const insuranceType of phase2bInsuranceTypes) {
    await prisma.insuranceType.upsert({
      where: { code: insuranceType.code },
      update: {},
      create: insuranceType,
    });
  }

  console.log("Seeded Phase 2B insurance types (Motor x4, GPA, Medical, Tender/PB/APG, Customs Bond)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
