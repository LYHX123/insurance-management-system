import {
  ALLOWED_DOCUMENT_TYPES,
  MAX_DOCUMENT_FILE_SIZE_BYTES,
  isAllowedExtension,
  isAllowedMimeForExtension,
  safeFileExtension,
} from "./constants";
import { looksDangerous, matchesFileSignature } from "./fileSignature";

export type UploadValidationError =
  | "NO_FILE"
  | "FILE_TOO_LARGE"
  | "FILE_EMPTY"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_SIGNATURE_MISMATCH"
  | "DANGEROUS_FILE_CONTENT"
  | "UNSAFE_FILE_NAME";

// Rejects path-traversal / control-character filenames outright — the
// physical filename is always server-generated anyway (see
// constants.ts's generateStoredFileName), but a malicious originalFileName
// is still stored for display, so it must not carry traversal sequences or
// be usable to spoof another file's identity in the UI.
function isUnsafeFileName(name: string): boolean {
  if (!name || name.includes("\0")) return true;
  if (name.includes("/") || name.includes("\\")) return true;
  if (name === "." || name === "..") return true;
  return false;
}

export function validateUploadedFile(
  originalFileName: string,
  mimeType: string,
  size: number,
  buffer: Buffer
): { ok: true; extension: string } | { ok: false; error: UploadValidationError } {
  if (size === 0) return { ok: false, error: "FILE_EMPTY" };
  if (size > MAX_DOCUMENT_FILE_SIZE_BYTES) return { ok: false, error: "FILE_TOO_LARGE" };
  if (isUnsafeFileName(originalFileName)) return { ok: false, error: "UNSAFE_FILE_NAME" };

  const ext = safeFileExtension(originalFileName);
  if (!isAllowedExtension(ext)) return { ok: false, error: "UNSUPPORTED_FILE_TYPE" };
  if (!isAllowedMimeForExtension(ext, mimeType)) return { ok: false, error: "UNSUPPORTED_FILE_TYPE" };

  const dangerous = looksDangerous(buffer);
  if (dangerous) return { ok: false, error: "DANGEROUS_FILE_CONTENT" };

  if (!matchesFileSignature(ext, buffer)) return { ok: false, error: "FILE_SIGNATURE_MISMATCH" };

  return { ok: true, extension: ext };
}

export { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_FILE_SIZE_BYTES };
