// Production-safe, idempotent InsuranceType master-data initializer.
//
// Fixes the incident where the production InsuranceType table was
// completely empty, which made every quotation Save fail client-side
// before any network request was ever sent (quotation-form.tsx's
// insuranceTypeByCode.get(code) returned undefined for every code, so
// handleSubmit's `if (!xxxType) { setError(...); return; }` guard fired
// before createQuotationAction/updateQuotationAction were ever called).
//
// Unlike prisma/seed.ts, this script touches ONLY the InsuranceType table:
// - no admin/user creation
// - no password changes
// - no customers, quotations, invoices, or policies touched
// - upsert by unique `code`, so re-running it is always safe: existing
//   rows keep their id and are never duplicated, and only rows that don't
//   exist yet are created
//
// Usage (production): docker compose --profile production run --rm migrate npx tsx scripts/init-insurance-types.ts
// Usage (local):       npx tsx scripts/init-insurance-types.ts
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { ALL_INSURANCE_TYPES } from "../prisma/insuranceTypesData";

async function main() {
  const before = await prisma.insuranceType.count();
  console.log(`InsuranceType rows before: ${before}`);

  let created = 0;
  let alreadyPresent = 0;
  for (const insuranceType of ALL_INSURANCE_TYPES) {
    const existing = await prisma.insuranceType.findUnique({ where: { code: insuranceType.code } });
    await prisma.insuranceType.upsert({
      where: { code: insuranceType.code },
      update: {},
      create: insuranceType,
    });
    if (existing) alreadyPresent++;
    else created++;
  }

  const after = await prisma.insuranceType.count();
  console.log(`Created: ${created}, already present (untouched): ${alreadyPresent}`);
  console.log(`InsuranceType rows after: ${after}`);

  const rows = await prisma.insuranceType.findMany({ select: { code: true, active: true }, orderBy: { code: "asc" } });
  console.log("Current codes:", rows.map((r) => `${r.code}${r.active ? "" : " (inactive)"}`).join(", "));
}

main()
  .catch((e) => {
    console.error("InsuranceType initialization failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
