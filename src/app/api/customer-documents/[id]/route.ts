import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { storageService } from "@/lib/storage";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "customer")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  const document = await prisma.customerDocument.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const file = await storageService.getFile(document.storageKey);
  if (!file) {
    console.error(`Document ${id} has no readable file at ${document.storageKey}`);
    return NextResponse.json({ error: "FILE_NOT_FOUND" }, { status: 404 });
  }

  const mode = req.nextUrl.searchParams.get("mode") === "download" ? "attachment" : "inline";
  const safeName = document.originalFileName.replace(/["\r\n]/g, "");

  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `${mode}; filename="${safeName}"`,
      "Content-Length": String(document.fileSize),
      "Cache-Control": "private, no-store",
    },
  });
}
