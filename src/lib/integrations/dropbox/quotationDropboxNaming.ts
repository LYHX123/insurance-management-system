// Server-only, pure and deterministic. Dropbox Integration Phase 4 —
// business-folder and Quotation-file naming for the Insurance Business File
// structure (Part 4/5). Every function here is a pure string transform;
// which Quotation field to read (project name vs. plate number vs. bond
// project name) is resolved by the caller (the sync service), matching the
// separation already established between customerDocumentFilenames.ts
// (naming) and customerDocumentSync.ts (data resolution).

const MAX_BUSINESS_TITLE_LENGTH = 60;
const MAX_FILENAME_SEGMENT_LENGTH = 40;

// The 20 InsuranceType.code values (prisma/insuranceTypesData.ts) mapped to
// the standardized folder/filename code (Part 4, requirement 2). The 4
// Motor variants collapse to MOTOR and the 2 GIT variants collapse to GIT —
// deliberately: the business folder represents one deal, not one specific
// Motor sub-product. TENDER_SECURITY -> "BID BOND" matches the example
// list (a tender security bond is what secures a bid).
const INSURANCE_TYPE_FOLDER_CODE: Record<string, string> = {
  CAR: "CAR",
  WIBA: "WIBA",
  EL: "EL",
  CPM: "CPM",
  PL: "PL",
  FIRE: "FIRE",
  BURGLARY: "BURGLARY",
  GIT_SINGLE: "GIT",
  GIT_ANNUAL: "GIT",
  MARINE: "MARINE",
  MOTOR_COMP_PRIVATE: "MOTOR",
  MOTOR_COMP_COMMERCIAL: "MOTOR",
  MOTOR_TPO_PRIVATE: "MOTOR",
  MOTOR_TPO_COMMERCIAL: "MOTOR",
  GPA: "GPA",
  MEDICAL: "MEDICAL",
  TENDER_SECURITY: "BID BOND",
  PERFORMANCE_BOND: "PERFORMANCE BOND",
  APG: "APG",
  CUSTOMS_BOND: "CUSTOMS BOND",
};

// Never invents a code for an unsupported type (Part 4, requirement 2) —
// falls back to the raw InsuranceType.code itself (already a short,
// filesystem-safe, all-caps identifier) rather than throwing, so a future
// insurance type added to InsuranceType without a folder-code update yet
// still produces a safe, if unmapped, folder/filename segment.
export function insuranceTypeFolderCode(insuranceTypeCode: string): string {
  return INSURANCE_TYPE_FOLDER_CODE[insuranceTypeCode] ?? insuranceTypeCode.toUpperCase();
}

// Correction 2: a Quotation covering more than one DISTINCT normalized
// insurance type (after collapsing e.g. the 4 Motor variants / 2 GIT
// variants together) is labeled MULTI rather than misleadingly using just
// its first section's type. A Set naturally makes this order-independent
// and collapses duplicate same-type sections to one. This is the single
// function that decides "what code goes in the name" — callers pass every
// raw InsuranceType.code found on the Quotation's sections, once, and
// snapshot the result; it is never recomputed from a live section list
// after the business file/version has been created.
export function resolveInsuranceTypeCodeForNaming(rawInsuranceTypeCodes: readonly string[]): string {
  const normalized = new Set(rawInsuranceTypeCodes.map(insuranceTypeFolderCode));
  if (normalized.size === 0) return "OTHER";
  if (normalized.size === 1) return [...normalized][0];
  return "MULTI";
}

