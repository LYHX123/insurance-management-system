// Server-only. Dropbox Integration Phase 5 — resolves (and lazily creates)
// the ONE Dropbox business file a Policy's documents get filed under. Two
// possible sources, never both, never a duplicate (Part 3):
//   - QUOTATION_CASE: the Policy is linked (sourceQuotationId set) to a
//     Quotation whose QuotationCase already owns (or now needs) a
//     QuotationDropboxBusinessFile — the SAME row a Quotation Excel sync
//     would use, reusing ensureQuotationCaseDropboxBusinessFile so a later
//     Quotation sync and this Policy's own sync always agree.
//   - POLICY_FALLBACK: the Policy has no Quotation link at all — a
//     dedicated PolicyDropboxBusinessFile, 1:1 with the PolicyRecord.
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { NonMotorCoverType, BondType, PolicyDropboxBusinessFileSource } from "@/generated/prisma/enums";
import {
  ensureQuotationCaseDropboxBusinessFile,
  resolveBusinessTitleCandidate,
  resolveSourceQuotationId,
  QUOTATION_SYNC_INCLUDE,
} from "./quotationDropboxSync";
import { buildBusinessFolderName, resolveInsuranceTypeCodeForNaming } from "./quotationDropboxNaming";
import { deriveCustomerShortName } from "./customerShortName";

// Same short-code convention as quotationDropboxNaming.ts's
// INSURANCE_TYPE_FOLDER_CODE, applied to the Policy-side enums so a Policy
// fallback folder visually matches the equivalent Quotation folder naming
// for the same kind of business.
// Exported so a later phase's Non-Motor fallback-naming resolver can reuse
// the exact same cover-type -> folder-code mapping rather than defining a
// second, drifting copy.
export const NON_MOTOR_FOLDER_CODE: Record<NonMotorCoverType, string> = {
  CONTRACTORS_ALL_RISKS: "CAR",
  WIBA: "WIBA",
  EMPLOYERS_LIABILITY: "EL",
  CONTRACTORS_PLANT_MACHINERY: "CPM",
  PUBLIC_LIABILITY: "PL",
  FIRE_ALLIED_PERILS: "FIRE",
  BURGLARY: "BURGLARY",
  GOODS_IN_TRANSIT_SINGLE: "GIT",
  GOODS_IN_TRANSIT_ANNUAL: "GIT",
  MARINE: "MARINE",
  GROUP_PERSONAL_ACCIDENT: "GPA",
  GROUP_MEDICAL: "MEDICAL",
};

const BOND_FOLDER_CODE: Record<BondType, string> = {
  TENDER_BOND: "BID BOND",
  PERFORMANCE_BOND: "PERFORMANCE BOND",
  ADVANCE_PAYMENT_GUARANTEE: "APG",
  CUSTOM_BOND: "CUSTOMS BOND",
};

const POLICY_BUSINESS_FILE_INCLUDE = {
  customer: { select: { shortName: true, companyName: true, customerNumber: true } },
  project: { select: { projectName: true } },
  motorDetail: true,
  nonMotorDetail: true,
  bondDetail: true,
  workPermitDetail: true,
  sourceQuotation: { select: { id: true, quotationCaseId: true } },
  dropboxBusinessFile: true,
} satisfies Prisma.PolicyRecordInclude;

type PolicyForBusinessFile = Prisma.PolicyRecordGetPayload<{ include: typeof POLICY_BUSINESS_FILE_INCLUDE }>;

