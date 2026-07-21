// Phase 2 underwriting-document upload constants. Deliberately separate
// from src/lib/customer-utils.ts's ALLOWED_DOCUMENT_MIME_TYPES/
// MAX_UPLOAD_FILE_SIZE_BYTES — this module has its own broader allowlist
// (CSV, webp, txt) and its own 25MB/10-file limits per the Phase 2 spec,
// and must not change customer-document upload behavior.
import { randomUUID } from "crypto";
import path from "path";

export const MAX_DOCUMENT_FILE_SIZE_BYTES =
  Number(process.env.QUOTATION_DOCUMENT_MAX_FILE_SIZE_MB || "25") * 1024 * 1024;

export const MAX_FILES_PER_UPLOAD = 10;

// Extension -> MIME types Excel/Word/browsers commonly report for it. Both
// the extension AND the reported MIME type must agree with one of these
// entries (see validateUpload.ts) before the file signature is checked.
export const ALLOWED_DOCUMENT_TYPES: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip", // some browsers report generic zip for xlsx
  ],
  ".doc": ["application/msword"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
  ],
  ".csv": ["text/csv", "application/vnd.ms-excel", "text/plain"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".webp": ["image/webp"],
  ".txt": ["text/plain"],
};

export function isAllowedExtension(ext: string): boolean {
  return ext.toLowerCase() in ALLOWED_DOCUMENT_TYPES;
}

export function isAllowedMimeForExtension(ext: string, mimeType: string): boolean {
  const allowed = ALLOWED_DOCUMENT_TYPES[ext.toLowerCase()];
  return !!allowed && allowed.includes(mimeType);
}

// The uploaded file name is only ever kept for display (originalFileName in
// the DB) — the physical on-disk name is always this unrelated random one,
// same convention as customer-utils.ts's generateStoredFileName.
export function generateStoredFileName(ext: string): string {
  return `${randomUUID()}${ext.toLowerCase()}`;
}

export function safeFileExtension(originalFileName: string): string {
  return path.extname(originalFileName).toLowerCase();
}
