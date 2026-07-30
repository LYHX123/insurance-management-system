// Server-only. Dropbox Integration Phase 7 — resolves (and lazily creates)
// the ONE Dropbox business file a Motor Claim's documents get filed under.
// Mirrors invoiceBusinessFile.ts's shape exactly:
//   - linked Policy (claim.policyRecordId set): resolve through that
//     Policy's own resolver (ensurePolicyDropboxBusinessFile), reusing
//     whichever business file it already resolves to (QUOTATION_CASE or
//     POLICY_FALLBACK) — never a second, duplicate business folder for the
//     same insurance transaction (Part 3, requirement 1).
//   - no linked Policy: a dedicated MotorClaimDropboxBusinessFile fallback
//     (CLAIM_FALLBACK), 1:1 with the MotorClaim.
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { ClaimDropboxBusinessFileSource } from "@/generated/prisma/enums";
import { ensurePolicyDropboxBusinessFile, resolvePolicyBusinessFileRefReadOnly, type PolicyBusinessFileRef } from "./policyBusinessFile";
import { buildBusinessFolderName } from "./quotationDropboxNaming";
import { deriveCustomerShortName } from "./customerShortName";

const CLAIM_FOLDER_CODE = "CLAIM";

const MOTOR_CLAIM_BUSINESS_FILE_INCLUDE = {
  customer: { select: { shortName: true, companyName: true, customerNumber: true } },
  dropboxBusinessFile: true,
} satisfies Prisma.MotorClaimInclude;

type MotorClaimForBusinessFile = Prisma.MotorClaimGetPayload<{ include: typeof MOTOR_CLAIM_BUSINESS_FILE_INCLUDE }>;

// Fallback title priority (Part 3): number plate -> claim record number ->
// customer short name -> claim id-safe fallback. Only real fields — never
// an invented project/employee name. claimNumber is always present
// (required, unique) so the id fallback is defensive-only.
function resolveMotorClaimFallbackTitle(claim: MotorClaimForBusinessFile, customerShortName: string): string {
  return claim.numberPlate.trim() || claim.claimNumber || customerShortName || claim.id;
}

async function ensureMotorClaimFallbackBusinessFile(claim: MotorClaimForBusinessFile) {
  if (claim.dropboxBusinessFile) return claim.dropboxBusinessFile;

  const customerShortName = deriveCustomerShortName({
    shortName: claim.customer.shortName,
    companyName: claim.customer.companyName,
    customerNumber: claim.customer.customerNumber,
  });
  const businessTitle = resolveMotorClaimFallbackTitle(claim, customerShortName);
  const businessFolderName = buildBusinessFolderName({ businessDate: claim.reportedAt, insuranceTypeCode: CLAIM_FOLDER_CODE, businessTitle });

  try {
    return await prisma.motorClaimDropboxBusinessFile.create({
      data: {
        motorClaimId: claim.id,
        businessDate: claim.reportedAt,
        insuranceTypeCode: CLAIM_FOLDER_CODE,
        customerShortName,
        businessTitle,
        businessFolderName,
        syncStatus: "PENDING",
      },
    });
  } catch {
    // Lost a create race (unique motorClaimId) — reuse rather than error.
    return prisma.motorClaimDropboxBusinessFile.findUniqueOrThrow({ where: { motorClaimId: claim.id } });
  }
}

export type ClaimBusinessFileRef = {
  source: ClaimDropboxBusinessFileSource;
  businessFileId: string;
  businessFolderName: string;
  dropboxDisplayPath: string | null;
  dropboxFolderId: string | null;
  syncStatus: string;
  lastErrorMessage: string | null;
};

function fromPolicyRef(ref: PolicyBusinessFileRef): ClaimBusinessFileRef {
  return {
    source: ref.source, // "QUOTATION_CASE" | "POLICY_FALLBACK" — both valid members of ClaimDropboxBusinessFileSource too.
    businessFileId: ref.businessFileId,
    businessFolderName: ref.businessFolderName,
    dropboxDisplayPath: ref.dropboxDisplayPath,
    dropboxFolderId: ref.dropboxFolderId,
    syncStatus: ref.syncStatus,
    lastErrorMessage: ref.lastErrorMessage,
  };
}

function toFallbackRef(row: {
  id: string;
  businessFolderName: string;
  dropboxDisplayPath: string | null;
  dropboxFolderId: string | null;
  syncStatus: string;
  lastErrorMessage?: string | null;
}): ClaimBusinessFileRef {
  return {
    source: "CLAIM_FALLBACK",
    businessFileId: row.id,
    businessFolderName: row.businessFolderName,
    dropboxDisplayPath: row.dropboxDisplayPath,
    dropboxFolderId: row.dropboxFolderId,
    syncStatus: row.syncStatus,
    lastErrorMessage: row.lastErrorMessage ?? null,
  };
}

export type EnsureMotorClaimBusinessFileResult = { ok: true; ref: ClaimBusinessFileRef } | { ok: false; error: "CLAIM_NOT_FOUND" };

export async function ensureMotorClaimDropboxBusinessFile(motorClaimId: string): Promise<EnsureMotorClaimBusinessFileResult> {
  const claim = await prisma.motorClaim.findUnique({ where: { id: motorClaimId }, include: MOTOR_CLAIM_BUSINESS_FILE_INCLUDE });
  if (!claim) return { ok: false, error: "CLAIM_NOT_FOUND" };

  if (claim.policyRecordId) {
    const policyResult = await ensurePolicyDropboxBusinessFile(claim.policyRecordId);
    if (policyResult.ok) return { ok: true, ref: fromPolicyRef(policyResult.ref) };
    // The linked PolicyRecord vanished (onDelete: SetNull means this claim's
    // policyRecordId would already have been cleared to null by the DB in
    // that case, so this branch is defensive-only) — fall through.
  }

  const fallback = await ensureMotorClaimFallbackBusinessFile(claim);
  return { ok: true, ref: toFallbackRef(fallback) };
}

// Read-only resolution (no create) — used for planned-path display before
// any sync has happened.
export async function resolveMotorClaimBusinessFileRefReadOnly(motorClaimId: string): Promise<ClaimBusinessFileRef | null> {
  const claim = await prisma.motorClaim.findUnique({ where: { id: motorClaimId }, include: MOTOR_CLAIM_BUSINESS_FILE_INCLUDE });
  if (!claim) return null;

  if (claim.policyRecordId) {
    const ref = await resolvePolicyBusinessFileRefReadOnly(claim.policyRecordId);
    if (ref) return fromPolicyRef(ref);
  }

  if (claim.dropboxBusinessFile) return toFallbackRef(claim.dropboxBusinessFile);

  const customerShortName = deriveCustomerShortName({
    shortName: claim.customer.shortName,
    companyName: claim.customer.companyName,
    customerNumber: claim.customer.customerNumber,
  });
  const businessTitle = resolveMotorClaimFallbackTitle(claim, customerShortName);
  const businessFolderName = buildBusinessFolderName({ businessDate: claim.reportedAt, insuranceTypeCode: CLAIM_FOLDER_CODE, businessTitle });
  return {
    source: "CLAIM_FALLBACK",
    businessFileId: "",
    businessFolderName,
    dropboxDisplayPath: null,
    dropboxFolderId: null,
    syncStatus: "PENDING",
    lastErrorMessage: null,
  };
}
