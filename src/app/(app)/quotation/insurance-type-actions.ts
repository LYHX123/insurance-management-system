"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";

type ActionResult<T = object> =
  | ({ success: true } & T)
  | { success: false; error: string };

export type InsuranceTypeInput = {
  name: string;
  code: string;
  description?: string | null;
  defaultPHCFRate: number;
  defaultITLRate: number;
  defaultStampDuty: number;
  applyPHCF: boolean;
  applyITL: boolean;
  applyStampDuty: boolean;
  defaultClauses?: string | null;
  defaultExclusions?: string | null;
  defaultConditions?: string | null;
};

async function requireQuotationPermission() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "quotation")) {
    return null;
  }
  return session;
}

function validateInsuranceTypeInput(
  data: InsuranceTypeInput
): { error: string } | InsuranceTypeInput {
  const name = data.name.trim();
  const code = data.code.trim();
  if (!name) return { error: "NAME_REQUIRED" };
  if (!code) return { error: "CODE_REQUIRED" };
  if (
    !Number.isFinite(data.defaultPHCFRate) ||
    !Number.isFinite(data.defaultITLRate) ||
    !Number.isFinite(data.defaultStampDuty) ||
    data.defaultPHCFRate < 0 ||
    data.defaultITLRate < 0 ||
    data.defaultStampDuty < 0
  ) {
    return { error: "INVALID_RATE" };
  }

  return {
    ...data,
    name,
    code,
    description: data.description?.trim() || null,
    defaultClauses: data.defaultClauses?.trim() || null,
    defaultExclusions: data.defaultExclusions?.trim() || null,
    defaultConditions: data.defaultConditions?.trim() || null,
  };
}

export async function createInsuranceTypeAction(
  data: InsuranceTypeInput
): Promise<ActionResult<{ id: string }>> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const validated = validateInsuranceTypeInput(data);
  if ("error" in validated) return { success: false, error: validated.error };

  const existing = await prisma.insuranceType.findFirst({
    where: { code: { equals: validated.code, mode: "insensitive" } },
  });
  if (existing) return { success: false, error: "CODE_TAKEN" };

  const created = await prisma.insuranceType.create({ data: validated });

  revalidatePath("/quotation/insurance-types");
  return { success: true, id: created.id };
}

export async function updateInsuranceTypeAction(
  id: string,
  data: InsuranceTypeInput
): Promise<ActionResult> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const validated = validateInsuranceTypeInput(data);
  if ("error" in validated) return { success: false, error: validated.error };

  const existing = await prisma.insuranceType.findFirst({
    where: { code: { equals: validated.code, mode: "insensitive" }, NOT: { id } },
  });
  if (existing) return { success: false, error: "CODE_TAKEN" };

  await prisma.insuranceType.update({ where: { id }, data: validated });

  revalidatePath("/quotation/insurance-types");
  return { success: true };
}

export async function toggleInsuranceTypeActiveAction(
  id: string,
  active: boolean
): Promise<ActionResult> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  await prisma.insuranceType.update({ where: { id }, data: { active } });

  revalidatePath("/quotation/insurance-types");
  return { success: true };
}

export async function deleteInsuranceTypeAction(
  id: string
): Promise<ActionResult<{ deactivatedInstead: boolean }>> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const sectionCount = await prisma.quotationInsuranceSection.count({
    where: { insuranceTypeId: id },
  });

  if (sectionCount > 0) {
    await prisma.insuranceType.update({ where: { id }, data: { active: false } });
    revalidatePath("/quotation/insurance-types");
    return { success: true, deactivatedInstead: true };
  }

  await prisma.insuranceType.delete({ where: { id } });
  revalidatePath("/quotation/insurance-types");
  return { success: true, deactivatedInstead: false };
}
