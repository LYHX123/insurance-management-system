"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { generateQuotationNumber } from "@/lib/quotation-utils";
import {
  calculateCoverageItemPremium,
  calculateQuotationTotals,
  calculateSectionTotals,
  toDecimal,
  type QuotationTotals,
  type SectionTotals,
} from "@/lib/money";
import { Prisma } from "@/generated/prisma/client";
import type { CalculationMethod, QuotationStatus } from "@/generated/prisma/enums";

type ActionResult<T = object> =
  | ({ success: true } & T)
  | { success: false; error: string };

type ValidationError = { error: string };
type CustomerProjectCheckResult = ValidationError | { ok: true };
type SectionBuildResult =
  | ValidationError
  | {
      sectionCreates: Prisma.QuotationInsuranceSectionCreateWithoutQuotationInput[];
      quotationTotals: QuotationTotals;
    };

export type CoverageItemInput = {
  insuredContent: string;
  sumInsured?: number | string | null;
  rate?: number | string | null;
  calculationMethod: CalculationMethod;
  premium?: number | string | null;
  notes?: string | null;
};

export type SectionInput = {
  insuranceTypeId: string;
  description?: string | null;
  phcfRate: number | string;
  itlRate: number | string;
  stampDuty: number | string;
  applyPHCF: boolean;
  applyITL: boolean;
  applyStampDuty: boolean;
  clausesSnapshot?: string | null;
  exclusionsSnapshot?: string | null;
  conditionsSnapshot?: string | null;
  items: CoverageItemInput[];
};

export type QuotationInput = {
  customerId: string;
  projectId?: string | null;
  quotationDate?: string | null;
  validUntil?: string | null;
  currency?: string;
  internalNotes?: string | null;
  sections: SectionInput[];
};

async function requireQuotationPermission() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "quotation")) {
    return null;
  }
  return session;
}

function isBlank(value: number | string | null | undefined): boolean {
  return value === null || value === undefined || value === "";
}

function validateItem(
  item: CoverageItemInput
):
  | { error: string }
  | {
      insuredContent: string;
      sumInsured: Prisma.Decimal | null;
      rate: Prisma.Decimal | null;
      calculationMethod: CalculationMethod;
      premium: Prisma.Decimal;
      notes: string | null;
    } {
  const insuredContent = item.insuredContent.trim();
  if (!insuredContent) return { error: "ITEM_CONTENT_REQUIRED" };

  if (item.calculationMethod === "PERCENTAGE") {
    if (isBlank(item.sumInsured)) return { error: "ITEM_SUM_INSURED_REQUIRED" };
    if (isBlank(item.rate)) return { error: "ITEM_RATE_REQUIRED" };
  } else if (isBlank(item.premium)) {
    return { error: "ITEM_PREMIUM_REQUIRED" };
  }

  const premium = calculateCoverageItemPremium({
    calculationMethod: item.calculationMethod,
    sumInsured: item.sumInsured,
    rate: item.rate,
    premium: item.premium,
  });

  return {
    insuredContent,
    sumInsured: isBlank(item.sumInsured) ? null : toDecimal(item.sumInsured),
    rate: isBlank(item.rate) ? null : toDecimal(item.rate),
    calculationMethod: item.calculationMethod,
    premium,
    notes: item.notes?.trim() || null,
  };
}

async function buildSectionCreates(sections: SectionInput[]): Promise<SectionBuildResult> {
  if (!sections || sections.length === 0) {
    return { error: "AT_LEAST_ONE_SECTION" };
  }

  const insuranceTypes = await prisma.insuranceType.findMany({
    where: { id: { in: sections.map((s) => s.insuranceTypeId) } },
  });
  const insuranceTypeById = new Map(insuranceTypes.map((it) => [it.id, it]));

  const sectionCreates: Prisma.QuotationInsuranceSectionCreateWithoutQuotationInput[] = [];
  const sectionTotalsList: SectionTotals[] = [];

  for (let sIndex = 0; sIndex < sections.length; sIndex++) {
    const section = sections[sIndex];
    const insuranceType = insuranceTypeById.get(section.insuranceTypeId);
    if (!insuranceType) return { error: "INSURANCE_TYPE_NOT_FOUND" };

    if (!section.items || section.items.length === 0) {
      return { error: "AT_LEAST_ONE_ITEM" };
    }

    const itemCreates: Prisma.QuotationCoverageItemCreateWithoutSectionInput[] = [];
    const itemPremiums: Prisma.Decimal[] = [];

    for (const item of section.items) {
      const validated = validateItem(item);
      if ("error" in validated) return { error: validated.error };
      itemCreates.push({ ...validated, sortOrder: itemCreates.length });
      itemPremiums.push(validated.premium);
    }

    const totals = calculateSectionTotals({
      applyPHCF: section.applyPHCF,
      phcfRate: section.phcfRate,
      applyITL: section.applyITL,
      itlRate: section.itlRate,
      applyStampDuty: section.applyStampDuty,
      stampDuty: section.stampDuty,
      itemPremiums,
    });
    sectionTotalsList.push(totals);

    sectionCreates.push({
      insuranceType: { connect: { id: insuranceType.id } },
      insuranceTypeNameSnapshot: insuranceType.name,
      description: section.description?.trim() || null,
      phcfRate: toDecimal(section.phcfRate),
      itlRate: toDecimal(section.itlRate),
      stampDuty: toDecimal(section.stampDuty),
      applyPHCF: section.applyPHCF,
      applyITL: section.applyITL,
      applyStampDuty: section.applyStampDuty,
      clausesSnapshot: section.clausesSnapshot?.trim() || null,
      exclusionsSnapshot: section.exclusionsSnapshot?.trim() || null,
      conditionsSnapshot: section.conditionsSnapshot?.trim() || null,
      basePremium: totals.basePremium,
      phcfAmount: totals.phcfAmount,
      itlAmount: totals.itlAmount,
      sectionTotal: totals.sectionTotal,
      sortOrder: sIndex,
      items: { create: itemCreates },
    });
  }

  return { sectionCreates, quotationTotals: calculateQuotationTotals(sectionTotalsList) };
}

