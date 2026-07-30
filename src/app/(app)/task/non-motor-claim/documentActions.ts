"use server";

// Dropbox Integration Phase 7 — Non-Motor Claim document upload/delete.
// Mirrors motor-claim/documentActions.ts exactly.
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkNonMotorClaimAccess } from "@/lib/claims/access";
import { nonMotorClaimDocumentStorage } from "@/lib/claimDocuments/storage";
import { validateClaimUploadedFile, generateStoredClaimFileName } from "@/lib/claimDocuments/validateUpload";
import { syncNonMotorClaimDocumentWithTimeout } from "@/lib/integrations/dropbox/nonMotorClaimDocumentSync";
import { NonMotorClaimDocumentType } from "@/generated/prisma/enums";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

const DOCUMENT_TYPES = Object.values(NonMotorClaimDocumentType);

export type UploadNonMotorClaimDocumentResult = { id: string };

export async function uploadNonMotorClaimDocumentAction(formData: FormData): Promise<ActionResult<UploadNonMotorClaimDocumentResult>> {
  const nonMotorClaimId = String(formData.get("nonMotorClaimId") || "");
  const documentType = String(formData.get("documentType") || "");
  const notes = String(formData.get("notes") || "").trim();
  const file = formData.get("file");

  if (!nonMotorClaimId) return { success: false, error: "CLAIM_NOT_FOUND" };
  if (!DOCUMENT_TYPES.includes(documentType as NonMotorClaimDocumentType)) {
    return { success: false, error: "INVALID_DOCUMENT_TYPE" };
  }
  if (!(file instanceof File)) return { success: false, error: "NO_FILE" };

  const access = await checkNonMotorClaimAccess(nonMotorClaimId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };

  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateClaimUploadedFile(file.name, file.type, file.size, buffer);
  if (!validation.ok) return { success: false, error: validation.error };

  const storedFileName = generateStoredClaimFileName(validation.extension);
  const documentFolderId = randomUUID();

  let storagePath: string;
  try {
    const saved = await nonMotorClaimDocumentStorage.saveFile({ claimId: nonMotorClaimId, documentFolderId, fileName: storedFileName, buffer });
    storagePath = saved.storagePath;
  } catch (err) {
    console.error(`Failed to store Non-Motor Claim document for claim ${nonMotorClaimId}:`, err);
    return { success: false, error: "UPLOAD_FAILED" };
  }

  let createdId: string;
  try {
    const created = await prisma.nonMotorClaimDocument.create({
      data: {
        nonMotorClaimId,
        documentType: documentType as NonMotorClaimDocumentType,
        originalFileName: file.name,
        storedFileName,
        mimeType: file.type,
        fileSize: file.size,
        storagePath,
        notes: notes || null,
        uploadedById: access.userId,
      },
    });
    createdId = created.id;
  } catch (err) {
    console.error("Failed to create Non-Motor Claim document record:", err);
    return { success: false, error: "UPLOAD_FAILED" };
  }

  await syncNonMotorClaimDocumentWithTimeout(createdId).catch(() => {});

  revalidatePath(`/task/non-motor-claim/${nonMotorClaimId}`);
  return { success: true, id: createdId };
}

export async function deleteNonMotorClaimDocumentAction(documentId: string): Promise<ActionResult> {
  const document = await prisma.nonMotorClaimDocument.findUnique({ where: { id: documentId }, select: { nonMotorClaimId: true, storagePath: true } });
  if (!document) return { success: false, error: "CLAIM_DOCUMENT_NOT_FOUND" };

  const access = await checkNonMotorClaimAccess(document.nonMotorClaimId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };

  try {
    await prisma.nonMotorClaimDocument.delete({ where: { id: documentId } });
  } catch (err) {
    console.error(`Failed to delete Non-Motor Claim document ${documentId}:`, err);
    return { success: false, error: "DELETE_FAILED" };
  }

  try {
    await nonMotorClaimDocumentStorage.deleteFile(document.storagePath);
  } catch (err) {
    console.error(`Non-Motor Claim document ${documentId} was deleted but its local file could not be removed (${document.storagePath}):`, err);
  }

  revalidatePath(`/task/non-motor-claim/${document.nonMotorClaimId}`);
  return { success: true };
}