// Category/detail-derived (insuranceTypeCode, businessTitle) for the
// FALLBACK folder naming only (Part 3: "Suggested fallback folder naming:
// YYYYMMDD-<INSURANCE_CODE>-<BUSINESS_TITLE>"). Never guesses at a field
// that doesn't exist on the schema.
function resolveFallbackNaming(policy: PolicyForBusinessFile): { insuranceTypeCode: string; businessTitle: string } {
  const projectTitle = policy.project?.projectName;

  if (policy.category === "MOTOR" && policy.motorDetail) {
    return { insuranceTypeCode: "MOTOR", businessTitle: policy.motorDetail.registrationNumber || policy.recordNumber };
  }
  if (policy.category === "NON_MOTOR" && policy.nonMotorDetail) {
    return {
      insuranceTypeCode: NON_MOTOR_FOLDER_CODE[policy.nonMotorDetail.insuranceType],
      businessTitle: projectTitle || policy.recordNumber,
    };
  }
  if (policy.category === "BOND" && policy.bondDetail) {
    return {
      insuranceTypeCode: BOND_FOLDER_CODE[policy.bondDetail.bondType],
      businessTitle: projectTitle || policy.recordNumber,
    };
  }
  // WORK_PERMIT: WorkPermitPolicyDetail has no employee-name-equivalent
  // field (only permitType/agent/otherPermitType/permitNumber — see this
  // phase's Part 1 inspection) — never invented. Falls back to the
  // Policy's own recordNumber, the same safe universal fallback Quotation
  // naming uses when no better title candidate exists.
  return { insuranceTypeCode: "WORK PERMIT", businessTitle: projectTitle || policy.recordNumber };
}

async function ensurePolicyFallbackBusinessFile(policy: PolicyForBusinessFile) {
  if (policy.dropboxBusinessFile) return policy.dropboxBusinessFile;

  const { insuranceTypeCode, businessTitle } = resolveFallbackNaming(policy);
  const customerShortName = deriveCustomerShortName({
    shortName: policy.customer.shortName,
    companyName: policy.customer.companyName,
    customerNumber: policy.customer.customerNumber,
  });
  const businessFolderName = buildBusinessFolderName({ businessDate: policy.processingDate, insuranceTypeCode, businessTitle });

  try {
    return await prisma.policyDropboxBusinessFile.create({
      data: {
        policyRecordId: policy.id,
        businessDate: policy.processingDate,
        insuranceTypeCode,
        customerShortName,
        businessTitle,
        businessFolderName,
        syncStatus: "PENDING",
      },
    });
  } catch {
    // Lost a create race (unique policyRecordId) — reuse rather than error.
    return prisma.policyDropboxBusinessFile.findUniqueOrThrow({ where: { policyRecordId: policy.id } });
  }
}

// Only the fields resolveBusinessTitleCandidate actually reads — a lighter
// include than QUOTATION_SYNC_INCLUDE's full detail-relation set, since this
// path only needs to compute a business file that doesn't exist yet, never
// to generate/export the Excel itself.
async function createQuotationCaseBusinessFileFromCase(quotationCaseId: string) {
  const quotationCase = await prisma.quotationCase.findUnique({
    where: { id: quotationCaseId },
    select: { id: true, currentRevisionId: true },
  });
  if (!quotationCase) return null;

  const sourceQuotationId = await resolveSourceQuotationId(quotationCase);
  if (!sourceQuotationId) return null;

  const quotation = await prisma.quotation.findUnique({
    where: { id: sourceQuotationId },
    include: QUOTATION_SYNC_INCLUDE,
  });
  if (!quotation) return null;

  const insuranceTypeCode = resolveInsuranceTypeCodeForNaming(quotation.sections.map((s) => s.insuranceType.code));
  const businessTitle = resolveBusinessTitleCandidate(quotation.sections[0], quotation.quotationNumber);
  const customerShortName = deriveCustomerShortName({
    shortName: quotation.customer.shortName,
    companyName: quotation.customer.companyName,
    customerNumber: quotation.customer.customerNumber,
  });

  return prisma.$transaction((tx) =>
    ensureQuotationCaseDropboxBusinessFile(tx, {
      quotationCaseId,
      businessDate: quotation.quotationDate,
      insuranceTypeCode,
      businessTitle,
      customerShortName,
    })
  );
}

export type PolicyBusinessFileRef = {
  source: PolicyDropboxBusinessFileSource;
  businessFileId: string;
  businessFolderName: string;
  dropboxDisplayPath: string | null;
  dropboxFolderId: string | null;
  syncStatus: string;
  lastErrorMessage: string | null;
};

