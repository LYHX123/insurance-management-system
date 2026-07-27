// Phase 3A: template-based Excel export using the modular quotation
// template engine (src/lib/quotationTemplateEngine/). Deliberately a
// separate route/path from src/app/api/quotation/[id]/excel/route.ts, which
// is the pre-existing generic exporter and must remain untouched and
// functional per the Phase 3A instructions ("do not remove the old generic
// Excel exporter yet").
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import {
  generateQuotationExcel,
  TemplateGenerationError,
  type QuotationForExport,
} from "@/lib/quotationTemplateEngine";
import { buildRevisionExcelFilename } from "@/lib/quotationRevisions/excelFilename";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "quotation")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;

  const quotation: QuotationForExport | null = await prisma.quotation.findUnique({
    where: { id },
    include: {
      customer: { select: { companyName: true } },
      project: { select: { projectName: true } },
      sections: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: true,
          carDetail: true,
          wibaDetail: { include: { payrollRows: true } },
          elDetail: true,
          cpmDetail: { include: { equipmentRows: true } },
          publicLiabilityDetail: true,
          fireDetail: true,
          burglaryDetail: true,
          gitSingleDetail: true,
          gitAnnualDetail: true,
          marineDetail: { include: { shipmentRows: true } },
          motorCompPrivateDetail: true,
          motorCompCommercialDetail: true,
          motorTpoPrivateDetail: true,
          motorTpoCommercialDetail: true,
          gpaDetail: true,
          medicalDetail: { include: { categoryRows: true } },
          tenderSecurityDetail: true,
          performanceBondDetail: true,
          advancePaymentGuaranteeDetail: true,
          customsBondDetail: { include: { itemRows: true } },
        },
      },
    },
  });

  if (!quotation) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  try {
    const { buffer } = await generateQuotationExcel(quotation);
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
  } catch (err) {
    if (err instanceof TemplateGenerationError) {
      console.error(`Template Excel export failed for quotation ${id}: ${err.message}`, err.details);
    } else {
      console.error(`Template Excel export failed for quotation ${id}:`, err);
    }
    return NextResponse.json({ error: "EXPORT_FAILED" }, { status: 500 });
  }
}
