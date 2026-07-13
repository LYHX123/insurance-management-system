import { randomUUID } from "crypto";
import path from "path";

export function formatCustomerNumber(sequenceNumber: number): string {
  return `CUST-${String(sequenceNumber).padStart(4, "0")}`;
}

export const MAX_UPLOAD_FILE_SIZE_BYTES =
  Number(process.env.MAX_UPLOAD_FILE_SIZE_MB || "20") * 1024 * 1024;

export const ALLOWED_DOCUMENT_MIME_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

export function isAllowedDocumentMimeType(mimeType: string): boolean {
  return mimeType in ALLOWED_DOCUMENT_MIME_TYPES;
}

// The uploaded file name is never used to build a physical path — we only
// keep it for display, and generate an unrelated random name on disk.
export function generateStoredFileName(
  originalFileName: string,
  mimeType: string
): string {
  const extFromName = path.extname(originalFileName).toLowerCase();
  const ext =
    extFromName && Object.values(ALLOWED_DOCUMENT_MIME_TYPES).includes(extFromName)
      ? extFromName
      : ALLOWED_DOCUMENT_MIME_TYPES[mimeType] || "";
  return `${randomUUID()}${ext}`;
}

export function customerCompanyFolder(customerNumber: string): string {
  return path.posix.join("customers", customerNumber, "company");
}

export function customerProjectFolder(
  customerNumber: string,
  projectId: string
): string {
  return path.posix.join("customers", customerNumber, "projects", projectId);
}
