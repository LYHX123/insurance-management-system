// Upload validation for Dropbox Integration Phase 7 — Motor/Non-Motor Claim
// documents. Reuses the exact same allowed-extension list, MIME check, and
// byte-signature checks as policyDocuments/validateUpload.ts directly (not
// duplicated) — these rules are domain-agnostic (bytes in, boolean out) and
// this phase does not reduce the currently-supported formats (Part 5:
// "Support PDF, JPG/JPEG, PNG, DOC/DOCX, XLS/XLSX and any formats already
// accepted by the current upload system").
import { randomUUID } from "crypto";
import path from "path";
import { ALLOWED_DOCUMENT_TYPES, isAllowedExtension, isAllowedMimeForExtension } from "@/lib/policyDocuments/constants";
import { looksDangerous, matchesFileSignature } from "@/lib/quotationDocuments/fileSignature";

export const MAX_CLAIM_DOCUMENT_FILE_SIZE_BYTES = Number(process.env.CLAIM_DOCUMENT_MAX_FILE_SIZE_MB || "25") * 1024 * 1024;

export type ClaimUploadValidationError =
  | "NO_FILE"
  | "FILE_TOO_LARGE"
  | "FILE_EMPTY"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_SIGNATURE_MISMATCH"
  | "DANGEROUS_FILE_CONTENT"
  | "UNSAFE_FILE_NAME";

function isUnsafeFileName(name: string): boolean {
  if (!name || name.includes("\0")) return true;
  if (name.includes("/") || name.includes("\\")) return true;
  if (name === "." || name === "..") return true;
  return false;
}

function safeFileExtension(originalFileName: string): string {
  return path.extname(originalFileName).toLowerCase();
}

export function validateClaimUploadedFile(
  originalFileName: string,
  mimeType: string,
  size: number,
  buffer: Buffer
): { ok: true; extension: string } | { ok: false; error: ClaimUploadValidationError } {
  if (size === 0) return { ok: false, error: "FILE_EMPTY" };
  if (size > MAX_CLAIM_DOCUMENT_FILE_SIZE_BYTES) return { ok: false, error: "FILE_TOO_LARGE" };
  if (isUnsafeFileName(originalFileName)) return { ok: false, error: "UNSAFE_FILE_NAME" };

  const ext = safeFileExtension(originalFileName);
  if (!isAllowedExtension(ext)) return { ok: false, error: "UNSUPPORTED_FILE_TYPE" };
  if (!isAllowedMimeForExtension(ext, mimeType)) return { ok: false, error: "UNSUPPORTED_FILE_TYPE" };

  if (looksDangerous(buffer)) return { ok: false, error: "DANGEROUS_FILE_CONTENT" };
  if (!matchesFileSignature(ext, buffer)) return { ok: false, error: "FILE_SIGNATURE_MISMATCH" };

  return { ok: true, extension: ext };
}

export function generateStoredClaimFileName(ext: string): string {
  return `${randomUUID()}${ext.toLowerCase()}`;
}

export { ALLOWED_DOCUMENT_TYPES };
