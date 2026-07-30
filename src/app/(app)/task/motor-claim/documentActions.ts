"use server";

// Dropbox Integration Phase 7 — Motor Claim document upload/delete. No
// document feature existed for Claims before this phase (confirmed by
// inspection) — this file is genuinely new, mirroring policy/motor/
// documentActions.ts's shape but simpler: no pre-created PENDING sync row
// (the sync service itself handles first-time creation, same pattern
// invoiceDocumentSync.ts/createInvoiceAction already use).
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkMotorClaimAccess } from "@/lib/claims/access";
import { motorClaimDocumentStorage } from "@/lib/claimDocuments/storage";
import { validateClaimUploadedFile, generateStoredClaimFileName } from "@/lib/claimDocuments/validateUpload";
import { syncMotorClaimDocumentWithTimeout } from "@/lib/integrations/dropbox/motorClaimDocumentSync";
import { MotorClaimDocumentType } from "@/generated/prisma/enums";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

const DOCUMENT_TYPES = Object.values(MotorClaimDocumentType);

export type UploadMotorClaimDocumentResult = { id: string };

export async function uploadMotorClaimDocumentAction(formData: FormData): Promise<ActionResult<UploadMotorClaimDocumentResult>> {
  const motorClaimId = String(formData.get("motorClaimId") || "");
  const documentType = String(formData.get("documentType") || "");
  const notes = String(formData.get("notes") || "").trim();
  const file = formData.get("file");

  if (!motorClaimId) return { success: false, error: "CLAIM_NOT_FOUND" };
  if (!DOCUMENT_TYPES.includes(documentType as MotorClaimDocumentType)) {
    return { success: false, error: "INVALID_DOCUMENT_TYPE" };
  }
  if (!(file instanceof File)) return { success: false, error: "NO_FILE" };

  // Any participant, not creator-only, may upload — same gating
  // addMotorClaimUpdateAction uses for adding a timeline entry — but only
  // while the Claim is OPEN.
  const access = await checkMotorClaimAccess(motorClaimId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };

  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateClaimUploadedFile(file.name, file.type, file.size, buffer);
  if (!validation.ok) return { success: false, error: validation.error };

  const storedFileName = generateStoredClaimFileName(validation.extension);
  const documentFolderId = randomUUID();

  let storagePath: string;
  try {
    const saved = await motorClaimDocumentStorage.saveFile({ claimId: motorClaimId, documentFolderId, fileName: storedFileName, buffer });
    storagePath = saved.storagePath;
  } catch (err) {
    console.error(`Failed to store Motor Claim document for claim ${motorClaimId}:`, err);
    return { success: false, error: "UPLOAD_FAILED" };
  }

  let createdId: string;
  try {
    const created = await prisma.motorClaimDocument.create({
      data: {
        motorClaimId,
        documentType: documentType as MotorClaimDocumentType,
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
    console.error("Failed to create Motor Claim document record:", err);
    return { success: false, error: "UPLOAD_FAILED" };
  }

  // Dropbox Integration Phase 7 — called AFTER the local upload/DB record is
  // already durably committed, never inside the transaction above (Part 7,
  // requirements 1-2): a disconnected/unavailable/rate-limited/timed-out/
  // misconfigured Dropbox must never prevent the user from receiving the
  // just-uploaded document. Bounded/best-effort, never throws.
  await syncMotorClaimDocumentWithTimeout(createdId).catch(() => {});

  revalidatePath(`/task/motor-claim/${motorClaimId}`);
  return { success: true, id: createdId };
}

export async function deleteMotorClaimDocumentAction(documentId: string): Promise<ActionResult> {
  const document = await prisma.motorClaimDocument.findUnique({ where: { id: documentId }, select: { motorClaimId: true, storagePath: true } });
  if (!document) return { success: false, error: "CLAIM_DOCUMENT_NOT_FOUND" };

  const access = await checkMotorClaimAccess(document.motorClaimId);
  if (access.kind !== "ok") return { success: false, error: access.kind === "no-module-access" ? "FORBIDDEN" : "CLAIM_NOT_FOUND" };
  if (access.status !== "OPEN") return { success: false, error: "CLAIM_NOT_OPEN" };

  // DB row deleted first (dropboxSync row cascades away) — the Dropbox file
  // itself is deliberately NEVER touched (Part 11: "never call Dropbox
  // delete"). Local file removal is best-effort and non-fatal, mirroring
  // deletePolicyDocumentAction's DB-first/file-second/log-don't-fail
  // pattern.
  try {
    await prisma.motorClaimDocument.delete({ where: { id: documentId } });
  } catch (err) {
    console.error(`Failed to delete Motor Claim document ${documentId}:`, err);
    return { success: false, error: "DELETE_FAILED" };
  }

  try {
    await motorClaimDocumentStorage.deleteFile(document.storagePath);
  } catch (err) {
    console.error(`Motor Claim document ${documentId} was deleted but its local file could not be removed (${document.storagePath}):`, err);
  }

  revalidatePath(`/task/motor-claim/${document.motorClaimId}`);
  return { success: true };
}
