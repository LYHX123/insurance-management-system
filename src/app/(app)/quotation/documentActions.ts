"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { documentStorageService, sha256Checksum } from "@/lib/quotationDocuments/storage";
import { validateUploadedFile } from "@/lib/quotationDocuments/validateUpload";
import { generateStoredFileName } from "@/lib/quotationDocuments/constants";
import { QuotationDocumentType } from "@/generated/prisma/enums";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

const DOCUMENT_TYPES = Object.values(QuotationDocumentType);

async function requireQuotationPermission() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "quotation")) {
    return null;
  }
  return session;
}

// --- Upload ---------------------------------------------------------------
// One file per call by design: the client loops over the selected FileList
// and calls this once per file, collecting per-file success/failure — see
// the upload modal component. This keeps every request's body comfortably
// under next.config.ts's existing serverActions.bodySizeLimit (25mb) even
// with a 10-file selection, instead of raising that limit ~10x to allow one
// giant multi-file body.
export async function uploadQuotationDocumentAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const quotationCaseId = String(formData.get("quotationCaseId") || "");
  const documentType = String(formData.get("documentType") || "");
  const customTypeName = String(formData.get("customTypeName") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const documentDateRaw = String(formData.get("documentDate") || "").trim();
  const file = formData.get("file");

  if (!quotationCaseId) return { success: false, error: "CASE_NOT_FOUND" };
  if (!DOCUMENT_TYPES.includes(documentType as QuotationDocumentType)) {
    return { success: false, error: "INVALID_DOCUMENT_TYPE" };
  }
  if (documentType === QuotationDocumentType.OTHER && !customTypeName) {
    return { success: false, error: "CUSTOM_TYPE_REQUIRED" };
  }
  if (!(file instanceof File)) return { success: false, error: "NO_FILE" };

  const quotationCase = await prisma.quotationCase.findUnique({ where: { id: quotationCaseId }, select: { id: true } });
  if (!quotationCase) return { success: false, error: "CASE_NOT_FOUND" };

  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateUploadedFile(file.name, file.type, file.size, buffer);
  if (!validation.ok) return { success: false, error: validation.error };

  const documentDate = documentDateRaw ? new Date(documentDateRaw) : null;
  const storedFileName = generateStoredFileName(validation.extension);
  const documentFolderId = randomUUID();
  const checksum = sha256Checksum(buffer);

  let storagePath: string;
  try {
    const saved = await documentStorageService.saveFile({
      quotationCaseId,
      documentFolderId,
      fileName: storedFileName,
      buffer,
    });
    storagePath = saved.storagePath;
  } catch (err) {
    console.error(`Failed to store quotation document for case ${quotationCaseId}:`, err);
    return { success: false, error: "UPLOAD_FAILED" };
  }

  try {
    const created = await prisma.quotationDocument.create({
      data: {
        quotationCaseId,
        documentType: documentType as QuotationDocumentType,
        customTypeName: documentType === QuotationDocumentType.OTHER ? customTypeName : null,
        originalFileName: file.name,
        storedFileName,
        mimeType: file.type,
        fileExtension: validation.extension,
        fileSize: file.size,
        description: description || null,
        documentDate,
        storageProvider: "LOCAL",
        storagePath,
        checksum,
        syncStatus: "NOT_APPLICABLE",
        uploadedById: session.user.id,
      },
    });
    revalidatePath(`/quotation/case/${quotationCaseId}`);
    return { success: true, id: created.id };
  } catch (err) {
    // Database write failed after the file was already written to disk —
    // clean up the orphaned file so it doesn't linger without a DB record
    // (see Phase 2 spec's upload-transaction requirement).
    console.error(`Failed to save document record for case ${quotationCaseId}, cleaning up uploaded file:`, err);
    await documentStorageService.deleteFile(storagePath).catch(() => {});
    return { success: false, error: "SAVE_FAILED" };
  }
}

// --- Edit metadata ----------------------------------------------------------
// Metadata only — never replaces the physical file. A replacement is a new
// upload + delete of the old row, per the Phase 2 spec, so the audit trail
// (who uploaded what, when) stays intact instead of being silently mutated.
export async function updateQuotationDocumentAction(
  id: string,
  data: { documentType: string; customTypeName: string; description: string; documentDate: string }
): Promise<ActionResult> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  if (!DOCUMENT_TYPES.includes(data.documentType as QuotationDocumentType)) {
    return { success: false, error: "INVALID_DOCUMENT_TYPE" };
  }
  const customTypeName = data.customTypeName.trim();
  if (data.documentType === QuotationDocumentType.OTHER && !customTypeName) {
    return { success: false, error: "CUSTOM_TYPE_REQUIRED" };
  }

  const document = await prisma.quotationDocument.findUnique({ where: { id } });
  if (!document || document.deletedAt) return { success: false, error: "DOCUMENT_NOT_FOUND" };

  await prisma.quotationDocument.update({
    where: { id },
    data: {
      documentType: data.documentType as QuotationDocumentType,
      customTypeName: data.documentType === QuotationDocumentType.OTHER ? customTypeName : null,
      description: data.description.trim() || null,
      documentDate: data.documentDate ? new Date(data.documentDate) : null,
      updatedById: session.user.id,
    },
  });

  revalidatePath(`/quotation/case/${document.quotationCaseId}`);
  return { success: true };
}

// --- Soft delete ------------------------------------------------------------
// The physical file is deliberately kept on disk (Phase 2 spec: "Keep the
// physical file during Phase 2 soft-delete for recoverability"). To
// restore a mistakenly deleted document, an administrator can currently
// only do so directly in the database:
//   UPDATE "QuotationDocument" SET "deletedAt" = NULL, "deletedById" = NULL
//   WHERE id = '<document id>';
// — no restore UI is provided in Phase 2 (the spec asks for one only "if
// simple and safe"; a raw SQL statement is safer than a half-built UI with
// no audit trail of its own).
export async function deleteQuotationDocumentAction(id: string): Promise<ActionResult> {
  const session = await requireQuotationPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const document = await prisma.quotationDocument.findUnique({ where: { id } });
  if (!document || document.deletedAt) return { success: false, error: "DOCUMENT_NOT_FOUND" };

  await prisma.quotationDocument.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: session.user.id },
  });

  revalidatePath(`/quotation/case/${document.quotationCaseId}`);
  return { success: true };
}
