import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { policyDocumentStorage } from "@/lib/policyDocuments/storage";

// Protected download route — mode=download forces Content-Disposition:
// attachment; anything else (the default) is inline. PolicyDocument rows are
// hard-deleted (see documentActions.ts), so "row not found" always means
// exactly that — no soft-delete distinction to hide here.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "policy")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  const document = await prisma.policyDocument.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const exists = await policyDocumentStorage.fileExists(document.storagePath);
  if (!exists) {
    console.error(`Policy document ${id} has no readable file in storage.`);
    return NextResponse.json({ error: "FILE_MISSING" }, { status: 404 });
  }

  let nodeStream;
  try {
    nodeStream = await policyDocumentStorage.openFile(document.storagePath);
  } catch (err) {
    console.error(`Failed to open policy document ${id}:`, err);
    return NextResponse.json({ error: "FILE_MISSING" }, { status: 404 });
  }

  const mode = req.nextUrl.searchParams.get("mode") === "download" ? "attachment" : "inline";
  const safeName = document.originalFileName.replace(/["\r\n]/g, "");
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `${mode}; filename="${safeName}"`,
      "Content-Length": String(document.fileSize),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
