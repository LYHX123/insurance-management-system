import { Readable } from "stream";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { invoiceDocumentStorage } from "@/lib/invoiceDocuments/storage";

// Protected download route, same shape/conventions as
// src/app/api/policy-documents/[id]/route.ts: auth + module permission,
// validated Invoice id (a not-found id or a missing/unreadable file both
// return a plain 404 — never a stack trace or a path), streamed back rather
// than buffered, download filename derived from the Invoice number (never
// the Customer name — see this phase's spec). Path traversal is impossible
// because storagePath is never taken from the request — it comes only from
// the resolved Invoice row's own generatedStoragePath, itself only ever
// written by createInvoiceAction via invoiceDocumentStorage.saveFile's own
// internal, non-request-derived path construction (see that module).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "invoice")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (!invoice.generatedStoragePath || !invoice.generatedFileName) {
    return NextResponse.json({ error: "FILE_NOT_AVAILABLE" }, { status: 404 });
  }

  const exists = await invoiceDocumentStorage.fileExists(invoice.generatedStoragePath);
  if (!exists) {
    console.error(`Invoice ${id} (${invoice.invoiceNumber}) has no readable file in storage.`);
    return NextResponse.json({ error: "FILE_MISSING" }, { status: 404 });
  }

  let nodeStream;
  try {
    nodeStream = await invoiceDocumentStorage.openFile(invoice.generatedStoragePath);
  } catch (err) {
    console.error(`Failed to open generated file for Invoice ${id}:`, err);
    return NextResponse.json({ error: "FILE_MISSING" }, { status: 404 });
  }

  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.xlsx"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
