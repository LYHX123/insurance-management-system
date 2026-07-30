"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission, POLICY_CATEGORY_PERMISSION, POLICY_CATEGORY_ROUTES } from "@/lib/permissions";
import { policyDocumentStorage } from "@/lib/policyDocuments/storage";
import { validateUploadedFile } from "@/lib/policyDocuments/validateUpload";
import { generateStoredFileName } from "@/lib/policyDocuments/constants";
import { recordPolicyActivity } from "@/lib/policy/activity";
import { syncPolicyDocumentWithTimeout, loadSiblingStandardizedNamesLower } from "@/lib/integrations/dropbox/policyDocumentSync";
import { buildStandardizedPolicyDocumentFilename } from "@/lib/integrations/dropbox/policyDocumentFilenames";
import { PolicyDocumentType, type PolicyCategory } from "@/generated/prisma/enums";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

const DOCUMENT_TYPES = Object.values(PolicyDocumentType);

// Route slug for revalidatePath — this action is shared by all four Policy
// category detail views (see MotorDocumentsTab, reused unchanged by
// Non-Motor/Bond/Work Permit's own detail views), so the path to revalidate
// must match the record's ACTUAL category, not always "/policy/motor".
function categoryRouteSlug(category: PolicyCategory): string {
  const key = POLICY_CATEGORY_PERMISSION[category];
  return POLICY_CATEGORY_ROUTES.find((r) => r.key === key)?.slug ?? "motor";
}

// Per-category permission check (mirrors /api/policy-documents/[id]'s
// download route) — this action is shared by all four categories, so a
// Non-Motor/Bond/Work-Permit-only user must be authorized against their own
// category's permission, not hardcoded to "policy.motor".
async function requirePolicyPermission(category: PolicyCategory) {
  const session = await auth();
  if (!session?.user || !hasPermission(session.user, POLICY_CATEGORY_PERMISSION[category])) return null;
  return session;
}

export type UploadPolicyDocumentResult = { id: string };

// One file per call, same reasoning as uploadQuotationDocumentAction: keeps
// each request comfortably under next.config.ts's serverActions body-size
// limit even for the largest single allowed file.
export async function uploadPolicyDocumentAction(formData: FormData): Promise<ActionResult<UploadPolicyDocumentResult>> {
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

  const record = await prisma.policyRecord.findUnique({ where: { id: policyRecordId, deletedAt: null }, select: { id: true, category: true } });
  if (!record) return { success: false, error: "RECORD_NOT_FOUND" };

  const session = await requirePolicyPermission(record.category);
  if (!session) return { success: false, error: "FORBIDDEN" };

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

  // Computed before the transaction (a pure read of already-committed
  // sibling documents' sync rows — the new document doesn't exist yet, so
  // there is nothing to exclude and nothing to run inside the transaction
  // itself) so the PENDING sync row created below stores the REAL
  // standardized name from the start, never a placeholder that a later
  // sync attempt would otherwise have to overwrite.
  const existingNamesLower = await loadSiblingStandardizedNamesLower(policyRecordId);
  const standardizedFileName = buildStandardizedPolicyDocumentFilename({
    documentType: documentType as PolicyDocumentType,
    originalFileName: file.name,
    existingStandardizedNamesLower: existingNamesLower,
  });

  let createdId: string;
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
      // Dropbox Integration Phase 5: local upload/DB record is committed
      // first and is authoritative on its own — the PENDING sync row is
      // created in the same transaction so it always exists once the
      // document does, but the actual Dropbox sync attempt happens AFTER
      // this transaction commits (see below), never blocking or reversing
      // the local upload (Part 7, requirements 4/7).
      await tx.policyDocumentDropboxSync.create({
        data: { policyDocumentId: document.id, standardizedFileName, originalFileName: document.originalFileName, syncStatus: "PENDING" },
      });
      await recordPolicyActivity(tx, {
        policyRecordId,
        actionType: "DOCUMENT_UPLOADED",
        summary: `${documentTypeSummaryLabel(documentType as PolicyDocumentType)} uploaded: ${file.name}`,
        performedById: session.user.id,
      });
      return document;
    });
    createdId = created.id;
  } catch (err) {
    // Database write failed after the file was already written to disk —
    // clean up the orphaned file so it doesn't linger without a DB record.
    console.error(`Failed to save document record for policy ${policyRecordId}, cleaning up uploaded file:`, err);
    await policyDocumentStorage.deleteFile(storagePath).catch(() => {});
    return { success: false, error: "SAVE_FAILED" };
  }

  // Bounded, best-effort — a slow/failed Dropbox sync never changes the
  // "local upload succeeded" result already committed above.
  await syncPolicyDocumentWithTimeout(createdId).catch(() => {});

  revalidatePath(`/policy/${categoryRouteSlug(record.category)}/${policyRecordId}`);
  return { success: true, id: createdId };
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
  const document = await prisma.policyDocument.findUnique({ where: { id }, include: { policyRecord: { select: { category: true } } } });
  if (!document) return { success: false, error: "DOCUMENT_NOT_FOUND" };

  const session = await requirePolicyPermission(document.policyRecord.category);
  if (!session) return { success: false, error: "FORBIDDEN" };

  try {
    await prisma.$transaction(async (tx) => {
      // PolicyDocumentDropboxSync cascades away with this row — Dropbox
      // Integration Phase 5, Part 13: deleting a PolicyDocument never
      // deletes the Dropbox file itself, only this local metadata row.
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

  revalidatePath(`/policy/${categoryRouteSlug(document.policyRecord.category)}/${document.policyRecordId}`);
  return { success: true };
}
