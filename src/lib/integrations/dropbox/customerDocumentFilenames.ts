// Server-only, pure and deterministic. Dropbox Integration Phase 3 —
// standardized filenames for Customer documents synced to Dropbox. Never
// reads request/session state; every input is passed in explicitly so this
// stays fully unit-testable without mocks. Unlike the HTTP
// Content-Disposition header (src/lib/http/contentDisposition.ts), Dropbox
// paths are plain UTF-8 JSON strings with no ByteString restriction — full
// Unicode is preserved here for "Other" documents, only structurally unsafe
// characters are stripped.
import path from "path";
import { CustomerDocumentType } from "@/generated/prisma/enums";
import { ALLOWED_DOCUMENT_MIME_TYPES } from "@/lib/customer-utils";

const MAX_STANDARDIZED_FILENAME_LENGTH = 150;

const MANAGED_TYPE_BASE_NAME: Partial<Record<CustomerDocumentType, string>> = {
  [CustomerDocumentType.REGISTRATION_CERTIFICATE]: "Registration Certificate",
  [CustomerDocumentType.PIN_CERTIFICATE]: "PIN Certificate",
  [CustomerDocumentType.CR12]: "CR12",
};

const FALLBACK_BASE_NAME = "Other Document";

const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/g;
const PATH_BREAKING_PATTERN = /[/\\]/g;

// Strips control chars, converts path separators (never allowed as literal
// characters in a single filename component) to a safe hyphen, collapses
// whitespace, and trims stray leading/trailing dots so the result can never
// be interpreted as "." / ".." or a hidden file. Unicode letters/digits are
// left untouched.
function sanitizeBaseName(input: string, maxLength: number): string {
  let s = input.replace(CONTROL_CHAR_PATTERN, "").replace(PATH_BREAKING_PATTERN, "-");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^\.+/, "").replace(/\.+$/, "").trim();
  if (s.length > maxLength) s = s.slice(0, maxLength).trim();
  return s;
}

// Same extension-resolution rule as generateStoredFileName in
// customer-utils.ts (Part 3, requirement #4: "validate extension and MIME
// type consistently") — an extension is only trusted from the original
// filename if it's one of the app's own allowed extensions; otherwise it's
// derived from the validated MIME type. Normalized lowercase.
export function resolveSafeExtension(originalFileName: string, mimeType: string): string {
  const extFromName = path.extname(originalFileName).toLowerCase();
  if (extFromName && Object.values(ALLOWED_DOCUMENT_MIME_TYPES).includes(extFromName)) {
    return extFromName;
  }
  return (ALLOWED_DOCUMENT_MIME_TYPES[mimeType] || "").toLowerCase();
}

function baseNameForOther(originalFileName: string, maxLength: number): string {
  const withoutExt = originalFileName.replace(/\.[^./\\]{1,15}$/, "");
  const sanitized = sanitizeBaseName(withoutExt, maxLength);
  return sanitized || FALLBACK_BASE_NAME;
}

export type StandardizedFilenameInput = {
  documentType: CustomerDocumentType;
  originalFileName: string;
  mimeType: string;
  // Lowercased standardized names already in use for this customer's
  // Dropbox destination (managed-type versions + Other-type siblings) —
  // supplied by the caller (DB-backed), used only to pick a deterministic,
  // collision-free suffix. Pure function: never queries anything itself.
  existingStandardizedNamesLower: ReadonlySet<string>;
  now?: Date;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Deterministic collision resolution shared by managed-type versioning
// (Part 4 requirement: dated suffix, e.g. "Registration Certificate -
// 2026-07-28.pdf") and Other-type dedup (Part 4 requirement 5: "resolve
// collisions using a deterministic suffix"). Tries the plain name first,
// then a date-suffixed name, then numbered variants of the date-suffixed
// name — never produces two equal outputs for a growing existing-set.
function disambiguate(baseName: string, ext: string, existingLower: ReadonlySet<string>, now: Date): string {
  const plain = `${baseName}${ext}`;
  if (!existingLower.has(plain.toLowerCase())) return plain;

  const dated = `${baseName} - ${isoDate(now)}${ext}`;
  if (!existingLower.has(dated.toLowerCase())) return dated;

  for (let n = 2; n < 1000; n++) {
    const candidate = `${baseName} - ${isoDate(now)} (${n})${ext}`;
    if (!existingLower.has(candidate.toLowerCase())) return candidate;
  }
  // Practically unreachable (1000 same-day versions of one document), but
  // keep the function total rather than throwing.
  return `${baseName} - ${isoDate(now)} (${Date.now()})${ext}`;
}

// The single source of truth for "what filename does this document get in
// Dropbox" — never the user's original filename directly (Part 3's core
// requirement). Deterministic for a given input set: calling this twice
// with the same existingStandardizedNamesLower produces the same result.
export function buildStandardizedDropboxFilename(input: StandardizedFilenameInput): string {
  const now = input.now ?? new Date();
  const ext = resolveSafeExtension(input.originalFileName, input.mimeType);

  const rawBase = MANAGED_TYPE_BASE_NAME[input.documentType];
  const baseName =
    rawBase !== undefined
      ? sanitizeBaseName(rawBase, MAX_STANDARDIZED_FILENAME_LENGTH) || rawBase
      : baseNameForOther(input.originalFileName, MAX_STANDARDIZED_FILENAME_LENGTH);

  return disambiguate(baseName, ext, input.existingStandardizedNamesLower, now);
}

// Read-only check used by Part 9 verification: does a given Dropbox
// filename look like something this module could have produced for the
// given document (same base + a valid extension, optionally with a dated
// or numbered suffix)? Intentionally lenient about the suffix (it's
// collision-dependent and not worth re-deriving exactly) but strict about
// the base name and extension.
export function isPlausibleStandardizedFilename(
  filename: string,
  documentType: CustomerDocumentType,
  originalFileName: string,
  mimeType: string
): boolean {
  const ext = resolveSafeExtension(originalFileName, mimeType);
  if (ext && !filename.toLowerCase().endsWith(ext)) return false;

  const rawBase = MANAGED_TYPE_BASE_NAME[documentType];
  if (rawBase !== undefined) {
    return filename.toLowerCase().startsWith(rawBase.toLowerCase());
  }
  // OTHER: any non-empty base derived from the original filename is
  // acceptable — just confirm it isn't literally empty/extension-only.
  const base = filename.slice(0, filename.length - ext.length).trim();
  return base.length > 0;
}