function toRef(
  source: PolicyDropboxBusinessFileSource,
  row: {
    id: string;
    businessFolderName: string;
    dropboxDisplayPath: string | null;
    dropboxFolderId: string | null;
    syncStatus: string;
    lastErrorMessage?: string | null;
  }
): PolicyBusinessFileRef {
  return {
    source,
    businessFileId: row.id,
    businessFolderName: row.businessFolderName,
    dropboxDisplayPath: row.dropboxDisplayPath,
    dropboxFolderId: row.dropboxFolderId,
    syncStatus: row.syncStatus,
    lastErrorMessage: row.lastErrorMessage ?? null,
  };
}

export type EnsurePolicyBusinessFileResult = { ok: true; ref: PolicyBusinessFileRef } | { ok: false; error: "POLICY_NOT_FOUND" };

// Main entry point — used by policyDocumentSync.ts before every upload
// attempt and by verify/admin actions. Never creates a duplicate business
// file: a linked Policy always resolves to its case's ONE
// QuotationDropboxBusinessFile; an unlinked Policy always resolves to its
// OWN ONE PolicyDropboxBusinessFile (unique policyRecordId).
export async function ensurePolicyDropboxBusinessFile(policyRecordId: string): Promise<EnsurePolicyBusinessFileResult> {
  const policy = await prisma.policyRecord.findUnique({
    where: { id: policyRecordId },
    include: POLICY_BUSINESS_FILE_INCLUDE,
  });
  if (!policy) return { ok: false, error: "POLICY_NOT_FOUND" };

  const quotationCaseId = policy.sourceQuotation?.quotationCaseId ?? null;

  if (quotationCaseId) {
    const existing = await prisma.quotationDropboxBusinessFile.findUnique({ where: { quotationCaseId } });
    if (existing) return { ok: true, ref: toRef("QUOTATION_CASE", existing) };

    // No Quotation Excel has ever been generated/synced for this case yet —
    // create the shared business file now so this Policy and any future
    // Quotation sync resolve to the exact same row (never a second one).
    const created = await createQuotationCaseBusinessFileFromCase(quotationCaseId);
    if (created) return { ok: true, ref: toRef("QUOTATION_CASE", created) };
    // Case unexpectedly has no revisions at all — fall through to the
    // Policy's own fallback file rather than failing outright.
  }

  const fallback = await ensurePolicyFallbackBusinessFile(policy);
  return { ok: true, ref: toRef("POLICY_FALLBACK", fallback) };
}

// Read-only resolution (no create) — used for planned-path display before
// any sync has happened, so the UI never triggers a write as a side effect
// of merely being viewed.
export async function resolvePolicyBusinessFileRefReadOnly(policyRecordId: string): Promise<PolicyBusinessFileRef | null> {
  const policy = await prisma.policyRecord.findUnique({
    where: { id: policyRecordId },
    include: POLICY_BUSINESS_FILE_INCLUDE,
  });
  if (!policy) return null;

  const quotationCaseId = policy.sourceQuotation?.quotationCaseId ?? null;
  if (quotationCaseId) {
    const existing = await prisma.quotationDropboxBusinessFile.findUnique({ where: { quotationCaseId } });
    if (existing) return toRef("QUOTATION_CASE", existing);
  }
  if (policy.dropboxBusinessFile) return toRef("POLICY_FALLBACK", policy.dropboxBusinessFile);

  // Nothing created yet — compute the deterministic planned name without
  // writing anything, so a brand-new Policy still shows a sensible planned
  // folder name before its first document sync.
  const { insuranceTypeCode, businessTitle } = resolveFallbackNaming(policy);
  const businessFolderName = buildBusinessFolderName({ businessDate: policy.processingDate, insuranceTypeCode, businessTitle });
  return {
    source: quotationCaseId ? "QUOTATION_CASE" : "POLICY_FALLBACK",
    businessFileId: "",
    businessFolderName,
    dropboxDisplayPath: null,
    dropboxFolderId: null,
    syncStatus: "PENDING",
    lastErrorMessage: null,
  };
}
