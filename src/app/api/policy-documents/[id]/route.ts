import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, POLICY_CATEGORY_PERMISSION } from "@/lib/permissions";
import { policyDocumentStorage } from "@/lib/policyDocuments/storage";
import { buildContentDisposition } from "@/lib/http/contentDisposition";

// Protected download route — mode=download forces Content-Disposition:
// attachment; anything else (the default) is inline. PolicyDocument rows are
// hard-deleted (see documentActions.ts), so "row not found" always means
// exactly that — no soft-delete distinction to hide here.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  const document = await prisma.policyDocument.findUnique({
    where: { id },
    include: { policyRecord: { select: { category: true } } },
  });
  if (!document) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // A document belongs to exactly one Policy category (Motor/Non-Motor/
  // Bond/Work Permit) — check the permission for that specific category,
  // not just "any Policy access" (Part 6: a Motor-only user must not reach
  // a Non-Motor/Bond/Work Permit document even by guessing its id).
  const requiredPermission = POLICY_CATEGORY_PERMISSION[document.policyRecord.category];
  if (!hasPermission(session.user, requiredPermission)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
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
