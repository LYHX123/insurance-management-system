"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { canEdit } from "@/lib/permissions";
import { storageService } from "@/lib/storage";
import {
  MAX_UPLOAD_FILE_SIZE_BYTES,
  customerCompanyFolder,
  customerProjectFolder,
  generateStoredFileName,
  isAllowedDocumentMimeType,
} from "@/lib/customer-utils";
import { CustomerDocumentType } from "@/generated/prisma/enums";
import { buildStandardizedDropboxFilename } from "@/lib/integrations/dropbox/customerDocumentFilenames";
import {
  loadSiblingStandardizedNamesLower,
  syncCustomerDocument,
  verifyCustomerDocumentSync,
  type DocumentSyncOutcomeStatus,
  type DocumentSyncResult,
} from "@/lib/integrations/dropbox/customerDocumentSync";

type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

const DOCUMENT_TYPES = Object.values(CustomerDocumentType);

// Dropbox sync must never make a successful local upload depend on
// third-party network availability (Phase 3 spec, Part 5, requirement 10) —
// bounded so a hung Dropbox call can't hang the response; the local
// CustomerDocument row is already committed regardless of how this
// resolves. Same convention/value as customer/actions.ts's
// syncCustomerFolderWithTimeout.
const DROPBOX_SYNC_TIMEOUT_MS = 15_000;

async function syncDocumentWithTimeout(customerDocumentId: string): Promise<DocumentSyncOutcomeStatus> {
  try {
    const result = await Promise.race([
      syncCustomerDocument(customerDocumentId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), DROPBOX_SYNC_TIMEOUT_MS)),
    ]);
    return result?.status ?? "PENDING";
  } catch {
    return "ERROR";
  }
}

async function requireCustomerPermission() {
  const session = await auth();
  if (!session?.user || !canEdit(session.user, "customer")) {
    return null;
  }
  return session;
}

export async function uploadDocumentAction(
  formData: FormData
): Promise<ActionResult<{ documentId: string; dropboxSyncStatus: DocumentSyncOutcomeStatus }>> {
  const session = await requireCustomerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const customerId = String(formData.get("customerId") || "");
  const projectId = String(formData.get("projectId") || "").trim() || null;
  const documentType = String(formData.get("documentType") || "");
  const customDocumentName = String(formData.get("customDocumentName") || "").trim();
  const file = formData.get("file");

  if (!customerId) return { success: false, error: "CUSTOMER_NOT_FOUND" };
  if (!DOCUMENT_TYPES.includes(documentType as CustomerDocumentType)) {
    return { success: false, error: "INVALID_DOCUMENT_TYPE" };
  }
  if (documentType === CustomerDocumentType.OTHER && !customDocumentName) {
    return { success: false, error: "CUSTOM_DOCUMENT_NAME_REQUIRED" };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, error: "FILE_REQUIRED" };
  }
  if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
    return { success: false, error: "FILE_TOO_LARGE" };
  }
  if (!isAllowedDocumentMimeType(file.type)) {
    return { success: false, error: "UNSUPPORTED_FILE_TYPE" };
  }

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return { success: false, error: "CUSTOMER_NOT_FOUND" };

  if (projectId) {
    const project = await prisma.customerProject.findUnique({ where: { id: projectId } });
    if (!project || project.customerId !== customerId) {
      return { success: false, error: "PROJECT_NOT_FOUND" };
    }
  }

  const storedFileName = generateStoredFileName(file.name, file.type);
  const folderPath = projectId
    ? customerProjectFolder(customer.customerNumber, projectId)
    : customerCompanyFolder(customer.customerNumber);

  const buffer = Buffer.from(await file.arrayBuffer());

  let storageKey: string;
  try {
    await storageService.createFolder(folderPath);
    const uploaded = await storageService.uploadFile({
      folderPath,
      fileName: storedFileName,
      buffer,
      mimeType: file.type,
    });
    storageKey = uploaded.storageKey;
  } catch (err) {
    console.error("Failed to store customer document:", err);
    return { success: false, error: "UPLOAD_FAILED" };
  }

  let documentId: string;
  try {
    documentId = await prisma.$transaction(async (tx) => {
      const document = await tx.customerDocument.create({
        data: {
          customerId,
          projectId,
          documentType: documentType as CustomerDocumentType,
          customDocumentName: documentType === CustomerDocumentType.OTHER ? customDocumentName : null,
          originalFileName: file.name,
          storedFileName,
          mimeType: file.type,
          fileSize: file.size,
          storageProvider: "local",
          storageKey,
          syncStatus: "pending",
          uploadedBy: session.user.id,
        },
      });

      // Dropbox sync metadata row, PENDING until the post-transaction sync
      // attempt below resolves — pure DB reads/writes only, no network call
      // inside the transaction (Phase 3 spec, Part 5, requirements 3-5).
      const existingNamesLower = await loadSiblingStandardizedNamesLower(customerId, projectId, document.id, tx);
      const standardizedFileName = buildStandardizedDropboxFilename({
        documentType: document.documentType,
        originalFileName: document.originalFileName,
        mimeType: document.mimeType,
        existingStandardizedNamesLower: existingNamesLower,
      });
      await tx.customerDocumentDropboxSync.create({
        data: {
          customerDocumentId: document.id,
          standardizedFileName,
          originalFileName: document.originalFileName,
          syncStatus: "PENDING",
        },
      });

      return document.id;
    });
  } catch (err) {
    // Database write failed after the file was already written to disk —
    // clean up the orphaned file so it doesn't linger without a DB record.
    console.error("Failed to save document record, cleaning up uploaded file:", err);
    await storageService.deleteFile(storageKey).catch(() => {});
    return { success: false, error: "SAVE_FAILED" };
  }

  // The CustomerDocument row is committed at this point — nothing below
  // this line may ever turn a successful upload into a reported failure.
  // Dropbox sync is intentionally outside the transaction/try-catch above
  // and has its own internal error handling (syncDocumentWithTimeout never
  // throws) — Part 5, requirement 5/10.
  revalidatePath(`/customer/${customerId}`);
  const dropboxSyncStatus = await syncDocumentWithTimeout(documentId);
  revalidatePath(`/customer/${customerId}`);

  return { success: true, documentId, dropboxSyncStatus };
}

