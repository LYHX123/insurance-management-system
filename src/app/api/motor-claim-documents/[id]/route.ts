import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkMotorClaimAccess } from "@/lib/claims/access";
import { motorClaimDocumentStorage } from "@/lib/claimDocuments/storage";
import { buildContentDisposition } from "@/lib/http/contentDisposition";

// Protected download route — mode=download forces Content-Disposition:
// attachment; anything else (the default) is inline. Gated by
// checkMotorClaimAccess (participant-scoped, same visibility rule as the
// Claim detail page itself — Part 13, requirement 7: Dropbox metadata must
// never let an otherwise-unauthorized user discover a Claim), not just the
// module permission alone.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = await prisma.motorClaimDocument.findUnique({ where: { id }, select: { motorClaimId: true, storagePath: true, mimeType: true, originalFileName: true, fileSize: true } });
  if (!document) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const access = await checkMotorClaimAccess(document.motorClaimId);
  if (access.kind !== "ok") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const exists = await motorClaimDocumentStorage.fileExists(document.storagePath);
  if (!exists) {
    console.error(`Motor Claim document ${id} has no readable file in storage.`);
    return NextResponse.json({ error: "FILE_MISSING" }, { status: 404 });
  }

  let nodeStream;
  try {
    nodeStream = await motorClaimDocumentStorage.openFile(document.storagePath);
  } catch (err) {
    console.error(`Failed to open Motor Claim document ${id}:`, err);
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
