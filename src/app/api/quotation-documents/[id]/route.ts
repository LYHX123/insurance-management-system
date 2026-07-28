import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { documentStorageService } from "@/lib/quotationDocuments/storage";
import { buildContentDisposition } from "@/lib/http/contentDisposition";

// Protected download/preview route. mode=download forces Content-Disposition:
// attachment; anything else (the default) is inline, used by the PDF/image
// preview panel — both paths share the exact same authorization checks, per
// the Phase 2 spec ("Preview must use the same authorization rules as
// download").
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "quotation")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  const document = await prisma.quotationDocument.findUnique({ where: { id } });
  // Soft-deleted or nonexistent both return a plain 404 — never reveal
  // which case (a document existed but was deleted vs. never existed).
  if (!document || document.deletedAt) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const exists = await documentStorageService.fileExists(document.storagePath);
  if (!exists) {
    console.error(`Quotation document ${id} has no readable file in storage.`);
    return NextResponse.json({ error: "FILE_MISSING" }, { status: 404 });
  }

  let nodeStream;
  try {
    nodeStream = await documentStorageService.openFile(document.storagePath);
  } catch (err) {
    console.error(`Failed to open quotation document ${id}:`, err);
    return NextResponse.json({ error: "FILE_MISSING" }, { status: 404 });
  }

  const mode = req.nextUrl.searchParams.get("mode") === "download" ? "attachment" : "inline";
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": buildContentDisposition({ mode, filename: document.originalFileName }),
      "Content-Length": String(document.fileSize),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
