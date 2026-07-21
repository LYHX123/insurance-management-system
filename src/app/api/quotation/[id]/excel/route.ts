import { NextRequest, NextResponse } from "next/server";
import type ExcelJS from "exceljs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import {
  exportQuotationExcel,
  type QuotationExportData,
} from "@/lib/excel/quotation-export";
import { buildRevisionExcelFilename } from "@/lib/quotationRevisions/excelFilename";

function toNumber(value: { toNumber(): number } | null | undefined): number | null {
  return value ? value.toNumber() : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "quotation")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;

  const quotation = await prisma.quotation.findUnique({
    where: { id },
    include: {
      customer: { select: { companyName: true } },
      project: { select: { projectName: true } },
      sections: {
        orderBy: { sortOrder: "asc" },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });

  if (!quotation) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const creator = await prisma.user.findUnique({
    where: { id: quotation.createdBy },
    select: { fullName: true, username: true },
  });

  const exportData: QuotationExportData = {
    quotationNumber: quotation.quotationNumber,
    quotationDate: quotation.quotationDate,
    validUntil: quotation.validUntil,
    customerName: quotation.customer.companyName,
    projectName: quotation.project?.projectName ?? null,
    preparedBy: creator ? creator.fullName || creator.username : "—",
    currency: quotation.currency,
    subtotalPremium: quotation.subtotalPremium.toNumber(),
    totalPHCF: quotation.totalPHCF.toNumber(),
    totalITL: quotation.totalITL.toNumber(),
    totalStampDuty: quotation.totalStampDuty.toNumber(),
    grandTotal: quotation.grandTotal.toNumber(),
    sections: quotation.sections.map((section) => ({
      insuranceTypeName: section.insuranceTypeNameSnapshot,
      basePremium: section.basePremium.toNumber(),
      applyPHCF: section.applyPHCF,
      phcfRate: section.phcfRate.toNumber(),
      phcfAmount: section.phcfAmount.toNumber(),
      applyITL: section.applyITL,
      itlRate: section.itlRate.toNumber(),
      itlAmount: section.itlAmount.toNumber(),
      applyStampDuty: section.applyStampDuty,
      stampDuty: section.stampDuty.toNumber(),
      sectionTotal: section.sectionTotal.toNumber(),
      clauses: section.clausesSnapshot,
      exclusions: section.exclusionsSnapshot,
      conditions: section.conditionsSnapshot,
      items: section.items.map((item) => ({
        insuredContent: item.insuredContent,
        sumInsured: toNumber(item.sumInsured),
        rate: toNumber(item.rate),
        premium: item.premium.toNumber(),
      })),
    })),
  };

  let buffer: ExcelJS.Buffer;
  try {
    buffer = await exportQuotationExcel(exportData);
  } catch (err) {
    console.error(`Failed to generate Excel export for quotation ${id}:`, err);
    return NextResponse.json({ error: "EXPORT_FAILED" }, { status: 500 });
  }

  const filename = buildRevisionExcelFilename({
    quotationNumber: quotation.quotationNumber,
    revisionCode: quotation.revisionCode,
    customerName: quotation.customer.companyName,
    insuranceTypeNames: quotation.sections.map((s) => s.insuranceTypeNameSnapshot),
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
