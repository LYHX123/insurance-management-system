// Server-only, pure and deterministic. Dropbox Integration Phase 7 —
// standardized filenames for Motor/Non-Motor Claim documents synced to
// Dropbox. Mirrors policyDocumentFilenames.ts's exact pattern (sanitize ->
// pick a base name -> disambiguate against already-used names), with one
// addition: PHOTOS (Motor) / SUPPORTING_DOCUMENT (Non-Motor) use sequential
// "<Base> - N" numbering as their PRIMARY name (multiple files of that type
// is the normal case, not a rare collision, per Part 5's own examples),
// while every other managed type still falls through to the same
// date-then-numbered disambiguation Policy documents use for the
// less-common collision case.
import path from "path";
import type { MotorClaimDocumentType, NonMotorClaimDocumentType } from "@/generated/prisma/enums";

const MAX_STANDARDIZED_FILENAME_LENGTH = 150;

const MOTOR_MANAGED_TYPE_BASE_NAME: Partial<Record<MotorClaimDocumentType, string>> = {
  CLAIM_FORM: "Claim Form",
  POLICE_ABSTRACT: "Police Abstract",
  DRIVER_LICENSE: "Driver License",
  LOGBOOK: "Logbook",
  INSURANCE_CERTIFICATE: "Insurance Certificate",
  ASSESSMENT_REPORT: "Assessment Report",
  REPAIR_ESTIMATE: "Repair Estimate",
  REPAIR_INVOICE: "Repair Invoice",
  REINSPECTION_REPORT: "Reinspection Report",
  DISCHARGE_VOUCHER: "Discharge Voucher",
  RELEASE_LETTER: "Release Letter",
};
const MOTOR_NUMBERED_TYPE_BASE_NAME: Partial<Record<MotorClaimDocumentType, string>> = {
  PHOTOS: "Photos",
};

const NON_MOTOR_MANAGED_TYPE_BASE_NAME: Partial<Record<NonMotorClaimDocumentType, string>> = {
  CLAIM_FORM: "Claim Form",
  INCIDENT_REPORT: "Incident Report",
  SURVEY_REPORT: "Survey Report",
  ASSESSMENT_REPORT: "Assessment Report",
  REPAIR_ESTIMATE: "Repair Estimate",
  REPAIR_INVOICE: "Repair Invoice",
  SETTLEMENT_OFFER: "Settlement Offer",
  DISCHARGE_VOUCHER: "Discharge Voucher",
  SETTLEMENT_LETTER: "Settlement Letter",
};
const NON_MOTOR_NUMBERED_TYPE_BASE_NAME: Partial<Record<NonMotorClaimDocumentType, string>> = {
  SUPPORTING_DOCUMENT: "Supporting Document",
};

const FALLBACK_BASE_NAME = "Document";
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/g;
const PATH_BREAKING_PATTERN = /[/\\]/g;

function sanitizeBaseName(input: string, maxLength: number): string {
  let s = input.replace(CONTROL_CHAR_PATTERN, "").replace(PATH_BREAKING_PATTERN, "-");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^\.+/, "").replace(/\.+$/, "").trim();
  if (s.length > maxLength) s = s.slice(0, maxLength).trim();
  return s;
}

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

// Same three-tier collision resolution as policyDocumentFilenames.ts: plain
// name, then a dated suffix, then numbered variants of the dated suffix.
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

// "<Base> - N" — the PRIMARY naming scheme for types where multiple files
// of the same type are the normal case (Photos, Supporting Document), not
// a date suffix. Scans only already-used names for this exact pattern and
// picks the next free sequence number — never a global counter.
function nextNumbered(baseName: string, existingLower: ReadonlySet<string>): number {
  const pattern = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} - (\\d+)(?:[^0-9].*)?$`, "i");
  let maxUsed = 0;
  for (const name of existingLower) {
    const match = pattern.exec(name);
    if (match) maxUsed = Math.max(maxUsed, parseInt(match[1], 10));
  }
  return maxUsed + 1;
}

function buildStandardizedClaimDocumentFilename<T extends string>(
  documentType: T,
  originalFileName: string,
  existingStandardizedNamesLower: ReadonlySet<string>,
  managedTypeBaseName: Partial<Record<T, string>>,
  numberedTypeBaseName: Partial<Record<T, string>>
): string {
  const ext = extensionFromOriginalFileName(originalFileName);

  const numberedBase = numberedTypeBaseName[documentType];
  if (numberedBase !== undefined) {
    const n = nextNumbered(numberedBase, existingStandardizedNamesLower);
    return `${numberedBase} - ${n}${ext}`;
  }

  const rawBase = managedTypeBaseName[documentType];
  const baseName =
    rawBase !== undefined
      ? sanitizeBaseName(rawBase, MAX_STANDARDIZED_FILENAME_LENGTH) || rawBase
      : `Other - ${baseNameForOther(originalFileName, MAX_STANDARDIZED_FILENAME_LENGTH)}`;

  return disambiguate(baseName, ext, existingStandardizedNamesLower, new Date());
}

export type StandardizedMotorClaimFilenameInput = {
  documentType: MotorClaimDocumentType;
  originalFileName: string;
  existingStandardizedNamesLower: ReadonlySet<string>;
};

export function buildStandardizedMotorClaimDocumentFilename(input: StandardizedMotorClaimFilenameInput): string {
  return buildStandardizedClaimDocumentFilename(
    input.documentType,
    input.originalFileName,
    input.existingStandardizedNamesLower,
    MOTOR_MANAGED_TYPE_BASE_NAME,
    MOTOR_NUMBERED_TYPE_BASE_NAME
  );
}

export type StandardizedNonMotorClaimFilenameInput = {
  documentType: NonMotorClaimDocumentType;
  originalFileName: string;
  existingStandardizedNamesLower: ReadonlySet<string>;
};

export function buildStandardizedNonMotorClaimDocumentFilename(input: StandardizedNonMotorClaimFilenameInput): string {
  return buildStandardizedClaimDocumentFilename(
    input.documentType,
    input.originalFileName,
    input.existingStandardizedNamesLower,
    NON_MOTOR_MANAGED_TYPE_BASE_NAME,
    NON_MOTOR_NUMBERED_TYPE_BASE_NAME
  );
}
