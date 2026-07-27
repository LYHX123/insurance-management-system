"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/permissions";
import { policyDocumentStorage } from "@/lib/policyDocuments/storage";
import { validateUploadedFile } from "@/lib/policyDocuments/validateUpload";
import { generateStoredFileName } from "@/lib/policyDocuments/constants";
import { recordPolicyActivity } from "@/lib/policy/activity";
import { PolicyDocumentType } from "@/generated/prisma/enums";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

const DOCUMENT_TYPES = Object.values(PolicyDocumentType);

async function requirePolicyPermission() {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, "policy.motor")) return null;
  return session;
}

export type UploadPolicyDocumentResult = { id: string };

// One file per call, same reasoning as uploadQuotationDocumentAction: keeps
// each request comfortably under next.config.ts's serverActions body-size
// limit even for the largest single allowed file.
export async function uploadPolicyDocumentAction(formData: FormData): Promise<ActionResult<UploadPolicyDocumentResult>> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const policyRecordId = String(formData.get("policyRecordId") || "");
  const documentType = String(formData.get("documentType") || "");
  const issueDateRaw = String(formData.get("issueDate") || "").trim();
  const expiryDateRaw = String(formData.get("expiryDate") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  const file = formData.get("file");

  if (!policyRecordId) return { success: false, error: "RECORD_NOT_FOUND" };
  if (!DOCUMENT_TYPES.includes(documentType as PolicyDocumentType)) {
    return { success: false, error: "INVALID_DOCUMENT_TYPE" };
  }
  if (!(file instanceof File)) return { success: false, error: "NO_FILE" };

  const record = await prisma.policyRecord.findUnique({ where: { id: policyRecordId, deletedAt: null }, select: { id: true } });
  if (!record) return { success: false, error: "RECORD_NOT_FOUND" };

  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateUploadedFile(file.name, file.type, file.size, buffer);
  if (!validation.ok) return { success: false, error: validation.error };

  const storedFileName = generateStoredFileName(validation.extension);
  const documentFolderId = randomUUID();

  let storagePath: string;
  try {
    const saved = await policyDocumentStorage.saveFile({
      policyRecordId,
      documentFolderId,
      fileName: storedFileName,
      buffer,
    });
    storagePath = saved.storagePath;
  } catch (err) {
    console.error(`Failed to store policy document for record ${policyRecordId}:`, err);
    return { success: false, error: "UPLOAD_FAILED" };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const document = await tx.policyDocument.create({
        data: {
          policyRecordId,
          documentType: documentType as PolicyDocumentType,
          originalFileName: file.name,
          storedFileName,
          mimeType: file.type,
          fileSize: file.size,
          storageProvider: "LOCAL",
          storagePath,
          issueDate: issueDateRaw ? new Date(issueDateRaw) : null,
          expiryDate: expiryDateRaw ? new Date(expiryDateRaw) : null,
          notes: notes || null,
          uploadedById: session.user.id,
        },
      });
      await recordPolicyActivity(tx, {
        policyRecordId,
        actionType: "DOCUMENT_UPLOADED",
        summary: `${documentTypeSummaryLabel(documentType as PolicyDocumentType)} uploaded: ${file.name}`,
        performedById: session.user.id,
      });
      return document;
    });
    revalidatePath(`/policy/motor/${policyRecordId}`);
    return { success: true, id: created.id };
  } catch (err) {
    // Database write failed after the file was already written to disk —
    // clean up the orphaned file so it doesn't linger without a DB record.
    console.error(`Failed to save document record for policy ${policyRecordId}, cleaning up uploaded file:`, err);
    await policyDocumentStorage.deleteFile(storagePath).catch(() => {});
    return { success: false, error: "SAVE_FAILED" };
  }
}

function documentTypeSummaryLabel(type: PolicyDocumentType): string {
  const labels: Record<PolicyDocumentType, string> = {
    POLICY_SCHEDULE: "Policy Schedule",
    CERTIFICATE: "Certificate",
    STICKER: "Sticker",
    DEBIT_NOTE: "Debit Note",
    RECEIPT: "Receipt",
    ENDORSEMENT: "Endorsement",
    CANCELLATION: "Cancellation",
    OTHER: "Document",
  };
  return labels[type];
}

// Hard delete (Section 3/5 of this phase's spec, unlike QuotationDocument's
// soft delete): removes the DB row first, then attempts the physical file —
// if file deletion fails, the DB row is already gone and the orphaned file
// is merely wasted disk space, not a dangling reference (logged for manual
// cleanup rather than left as a broken "phantom" document record).
export async function deletePolicyDocumentAction(id: string): Promise<ActionResult> {
  const session = await requirePolicyPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const document = await prisma.policyDocument.findUnique({ where: { id } });
  if (!document) return { success: false, error: "DOCUMENT_NOT_FOUND" };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.policyDocument.delete({ where: { id } });
      await recordPolicyActivity(tx, {
        policyRecordId: document.policyRecordId,
        actionType: "DOCUMENT_DELETED",
        summary: `Document deleted: ${document.originalFileName}`,
        performedById: session.user.id,
      });
    });
  } catch (err) {
    console.error(`Failed to delete policy document ${id}:`, err);
    return { success: false, error: "DELETE_FAILED" };
  }

  try {
    await policyDocumentStorage.deleteFile(document.storagePath);
  } catch (err) {
    console.error(`Policy document ${id}'s DB record was deleted but its file could not be removed:`, err);
  }

  revalidatePath(`/policy/motor/${document.policyRecordId}`);
  return { success: true };
}