async function validateCustomerAndProject(
  customerId: string,
  projectId: string | null | undefined
): Promise<CustomerProjectCheckResult> {
  if (!customerId) return { error: "CUSTOMER_REQUIRED" };

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return { error: "CUSTOMER_NOT_FOUND" };

  if (projectId) {
    const project = await prisma.customerProject.findUnique({ where: { id: projectId } });
    if (!project || project.customerId !== customerId) {
      return { error: "PROJECT_NOT_BELONG_TO_CUSTOMER" };
    }
  }

  return { ok: true };
}

export async function createQuotationAction(
  data: QuotationInput
): Promise<ActionResult<{ id: string; quotationNumber: string }>> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const customerCheck = await validateCustomerAndProject(data.customerId, data.projectId);
  if ("error" in customerCheck) return { success: false, error: customerCheck.error };

  const built = await buildSectionCreates(data.sections);
  if ("error" in built) return { success: false, error: built.error };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const quotationNumber = await generateQuotationNumber(tx);
      return tx.quotation.create({
        data: {
          quotationNumber,
          customerId: data.customerId,
          projectId: data.projectId || null,
          quotationDate: data.quotationDate ? new Date(data.quotationDate) : new Date(),
          validUntil: data.validUntil ? new Date(data.validUntil) : null,
          currency: data.currency?.trim() || "KES",
          internalNotes: data.internalNotes?.trim() || null,
          status: "DRAFT",
          subtotalPremium: built.quotationTotals.subtotalPremium,
          totalPHCF: built.quotationTotals.totalPHCF,
          totalITL: built.quotationTotals.totalITL,
          totalStampDuty: built.quotationTotals.totalStampDuty,
          grandTotal: built.quotationTotals.grandTotal,
          createdBy: session.user.id,
          sections: { create: built.sectionCreates },
        },
      });
    });

    revalidatePath("/quotation");
    return { success: true, id: result.id, quotationNumber: result.quotationNumber };
  } catch (err) {
    console.error("Failed to create quotation:", err);
    return { success: false, error: "CREATE_FAILED" };
  }
}

export async function updateQuotationAction(
  id: string,
  data: QuotationInput
): Promise<ActionResult> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const existing = await prisma.quotation.findUnique({ where: { id } });
  if (!existing) return { success: false, error: "QUOTATION_NOT_FOUND" };

  const customerCheck = await validateCustomerAndProject(data.customerId, data.projectId);
  if ("error" in customerCheck) return { success: false, error: customerCheck.error };

  const built = await buildSectionCreates(data.sections);
  if ("error" in built) return { success: false, error: built.error };

  try {
    await prisma.$transaction(async (tx) => {
      // Sections/items are always fully replaced on edit — cascade delete
      // removes the old coverage items along with their sections.
      await tx.quotationInsuranceSection.deleteMany({ where: { quotationId: id } });

      await tx.quotation.update({
        where: { id },
        data: {
          customerId: data.customerId,
          projectId: data.projectId || null,
          quotationDate: data.quotationDate ? new Date(data.quotationDate) : existing.quotationDate,
          validUntil: data.validUntil ? new Date(data.validUntil) : null,
          currency: data.currency?.trim() || "KES",
          internalNotes: data.internalNotes?.trim() || null,
          subtotalPremium: built.quotationTotals.subtotalPremium,
          totalPHCF: built.quotationTotals.totalPHCF,
          totalITL: built.quotationTotals.totalITL,
          totalStampDuty: built.quotationTotals.totalStampDuty,
          grandTotal: built.quotationTotals.grandTotal,
          sections: { create: built.sectionCreates },
        },
      });
    });

    revalidatePath("/quotation");
    revalidatePath(`/quotation/${id}`);
    return { success: true };
  } catch (err) {
    console.error("Failed to update quotation:", err);
    return { success: false, error: "UPDATE_FAILED" };
  }
}

export async function updateQuotationStatusAction(
  id: string,
  status: QuotationStatus
): Promise<ActionResult> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  await prisma.quotation.update({ where: { id }, data: { status } });

  revalidatePath("/quotation");
  revalidatePath(`/quotation/${id}`);
  return { success: true };
}
