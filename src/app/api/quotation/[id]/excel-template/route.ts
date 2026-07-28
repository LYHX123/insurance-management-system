// Phase 3A: template-based Excel export using the modular quotation
// template engine (src/lib/quotationTemplateEngine/). Deliberately a
// separate route/path from src/app/api/quotation/[id]/excel/route.ts, which
// is the pre-existing generic exporter and must remain untouched and
// functional per the Phase 3A instructions ("do not remove the old generic
// Excel exporter yet").
//
// Dropbox Integration Phase 4: this is "the current existing workflow" Part
// 8 hooks into — generation now also persists the Excel locally and
// attempts a bounded Dropbox sync (business folder -> Quotation subfolder)
// via generateAndSyncQuotationExcel. The browser-facing download filename
// is deliberately unchanged (still buildRevisionExcelFilename); only the
// Dropbox-stored copy uses the new standardized business-file naming.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { buildRevisionExcelFilename } from "@/lib/quotationRevisions/excelFilename";
import { buildContentDisposition } from "@/lib/http/contentDisposition";
import { generateAndSyncQuotationExcel } from "@/lib/integrations/dropbox/quotationDropboxSync";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "quotation")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;

  const quotationSummary = await prisma.quotation.findUnique({
    where: { id },
    select: {
      quotationNumber: true,
      revisionCode: true,
      customer: { select: { companyName: true } },
      sections: { select: { insuranceTypeNameSnapshot: true } },
    },
  });
  if (!quotationSummary) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const result = await generateAndSyncQuotationExcel(id);
  if (!result.success) {
    if (result.error === "QUOTATION_NOT_FOUND") {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    console.error(`Excel generation/sync failed for quotation ${id}: ${result.error}`);
    return NextResponse.json({ error: "EXPORT_FAILED" }, { status: 500 });
  }

  const filename = buildRevisionExcelFilename({
    quotationNumber: quotationSummary.quotationNumber,
    revisionCode: quotationSummary.revisionCode,
    customerName: quotationSummary.customer.companyName,
    insuranceTypeNames: quotationSummary.sections.map((s) => s.insuranceTypeNameSnapshot),
  });

  return new NextResponse(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": buildContentDisposition({
        mode: "attachment",
        filename,
        fallbackFilename: "quotation.xlsx",
      }),
      "Cache-Control": "private, no-store",
    },
  });
}
