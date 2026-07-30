// Server-only. Dropbox Integration Phase 7 — resolves (and lazily creates)
// the ONE Dropbox business file a Non-Motor Claim's documents get filed
// under. Mirrors motorClaimBusinessFile.ts exactly (see its doc comment);
// only the fallback title priority differs (Part 3).
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { ensurePolicyDropboxBusinessFile, resolvePolicyBusinessFileRefReadOnly, NON_MOTOR_FOLDER_CODE, type PolicyBusinessFileRef } from "./policyBusinessFile";
import { buildBusinessFolderName } from "./quotationDropboxNaming";
import { deriveCustomerShortName } from "./customerShortName";
import type { ClaimBusinessFileRef } from "./motorClaimBusinessFile";

const CLAIM_FOLDER_CODE = "CLAIM";

const NON_MOTOR_CLAIM_BUSINESS_FILE_INCLUDE = {
  customer: { select: { shortName: true, companyName: true, customerNumber: true } },
  dropboxBusinessFile: true,
} satisfies Prisma.NonMotorClaimInclude;

type NonMotorClaimForBusinessFile = Prisma.NonMotorClaimGetPayload<{ include: typeof NON_MOTOR_CLAIM_BUSINESS_FILE_INCLUDE }>;

// Fallback title priority (Part 3): claim record number -> type-of-cover
// code + customer short name -> customer short name -> claim id-safe
// fallback. Only real fields — never an invented project/employee name.
function resolveNonMotorClaimFallbackTitle(claim: NonMotorClaimForBusinessFile, customerShortName: string): string {
  if (claim.claimNumber) return claim.claimNumber;
  const coverCode = NON_MOTOR_FOLDER_CODE[claim.insuranceType];
  if (coverCode && customerShortName) return `${coverCode} ${customerShortName}`;
  return customerShortName || claim.id;
}

async function ensureNonMotorClaimFallbackBusinessFile(claim: NonMotorClaimForBusinessFile) {
  if (claim.dropboxBusinessFile) return claim.dropboxBusinessFile;

  const customerShortName = deriveCustomerShortName({
    shortName: claim.customer.shortName,
    companyName: claim.customer.companyName,
    customerNumber: claim.customer.customerNumber,
  });
  const businessTitle = resolveNonMotorClaimFallbackTitle(claim, customerShortName);
  const businessFolderName = buildBusinessFolderName({ businessDate: claim.reportedAt, insuranceTypeCode: CLAIM_FOLDER_CODE, businessTitle });

  try {
    return await prisma.nonMotorClaimDropboxBusinessFile.create({
      data: {
        nonMotorClaimId: claim.id,
        businessDate: claim.reportedAt,
        insuranceTypeCode: CLAIM_FOLDER_CODE,
        customerShortName,
        businessTitle,
        businessFolderName,
        syncStatus: "PENDING",
      },
    });
  } catch {
    return prisma.nonMotorClaimDropboxBusinessFile.findUniqueOrThrow({ where: { nonMotorClaimId: claim.id } });
  }
}

function fromPolicyRef(ref: PolicyBusinessFileRef): ClaimBusinessFileRef {
  return {
    source: ref.source,
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

export type EnsureNonMotorClaimBusinessFileResult = { ok: true; ref: ClaimBusinessFileRef } | { ok: false; error: "CLAIM_NOT_FOUND" };

export async function ensureNonMotorClaimDropboxBusinessFile(nonMotorClaimId: string): Promise<EnsureNonMotorClaimBusinessFileResult> {
  const claim = await prisma.nonMotorClaim.findUnique({ where: { id: nonMotorClaimId }, include: NON_MOTOR_CLAIM_BUSINESS_FILE_INCLUDE });
  if (!claim) return { ok: false, error: "CLAIM_NOT_FOUND" };

  if (claim.policyRecordId) {
    const policyResult = await ensurePolicyDropboxBusinessFile(claim.policyRecordId);
    if (policyResult.ok) return { ok: true, ref: fromPolicyRef(policyResult.ref) };
  }

  const fallback = await ensureNonMotorClaimFallbackBusinessFile(claim);
  return { ok: true, ref: toFallbackRef(fallback) };
}

export async function resolveNonMotorClaimBusinessFileRefReadOnly(nonMotorClaimId: string): Promise<ClaimBusinessFileRef | null> {
  const claim = await prisma.nonMotorClaim.findUnique({ where: { id: nonMotorClaimId }, include: NON_MOTOR_CLAIM_BUSINESS_FILE_INCLUDE });
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
  const businessTitle = resolveNonMotorClaimFallbackTitle(claim, customerShortName);
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
