import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkNonMotorClaimAccess } from "@/lib/claims/access";
import { nonMotorClaimDocumentStorage } from "@/lib/claimDocuments/storage";
import { buildContentDisposition } from "@/lib/http/contentDisposition";

// Mirrors api/motor-claim-documents/[id]/route.ts exactly.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = await prisma.nonMotorClaimDocument.findUnique({ where: { id }, select: { nonMotorClaimId: true, storagePath: true, mimeType: true, originalFileName: true, fileSize: true } });
  if (!document) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const access = await checkNonMotorClaimAccess(document.nonMotorClaimId);
  if (access.kind !== "ok") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const exists = await nonMotorClaimDocumentStorage.fileExists(document.storagePath);
  if (!exists) {
    console.error(`Non-Motor Claim document ${id} has no readable file in storage.`);
    return NextResponse.json({ error: "FILE_MISSING" }, { status: 404 });
  }

  let nodeStream;
  try {
    nodeStream = await nonMotorClaimDocumentStorage.openFile(document.storagePath);
  } catch (err) {
    console.error(`Failed to open Non-Motor Claim document ${id}:`, err);
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