export async function deleteDocumentAction(id: string): Promise<ActionResult> {
  const session = await requireCustomerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const document = await prisma.customerDocument.findUnique({ where: { id } });
  if (!document) return { success: false, error: "DOCUMENT_NOT_FOUND" };

  // Phase 3, Part 10: deleting a system document never deletes the
  // corresponding Dropbox file — no Dropbox delete API is called anywhere
  // in this action. The CustomerDocumentDropboxSync row cascades away with
  // the CustomerDocument row (DB-level only); the actual file already
  // uploaded to Dropbox is deliberately retained. Archive/move-on-delete
  // behavior is out of scope for this phase.
  await prisma.customerDocument.delete({ where: { id } });

  await storageService.deleteFile(document.storageKey).catch((err) => {
    console.error(`Failed to delete file for document ${id}:`, err);
  });

  revalidatePath(`/customer/${document.customerId}`);
  return { success: true };
}

// --- Dropbox document sync: ADMIN-only retry/verify/re-upload (Phase 3, Part 8) ---
// Each action independently re-checks requireAdmin() regardless of UI
// visibility, mirroring the existing Dropbox folder actions
// (src/app/(app)/customer/dropboxActions.ts). None accept a Dropbox path
// from the browser — the target is always re-derived server-side from the
// document id.

export type DocumentDropboxActionResult = DocumentSyncResult & { forbidden?: boolean };

export async function retryDocumentSyncAction(customerDocumentId: string): Promise<DocumentDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, status: "ERROR", forbidden: true };

  const document = await prisma.customerDocument.findUnique({ where: { id: customerDocumentId }, select: { customerId: true } });
  const result = await syncCustomerDocument(customerDocumentId);
  if (document) revalidatePath(`/customer/${document.customerId}`);
  return result;
}

// "Re-upload Current Local File to Dropbox" is the same underlying
// operation as retry — syncCustomerDocument always re-reads the current
// local file and targets the document's existing standardized name, so a
// deliberate re-upload from a SYNCED state needs no separate code path.
export async function reuploadDocumentToDropboxAction(customerDocumentId: string): Promise<DocumentDropboxActionResult> {
  return retryDocumentSyncAction(customerDocumentId);
}

export async function verifyDocumentSyncAction(customerDocumentId: string): Promise<DocumentDropboxActionResult> {
  const session = await requireAdmin();
  if (!session) return { success: false, status: "ERROR", forbidden: true };

  const document = await prisma.customerDocument.findUnique({ where: { id: customerDocumentId }, select: { customerId: true } });
  const result = await verifyCustomerDocumentSync(customerDocumentId);
  if (document) revalidatePath(`/customer/${document.customerId}`);
  return result;
}
