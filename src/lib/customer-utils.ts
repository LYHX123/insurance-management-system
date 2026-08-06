import { randomUUID } from "crypto";
import path from "path";
// Reused directly (not duplicated) — the byte-signature allowlist this
// module needs (pdf/doc/docx/xls/xlsx/jpeg/png) is a subset of what
// quotationDocuments' fileSignature.ts already validates, and this check is
// domain-agnostic (bytes in, boolean out). Same reuse pattern already used
// by policyDocuments/validateUpload.ts and claimDocuments/validateUpload.ts.
import { looksDangerous, matchesFileSignature } from "@/lib/quotationDocuments/fileSignature";

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

export type CustomerDocumentUploadValidationError =
  | "FILE_EMPTY"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_SIGNATURE_MISMATCH"
  | "DANGEROUS_FILE_CONTENT"
  | "UNSAFE_FILE_NAME";

// Rejects path-traversal / control-character filenames — the physical
// on-disk filename is always server-generated (generateStoredFileName
// above), but a malicious originalFileName is still stored for display, so
// it must not carry traversal sequences or be usable to spoof another
// file's identity in the UI. Same check as policyDocuments/quotationDocuments'
// validateUpload.ts.
function isUnsafeFileName(name: string): boolean {
  if (!name || name.includes("\0")) return true;
  if (name.includes("/") || name.includes("\\")) return true;
  if (name === "." || name === "..") return true;
  return false;
}

// Production Readiness Audit V1, finding H1: Customer Document upload
// previously trusted only the browser-supplied MIME type/extension. This
// mirrors Policy/Quotation/Claim documents' validateUploadedFile — same
// shared byte-signature helpers (looksDangerous/matchesFileSignature),
// applied against this module's own size limit and MIME allowlist.
export function validateCustomerDocumentUpload(
  originalFileName: string,
  mimeType: string,
  size: number,
  buffer: Buffer
): { ok: true } | { ok: false; error: CustomerDocumentUploadValidationError } {
  if (size === 0) return { ok: false, error: "FILE_EMPTY" };
  if (size > MAX_UPLOAD_FILE_SIZE_BYTES) return { ok: false, error: "FILE_TOO_LARGE" };
  if (isUnsafeFileName(originalFileName)) return { ok: false, error: "UNSAFE_FILE_NAME" };
  if (!isAllowedDocumentMimeType(mimeType)) return { ok: false, error: "UNSUPPORTED_FILE_TYPE" };

  if (looksDangerous(buffer)) return { ok: false, error: "DANGEROUS_FILE_CONTENT" };

  const ext = ALLOWED_DOCUMENT_MIME_TYPES[mimeType];
  if (!matchesFileSignature(ext, buffer)) return { ok: false, error: "FILE_SIGNATURE_MISMATCH" };

  return { ok: true };
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

// --- Customer Short Name (Dropbox Integration Phase 4, Part 2) ------------

export const MAX_CUSTOMER_SHORT_NAME_LENGTH = 40;

export type ShortNameValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: "SHORT_NAME_INVALID_CHARACTERS" | "SHORT_NAME_TOO_LONG" };

// Permissive by design (letters, numbers, hyphens, and — per Part 2,
// requirement 10 — Chinese characters are all allowed unrestricted) but
// structurally safe: no control characters, no path separators, and never
// exactly "." or ".." once whitespace is collapsed. A blank value is valid
// (the field is optional) and normalizes to "".
export function validateCustomerShortName(raw: string): ShortNameValidationResult {
  if (/[\x00-\x1F\x7F]/.test(raw)) return { ok: false, error: "SHORT_NAME_INVALID_CHARACTERS" };
  if (/[/\\]/.test(raw)) return { ok: false, error: "SHORT_NAME_INVALID_CHARACTERS" };

  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed === "." || collapsed === "..") return { ok: false, error: "SHORT_NAME_INVALID_CHARACTERS" };
  if (collapsed.length > MAX_CUSTOMER_SHORT_NAME_LENGTH) return { ok: false, error: "SHORT_NAME_TOO_LONG" };

  return { ok: true, value: collapsed };
}
