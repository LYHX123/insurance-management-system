// Server-only, pure and deterministic. Dropbox Integration Phase 5 —
// standardized filenames for Policy documents synced to Dropbox. Mirrors
// customerDocumentFilenames.ts's exact pattern (sanitize -> pick a base name
// -> disambiguate against already-used names) — never reads request/session
// state, every input passed in explicitly.
import path from "path";
import { PolicyDocumentType } from "@/generated/prisma/enums";

const MAX_STANDARDIZED_FILENAME_LENGTH = 150;

// Only the categories that map to a fixed, business-recognized document
// name (Part 5's recommended list, adapted to this schema's ACTUAL
// PolicyDocumentType values — COVER_NOTE does not exist here; STICKER and
// CANCELLATION do, and get the same fixed-name treatment). ENDORSEMENT is
// handled separately below (Part 5, requirement 11: numbered, never a
// single fixed name). OTHER falls back to the sanitized original filename.
const MANAGED_TYPE_BASE_NAME: Partial<Record<PolicyDocumentType, string>> = {
  [PolicyDocumentType.POLICY_SCHEDULE]: "Policy Schedule",
  [PolicyDocumentType.CERTIFICATE]: "Certificate",
  [PolicyDocumentType.STICKER]: "Sticker",
  [PolicyDocumentType.DEBIT_NOTE]: "Debit Note",
  [PolicyDocumentType.RECEIPT]: "Receipt",
  [PolicyDocumentType.CANCELLATION]: "Cancellation",
};

const ENDORSEMENT_BASE_NAME = "Endorsement";
const FALLBACK_BASE_NAME = "Document";

const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/g;
const PATH_BREAKING_PATTERN = /[/\\]/g;

// Strips control chars (including CR/LF — Part 16, requirement 2) and path
// separators (Part 16, requirement 1: no traversal), collapses whitespace,
// trims stray leading/trailing dots. Unicode letters/digits pass through
// untouched (Part 5, requirement 6).
function sanitizeBaseName(input: string, maxLength: number): string {
  let s = input.replace(CONTROL_CHAR_PATTERN, "").replace(PATH_BREAKING_PATTERN, "-");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^\.+/, "").replace(/\.+$/, "").trim();
  if (s.length > maxLength) s = s.slice(0, maxLength).trim();
  return s;
}

// Extension is always taken from the already-validated upload (Part 5,
// requirement 1: preserve the original extension) — validateUploadedFile
// in policyDocuments/validateUpload.ts is the sole gate on which extensions
// are ever accepted, so re-deriving it here from mimeType would be
// redundant and could disagree with what was actually validated.
function extensionFromOriginalFileName(originalFileName: string): string {
  return path.extname(originalFileName).toLowerCase();
}

function baseNameForOther(originalFileName: string, maxLength: number): string {
  const withoutExt = originalFileName.replace(/\.[^./\\]{1,15}$/, "");
  const sanitized = sanitizeBaseName(withoutExt, maxLength);
  return sanitized || FALLBACK_BASE_NAME;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Deterministic collision resolution (Part 5, requirement 10): plain name
// first, then a dated suffix, then numbered variants of the dated suffix —
// never produces two equal outputs for a growing existing-set.
function disambiguate(baseName: string, ext: string, existingLower: ReadonlySet<string>, now: Date): string {
  const plain = `${baseName}${ext}`;
  if (!existingLower.has(plain.toLowerCase())) return plain;

  const dated = `${baseName} - ${isoDate(now)}${ext}`;
  if (!existingLower.has(dated.toLowerCase())) return dated;

  for (let n = 2; n < 1000; n++) {
    const candidate = `${baseName} - ${isoDate(now)} (${n})${ext}`;
    if (!existingLower.has(candidate.toLowerCase())) return candidate;
  }
  return `${baseName} - ${isoDate(now)} (${Date.now()})${ext}`;
}

// Part 5, requirement 11: "Do not infer an endorsement number unreliably...
// use collision-safe numbering." Scans only THIS Policy's already-used
// standardized names for "Endorsement-NN[...]" and picks the next free
// two-digit sequence — never a global counter, never parsed from unrelated
// business data (e.g. an endorsement letter reference).
const ENDORSEMENT_NUMBER_PATTERN = /^Endorsement-(\d{2,})(?:[^0-9].*)?$/i;

function nextEndorsementNumber(existingLower: ReadonlySet<string>): number {
  let maxUsed = 0;
  for (const name of existingLower) {
    const match = ENDORSEMENT_NUMBER_PATTERN.exec(name);
    if (match) maxUsed = Math.max(maxUsed, parseInt(match[1], 10));
  }
  return maxUsed + 1;
}

export type StandardizedPolicyFilenameInput = {
  documentType: PolicyDocumentType;
  originalFileName: string;
  // Lowercased standardized names already synchronized/in-flight for this
  // same Policy's Dropbox "Policy" folder — supplied by the caller (DB
  // read), used only to pick a deterministic, collision-free name. Pure
  // function: never queries anything itself.
  existingStandardizedNamesLower: ReadonlySet<string>;
  now?: Date;
};

// The single source of truth for "what filename does this Policy document
// get in Dropbox" (Part 5, requirement 5: never the user's original
// filename directly, except as the sanitized base for OTHER).
export function buildStandardizedPolicyDocumentFilename(input: StandardizedPolicyFilenameInput): string {
  const now = input.now ?? new Date();
  const ext = extensionFromOriginalFileName(input.originalFileName);

  if (input.documentType === PolicyDocumentType.ENDORSEMENT) {
    const n = nextEndorsementNumber(input.existingStandardizedNamesLower);
    return `${ENDORSEMENT_BASE_NAME}-${pad2(n)}${ext}`;
  }

  const rawBase = MANAGED_TYPE_BASE_NAME[input.documentType];
  const baseName =
    rawBase !== undefined
      ? sanitizeBaseName(rawBase, MAX_STANDARDIZED_FILENAME_LENGTH) || rawBase
      : baseNameForOther(input.originalFileName, MAX_STANDARDIZED_FILENAME_LENGTH);

  return disambiguate(baseName, ext, input.existingStandardizedNamesLower, now);
}

// Read-only check used by verification (mirrors
// customerDocumentFilenames.ts's isPlausibleStandardizedFilename): does a
// given Dropbox filename look like something this module could have
// produced for the given document?
export function isPlausibleStandardizedPolicyFilename(
  filename: string,
  documentType: PolicyDocumentType,
  originalFileName: string
): boolean {
  const ext = extensionFromOriginalFileName(originalFileName);
  if (ext && !filename.toLowerCase().endsWith(ext)) return false;

  if (documentType === PolicyDocumentType.ENDORSEMENT) {
    return /^Endorsement-\d{2,}/i.test(filename);
  }

  const rawBase = MANAGED_TYPE_BASE_NAME[documentType];
  if (rawBase !== undefined) {
    return filename.toLowerCase().startsWith(rawBase.toLowerCase());
  }
  const base = filename.slice(0, filename.length - ext.length).trim();
  return base.length > 0;
}
