// Phase 1B Policy Document upload constants. Deliberately its own module
// (own env-configurable root/size limit) rather than reusing
// quotationDocuments' — same reasoning as that module's separation from
// customer-utils.ts: each document domain owns its storage root and limits,
// even though the allowed file types and validation approach are identical.
import { randomUUID } from "crypto";
import path from "path";

export const MAX_DOCUMENT_FILE_SIZE_BYTES = Number(process.env.POLICY_DOCUMENT_MAX_FILE_SIZE_MB || "25") * 1024 * 1024;

// Extension -> MIME types browsers commonly report for it. Both the
// extension AND the reported MIME type must agree with one of these entries
// (see validateUpload.ts) before the file signature is checked.
export const ALLOWED_DOCUMENT_TYPES: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".webp": ["image/webp"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip",
  ],
  ".doc": ["application/msword"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
  ],
};

export function isAllowedExtension(ext: string): boolean {
  return ext.toLowerCase() in ALLOWED_DOCUMENT_TYPES;
}

export function isAllowedMimeForExtension(ext: string, mimeType: string): boolean {
  const allowed = ALLOWED_DOCUMENT_TYPES[ext.toLowerCase()];
  return !!allowed && allowed.includes(mimeType);
}

// The uploaded file name is only ever kept for display (originalFileName in
// the DB) — the physical on-disk name is always this unrelated random one.
export function generateStoredFileName(ext: string): string {
  return `${randomUUID()}${ext.toLowerCase()}`;
}

export function safeFileExtension(originalFileName: string): string {
  return path.extname(originalFileName).toLowerCase();
}