function stripControlAndQuoteChars(value: string): string {
  return value.replace(/[\x00-\x1F\x7F]/g, "").replace(/["/\\:*?<>|]/g, "");
}

// Business folder title: uppercase, Windows-reserved characters removed,
// whitespace collapsed but PRESERVED as spaces (Part 4, requirement 4 —
// the example "NAKURU WATER PROJECT" keeps its spaces), never "." or "..".
export function sanitizeBusinessTitle(raw: string, fallback: string): string {
  let value = stripControlAndQuoteChars(raw);
  value = value.replace(/\s+/g, " ").trim().toUpperCase();
  value = value.replace(/^\.+/, "").replace(/\.+$/, "").trim();
  if (value.length > MAX_BUSINESS_TITLE_LENGTH) value = value.slice(0, MAX_BUSINESS_TITLE_LENGTH).trim();
  return value || fallback;
}

// Quotation-filename segments (insurance type code, customer short name):
// stricter than the folder title — internal whitespace becomes a single
// hyphen rather than being preserved, per Part 5, requirement 12
// ("do not use spaces ... recommended: use hyphens"). Also used for the
// insurance type code itself, since two of the mapped codes ("BID BOND",
// "PERFORMANCE BOND") contain a space.
export function toFilenameSegment(raw: string, fallback: string): string {
  let value = stripControlAndQuoteChars(raw);
  value = value.replace(/\s+/g, "-").toUpperCase();
  value = value.replace(/^[-.]+/, "").replace(/[-.]+$/, "");
  if (value.length > MAX_FILENAME_SEGMENT_LENGTH) value = value.slice(0, MAX_FILENAME_SEGMENT_LENGTH).replace(/-+$/, "");
  return value || fallback;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// YYYYMMDD, no separators — matches the spec's example exactly and is the
// single canonical date form used by both the business folder name and
// every Quotation filename built from the same business-date snapshot.
export function compactDate(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

export type BusinessFolderNameInput = {
  businessDate: Date;
  // Already-resolved via resolveInsuranceTypeCodeForNaming — a single
  // standardized code (e.g. "CAR") or "MULTI". Not re-mapped here: this
  // function trusts its caller to have already collapsed the Quotation's
  // full set of section types (Correction 2) before calling.
  insuranceTypeCode: string;
  businessTitle: string; // raw, unsanitized candidate (project name / plate / bond project / quotation number fallback)
};

// "YYYYMMDD-<CODE>-<TITLE>" (Part 4). Deterministic given the same inputs —
// callers snapshot the result once and never recompute it for later
// revisions/edits (Part 4, requirements 6-7).
export function buildBusinessFolderName(input: BusinessFolderNameInput): string {
  const title = sanitizeBusinessTitle(input.businessTitle, "QUOTATION");
  return `${compactDate(input.businessDate)}-${input.insuranceTypeCode}-${title}`;
}

// Deterministic collision suffix (Part 4, requirement 5): a business folder
// name that collides with an unrelated, unlinked Dropbox folder gets the
// quotation number appended — never silently overwritten, never randomly
// renamed.
export function disambiguateBusinessFolderName(baseName: string, quotationNumber: string): string {
  return `${baseName}-${quotationNumber}`;
}

export type QuotationBaseFileNameInput = {
  // Already-resolved (see BusinessFolderNameInput's doc comment) — in
  // practice always the business file's own stored insuranceTypeCode
  // snapshot, so a version's filename always agrees with its folder name.
  insuranceTypeCode: string;
  customerShortName: string; // the business-file's immutable snapshot, not live Customer data
  businessDate: Date; // the business-file's immutable snapshot
  versionNumber: number;
};

// "<INSURANCE_TYPE>-<CUSTOMER_SHORT_NAME>-<QUOTATION_DATE>-V<VERSION>" (Part
// 5) — no extension: Excel and PDF for the same version share this exact
// base (Part 5, requirement 8), the caller appends ".xlsx"/".pdf".
export function buildQuotationBaseFileName(input: QuotationBaseFileNameInput): string {
  const typeSegment = toFilenameSegment(input.insuranceTypeCode, "TYPE");
  const shortNameSegment = toFilenameSegment(input.customerShortName, "CUSTOMER");
  const version = Math.max(1, Math.trunc(input.versionNumber));
  return `${typeSegment}-${shortNameSegment}-${compactDate(input.businessDate)}-V${version}`;
}
