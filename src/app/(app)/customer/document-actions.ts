"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasModuleAccess } from "@/lib/permissions";
import { storageService } from "@/lib/storage";
import {
  MAX_UPLOAD_FILE_SIZE_BYTES,
  customerCompanyFolder,
  customerProjectFolder,
  generateStoredFileName,
  isAllowedDocumentMimeType,
} from "@/lib/customer-utils";
import { CustomerDocumentType } from "@/generated/prisma/enums";

type ActionResult = { success: true } | { success: false; error: string };

const DOCUMENT_TYPES = Object.values(CustomerDocumentType);

async function requireCustomerPermission() {
  const session = await auth();
  if (!session?.user || !hasModuleAccess(session.user.permissions ?? [], "customer")) {
    return null;
  }
  return session;
}

export async function uploadDocumentAction(formData: FormData): Promise<ActionResult> {
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

  try {
    await prisma.customerDocument.create({
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
  } catch (err) {
    // Database write failed after the file was already written to disk —
    // clean up the orphaned file so it doesn't linger without a DB record.
    console.error("Failed to save document record, cleaning up uploaded file:", err);
    await storageService.deleteFile(storageKey).catch(() => {});
    return { success: false, error: "SAVE_FAILED" };
  }

  revalidatePath(`/customer/${customerId}`);
  return { success: true };
}

export async function deleteDocumentAction(id: string): Promise<ActionResult> {
  const session = await requireCustomerPermission();
  if (!session) return { success: false, error: "FORBIDDEN" };

  const document = await prisma.customerDocument.findUnique({ where: { id } });
  if (!document) return { success: false, error: "DOCUMENT_NOT_FOUND" };

  await prisma.customerDocument.delete({ where: { id } });

  await storageService.deleteFile(document.storageKey).catch((err) => {
    console.error(`Failed to delete file for document ${id}:`, err);
  });

  revalidatePath(`/customer/${document.customerId}`);
  return { success: true };
}
