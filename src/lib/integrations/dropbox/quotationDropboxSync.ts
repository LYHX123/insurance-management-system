// Server-only. Dropbox Integration Phase 4 — generates/persists a
// Quotation's Excel artifact locally (Part 8: no local storage existed for
// this before Phase 4) and synchronizes it into the Insurance Business
// File Dropbox structure. Local generation/storage stays authoritative and
// immediate: nothing here ever blocks or reverses it. PDF is intentionally
// never generated — no PDF pipeline exists in this application (Part 1
// finding); only excelSyncStatus/excelDropboxFileId etc. are ever written.
import type { Dropbox } from "dropbox";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { documentStorageService } from "@/lib/quotationDocuments/storage";
import { getAuthenticatedDropboxClient } from "./service";
import { syncCustomerFolder } from "./customer-folders";
import { joinDropboxPath, assertInsideRoot } from "./paths";
import { DropboxIntegrationError, mapDropboxError, type DropboxErrorCode } from "./errors";
import { deriveCustomerShortName, classifyCustomerShortNames, type CustomerShortNameReviewStats } from "./customerShortName";
import {
  buildBusinessFolderName,
  disambiguateBusinessFolderName,
  buildQuotationBaseFileName,
  resolveInsuranceTypeCodeForNaming,
} from "./quotationDropboxNaming";
import { computeQuotationContentFingerprint } from "./quotationContentFingerprint";
import { generateQuotationExcel, TemplateGenerationError } from "@/lib/quotationTemplateEngine";
import { withRateLimitBackoff, INTERACTIVE_BACKOFF } from "./rateLimitRetry";

const STALE_SYNCING_THRESHOLD_MS = 2 * 60 * 1000;
const QUOTATION_SUBFOLDER_NAME = "Quotation";

// Full detail-relation shape needed both to generate the Excel workbook
// (generateQuotationExcel) and to compute the content fingerprint — a
// strict superset of quotationTemplateEngine's own QuotationForExport
// (adds insuranceType.code and the extra Customer fields Phase 4 naming
// needs), so a fetched row here is structurally assignable to both.
const QUOTATION_SYNC_INCLUDE = {
  customer: { select: { companyName: true, shortName: true, customerNumber: true } },
  project: { select: { projectName: true } },
  sections: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      insuranceType: { select: { code: true } },
      items: true,
      carDetail: true,
      wibaDetail: { include: { payrollRows: true } },
      elDetail: true,
      cpmDetail: { include: { equipmentRows: true } },
      publicLiabilityDetail: true,
      fireDetail: true,
      burglaryDetail: true,
      gitSingleDetail: true,
      gitAnnualDetail: true,
      marineDetail: { include: { shipmentRows: true } },
      motorCompPrivateDetail: true,
      motorCompCommercialDetail: true,
      motorTpoPrivateDetail: true,
      motorTpoCommercialDetail: true,
      gpaDetail: true,
      medicalDetail: { include: { categoryRows: true } },
      tenderSecurityDetail: true,
      performanceBondDetail: true,
      advancePaymentGuaranteeDetail: true,
      customsBondDetail: { include: { itemRows: true } },
    },
  },
} satisfies Prisma.QuotationInclude;

type QuotationForSync = Prisma.QuotationGetPayload<{ include: typeof QUOTATION_SYNC_INCLUDE }>;
export type SectionForSync = QuotationForSync["sections"][number];
export { QUOTATION_SYNC_INCLUDE };

// Business-title source order (Part 4, requirement 3): A. project name
// (CAR) B. vehicle plate (Motor, any of the 4 variants) C. bond/tender
// project name D. (no product/route field exists in this schema — skipped,
// per "do not invent") E. quotation number as the safe fallback.
// Exported (Dropbox Integration Phase 5) — the Policy business-file
// resolution module's linked-Policy path (a case with no Quotation
// business file yet) needs the exact same title-candidate resolution when
// creating one on the fly.
export function resolveBusinessTitleCandidate(section: SectionForSync | undefined, quotationNumber: string): string {
  if (section?.carDetail?.projectName) return section.carDetail.projectName;
  const plate =
    section?.motorCompPrivateDetail?.plateNo ??
    section?.motorCompCommercialDetail?.plateNo ??
    section?.motorTpoPrivateDetail?.plateNo ??
    section?.motorTpoCommercialDetail?.plateNo;
  if (plate) return plate;
  const bondProject =
    section?.tenderSecurityDetail?.projectName ??
    section?.performanceBondDetail?.projectName ??
    section?.advancePaymentGuaranteeDetail?.projectName;
  if (bondProject) return bondProject;
  return quotationNumber;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export type GenerateResult =
  | { success: true; buffer: Buffer; versionNumber: number; dropboxStatus: string }
  | { success: false; error: "QUOTATION_NOT_FOUND" | "QUOTATION_HAS_NO_CASE" | "EXPORT_FAILED" };

// Main entry point for the excel-template route (Part 8). Generates the
// current Excel bytes, reuses or creates the correct version by content
// fingerprint, persists it locally, then — only when this is a new version
// or the existing one isn't already SYNCED — attempts a bounded Dropbox
// sync. Never throws; Dropbox failure never prevents the buffer from being
// returned to the caller (Part 8, requirement 9).
export async function generateAndSyncQuotationExcel(quotationId: string): Promise<GenerateResult> {
  const quotation = (await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: QUOTATION_SYNC_INCLUDE,
  })) as QuotationForSync | null;
  if (!quotation) return { success: false, error: "QUOTATION_NOT_FOUND" };
  // Every real revision is created under a QuotationCase (Phase 1); this
  // field is only nullable because it was added additively to a table that
  // already had rows. Defensive, not expected to ever trigger in practice
  // (Correction 1: the business file is owned by the Case, so a caseless
  // revision has nowhere to attach one).
  if (!quotation.quotationCaseId) return { success: false, error: "QUOTATION_HAS_NO_CASE" };
  const quotationCaseId = quotation.quotationCaseId;

  let buffer: Buffer;
  try {
    const result = await generateQuotationExcel(quotation);
    buffer = Buffer.isBuffer(result.buffer) ? result.buffer : Buffer.from(result.buffer);
  } catch (err) {
    console.error(`Failed to generate Excel for quotation ${quotationId}:`, err instanceof TemplateGenerationError ? err.message : err);
    return { success: false, error: "EXPORT_FAILED" };
  }

  const fingerprint = computeQuotationContentFingerprint(quotation);
  const firstSection = quotation.sections[0];
  // Correction 2: a combined quotation (more than one distinct normalized
  // insurance type across ALL its sections) is labeled MULTI rather than
  // just using the first section's type.
  const insuranceTypeCode = resolveInsuranceTypeCodeForNaming(quotation.sections.map((s) => s.insuranceType.code));
  const businessTitle = resolveBusinessTitleCandidate(firstSection, quotation.quotationNumber);
  const customerShortName = deriveCustomerShortName({
    shortName: quotation.customer.shortName,
    companyName: quotation.customer.companyName,
    customerNumber: quotation.customer.customerNumber,
  });

  const { versionId, versionNumber, isNewVersion } = await resolveVersion({
    sourceQuotationId: quotationId,
    quotationCaseId,
    quotationNumber: quotation.quotationNumber,
    businessDate: quotation.quotationDate,
    insuranceTypeCode,
    businessTitle,
    customerShortName,
    fingerprint,
  });

  const storageKey = `generated/${quotationId}/v${versionNumber}`;
  const fileName = `${(await prisma.quotationDropboxVersion.findUniqueOrThrow({ where: { id: versionId }, select: { baseFileName: true } })).baseFileName}.xlsx`;
  const { storagePath } = await documentStorageService.saveFile({
    quotationCaseId,
    documentFolderId: storageKey,
    fileName,
    buffer,
  });
  await prisma.quotationDropboxVersion.update({ where: { id: versionId }, data: { excelLocalStorageKey: storagePath } });

  const currentVersion = await prisma.quotationDropboxVersion.findUniqueOrThrow({ where: { id: versionId } });
  const dropboxStatus =
    isNewVersion || currentVersion.excelSyncStatus !== "SYNCED"
      ? await syncQuotationVersionWithTimeout(versionId)
      : currentVersion.excelSyncStatus;

  return { success: true, buffer, versionNumber, dropboxStatus };
}

// Correction 1: the business file belongs directly to the QuotationCase
// (a 1:1 relation). Extracted (Dropbox Integration Phase 5) so the Policy
// business-file resolution module's linked-Policy path can reuse the exact
// same get-or-create semantics — a Policy created from a case that has
// never had an Excel version generated must still resolve/create the SAME one
// business file a later Quotation sync would use, never a second one.
export async function ensureQuotationCaseDropboxBusinessFile(
  tx: Prisma.TransactionClient,
  input: {
    quotationCaseId: string;
    businessDate: Date;
    insuranceTypeCode: string;
    businessTitle: string;
    customerShortName: string;
  }
) {
  let businessFile = await tx.quotationDropboxBusinessFile.findUnique({ where: { quotationCaseId: input.quotationCaseId } });
  if (!businessFile) {
    const businessFolderName = buildBusinessFolderName({
      businessDate: input.businessDate,
      insuranceTypeCode: input.insuranceTypeCode,
      businessTitle: input.businessTitle,
    });
    try {
      businessFile = await tx.quotationDropboxBusinessFile.create({
        data: {
          quotationCaseId: input.quotationCaseId,
          businessDate: input.businessDate,
          insuranceTypeCode: input.insuranceTypeCode,
          customerShortName: input.customerShortName,
          businessTitle: input.businessTitle,
          businessFolderName,
          syncStatus: "PENDING",
        },
      });
    } catch {
      // Lost a create race (unique quotationCaseId) — another concurrent
      // revision of the same case already created the business file;
      // reuse it rather than erroring.
      businessFile = await tx.quotationDropboxBusinessFile.findUniqueOrThrow({ where: { quotationCaseId: input.quotationCaseId } });
    }
  }
  return businessFile;
}

// R01/R02/R03 all resolve the SAME businessFile row via quotationCaseId —
// no sibling-revision search is needed anymore; case ownership is a direct
// foreign key, not something inferred by scanning other rows.
async function resolveVersion(input: {
  sourceQuotationId: string;
  quotationCaseId: string;
  quotationNumber: string;
  businessDate: Date;
  insuranceTypeCode: string;
  businessTitle: string;
  customerShortName: string;
  fingerprint: string;
}): Promise<{ versionId: string; versionNumber: number; isNewVersion: boolean }> {
  return prisma.$transaction(async (tx) => {
    const businessFile = await ensureQuotationCaseDropboxBusinessFile(tx, input);

    // Version sequence is scoped to the one shared business file (Part 6:
    // versions of the same business file, not per-revision).
    const latest = await tx.quotationDropboxVersion.findFirst({
      where: { businessFileId: businessFile.id },
      orderBy: { versionNumber: "desc" },
    });

    if (latest && latest.contentFingerprint === input.fingerprint) {
      return { versionId: latest.id, versionNumber: latest.versionNumber, isNewVersion: false };
    }

    const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;
    const baseFileName = buildQuotationBaseFileName({
      insuranceTypeCode: businessFile.insuranceTypeCode,
      customerShortName: businessFile.customerShortName,
      businessDate: businessFile.businessDate,
      versionNumber: nextVersionNumber,
    });

    try {
      const created = await tx.quotationDropboxVersion.create({
        data: {
          businessFileId: businessFile.id,
          quotationCaseId: input.quotationCaseId,
          sourceQuotationId: input.sourceQuotationId,
          versionNumber: nextVersionNumber,
          baseFileName,
          contentFingerprint: input.fingerprint,
          generatedAt: new Date(),
          excelSyncStatus: "PENDING",
        },
      });
      return { versionId: created.id, versionNumber: created.versionNumber, isNewVersion: true };
    } catch {
      // Lost a create race (unique [businessFileId, versionNumber]) —
      // another concurrent request already created this exact version;
      // reuse it rather than erroring (Part 6, requirement 12).
      const existing = await tx.quotationDropboxVersion.findUnique({
        where: { businessFileId_versionNumber: { businessFileId: businessFile.id, versionNumber: nextVersionNumber } },
      });
      if (existing) return { versionId: existing.id, versionNumber: existing.versionNumber, isNewVersion: false };
      throw new Error("Failed to resolve Quotation Dropbox version after a create race.");
    }
  });
}

export type QuotationSyncResult = {
  success: boolean;
  status: "PENDING" | "SYNCING" | "SYNCED" | "ERROR" | "CONFLICT";
  code?: DropboxErrorCode;
  message?: string;
};

async function failVersionResult(
  versionId: string,
  status: QuotationSyncResult["status"],
  code: DropboxErrorCode,
  message: string
): Promise<QuotationSyncResult> {
  await prisma.quotationDropboxVersion
    .update({ where: { id: versionId }, data: { excelSyncStatus: status === "SYNCING" ? "SYNCING" : mapStatus(status) } })
    .catch(() => {});
  return { success: false, status, code, message };
}

function mapStatus(status: QuotationSyncResult["status"]): "PENDING" | "SYNCING" | "SYNCED" | "ERROR" | "CONFLICT" {
  return status;
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("status" in err)) return false;
  const status = (err as { status: unknown }).status;
  const error = (err as { error?: unknown }).error;
  const summary =
    error && typeof error === "object" && "error_summary" in error && typeof (error as { error_summary: unknown }).error_summary === "string"
      ? (error as { error_summary: string }).error_summary
      : "";
  return status === 409 && summary.includes("not_found");
}

async function tryGetMetadata(client: Dropbox, path: string): Promise<{ tag: string; id: string | null; displayPath: string; rev?: string } | null> {
  try {
    // Phase 8 Part 8: bounded backoff on Dropbox rate-limit (429) responses.
    const metadata = await withRateLimitBackoff(() => client.filesGetMetadata({ path }));
    const result = metadata.result;
    return {
      tag: result[".tag"],
      id: "id" in result ? (result.id ?? null) : null,
      displayPath: "path_display" in result ? (result.path_display ?? path) : path,
      rev: "rev" in result ? result.rev : undefined,
    };
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw mapDropboxError(err);
  }
}

const DROPBOX_SYNC_TIMEOUT_MS = 15_000;

async function syncQuotationVersionWithTimeout(versionId: string): Promise<string> {
  try {
    const result = await Promise.race([
      syncQuotationVersionToDropbox(versionId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), DROPBOX_SYNC_TIMEOUT_MS)),
    ]);
    return result?.status ?? "PENDING";
  } catch {
    return "ERROR";
  }
}

// Idempotent, retryable — used by generateAndSyncQuotationExcel above, by
// ADMIN retry/re-upload actions, and by backfill. Always re-reads the
// current local artifact from excelLocalStorageKey rather than requiring
// bytes to be passed in (Part 8/10: "retry must reuse the same local
// artifact"). Never throws.
export async function syncQuotationVersionToDropbox(versionId: string): Promise<QuotationSyncResult> {
  const version = await prisma.quotationDropboxVersion.findUnique({
    where: { id: versionId },
    include: {
      businessFile: { include: { quotationCase: { include: { customer: { include: { dropboxFolder: true } } } } } },
    },
  });
  if (!version) return { success: false, status: "ERROR", code: "QUOTATION_VERSION_CONFLICT", message: "Version not found." };

  if (version.excelSyncStatus === "SYNCING" && version.updatedAt) {
    const age = Date.now() - version.updatedAt.getTime();
    if (age < STALE_SYNCING_THRESHOLD_MS) {
      return { success: false, status: "SYNCING", message: "A synchronization is already in progress." };
    }
  }
  await prisma.quotationDropboxVersion.update({ where: { id: versionId }, data: { excelSyncStatus: "SYNCING" } });

  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) {
    return failVersionResult(versionId, "ERROR", "DROPBOX_NOT_CONNECTED", auth.message);
  }

  const businessFile = version.businessFile;
  const quotationCase = businessFile.quotationCase;
  const customer = quotationCase.customer;

  let customerFolderPath = customer.dropboxFolder?.displayPath ?? null;
  if (customer.dropboxFolder?.syncStatus !== "SYNCED" || !customerFolderPath) {
    const folderSync = await syncCustomerFolder(quotationCase.customerId);
    if (!folderSync.success || !folderSync.path) {
      return failVersionResult(versionId, "ERROR", "CUSTOMER_FOLDER_NOT_SYNCED", "The customer's Dropbox folder is not synchronized yet.");
    }
    customerFolderPath = folderSync.path;
  }

  // Ensure the business folder exists/is known (Part 7, requirement 1-2).
  let businessFolderPath = businessFile.dropboxDisplayPath;
  if (businessFile.syncStatus !== "SYNCED" || !businessFolderPath) {
    const ensured = await ensureBusinessFolder(auth.client, customerFolderPath, businessFile.businessFolderName, quotationCase.quotationNumber);
    if (!ensured.ok) {
      await prisma.quotationDropboxBusinessFile.update({
        where: { id: businessFile.id },
        data: { syncStatus: ensured.status, lastErrorCode: ensured.code, lastErrorMessage: ensured.message, lastSyncAttemptAt: new Date() },
      });
      return failVersionResult(versionId, ensured.status, ensured.code, ensured.message);
    }
    await prisma.quotationDropboxBusinessFile.update({
      where: { id: businessFile.id },
      data: {
        businessFolderName: ensured.finalFolderName,
        dropboxFolderId: ensured.folderId,
        dropboxDisplayPath: ensured.displayPath,
        dropboxPathLower: ensured.displayPath.toLowerCase(),
        syncStatus: "SYNCED",
        lastSyncedAt: new Date(),
        lastSyncAttemptAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    businessFolderPath = ensured.displayPath;
  }

  // Ensure the "Quotation" subfolder inside the business folder (Part 7,
  // requirement 3) — never Policy/Invoice/Claim, never insurance-type
  // folders elsewhere. Simple idempotent check-then-create. joinDropboxPath
  // itself can throw (e.g. a corrupted businessFolderPath) — kept inside
  // the try block so that, like everything else here, this function never
  // throws (Part 16: defense in depth against a malformed stored path).
  // Definite-assignment: joinDropboxPath only ever throws a
  // ROOT_PATH_INVALID DropboxIntegrationError, which the catch block below
  // always returns from — so any code reached after this try/catch has
  // this assigned. The `?? ` fallback in the catch's recheck path handles
  // the (never-actually-reached-past-this-point) unassigned case
  // defensively anyway.
  let quotationFolderPath!: string;
  try {
    quotationFolderPath = joinDropboxPath(businessFolderPath, QUOTATION_SUBFOLDER_NAME);
    assertInsideRoot(quotationFolderPath, auth.row.rootFolder);
    const existingSubfolder = await tryGetMetadata(auth.client, quotationFolderPath);
    if (!existingSubfolder) {
      await withRateLimitBackoff(() => auth.client.filesCreateFolderV2({ path: quotationFolderPath, autorename: false }));
    } else if (existingSubfolder.tag !== "folder") {
      return failVersionResult(versionId, "CONFLICT", "BUSINESS_FOLDER_CONFLICT", "A file exists where the Quotation subfolder should be.");
    }
  } catch (err) {
    if (err instanceof DropboxIntegrationError && err.code === "ROOT_PATH_INVALID") {
      return failVersionResult(versionId, "ERROR", "DROPBOX_FILE_OUTSIDE_ROOT", err.message);
    }
    // A 409 conflict on create (race with a concurrent sync) is safe —
    // recheck once; anything else is a genuine mapped error. (If
    // joinDropboxPath itself threw above, quotationFolderPath was never
    // assigned — recompute it defensively via string concatenation purely
    // for this recheck lookup, which itself is guarded by the outer catch.)
    const recheckPath = quotationFolderPath! ?? `${businessFolderPath}/${QUOTATION_SUBFOLDER_NAME}`;
    const recheck = await tryGetMetadata(auth.client, recheckPath).catch(() => null);
    if (!recheck) {
      const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
      return failVersionResult(versionId, "ERROR", mapped.code, mapped.message);
    }
  }

  const file = await documentStorageService.fileExists(version.excelLocalStorageKey ?? "");
  if (!version.excelLocalStorageKey || !file) {
    return failVersionResult(versionId, "ERROR", "LOCAL_FILE_NOT_FOUND", "The locally generated Excel file could not be found.");
  }
  const metadata = await documentStorageService.getMetadata(version.excelLocalStorageKey);
  if (!metadata || metadata.size <= 0) {
    return failVersionResult(versionId, "ERROR", "LOCAL_FILE_NOT_FOUND", "The locally generated Excel file is empty.");
  }
  const stream = await documentStorageService.openFile(version.excelLocalStorageKey);
  const buffer = await streamToBuffer(stream);

  const targetPath = joinDropboxPath(quotationFolderPath, `${version.baseFileName}.xlsx`);
  try {
    assertInsideRoot(targetPath, auth.row.rootFolder);
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return failVersionResult(versionId, "ERROR", "DROPBOX_FILE_OUTSIDE_ROOT", mapped.message);
  }

  try {
    const existing = await tryGetMetadata(auth.client, targetPath);
    let uploadMode: { ".tag": "add" } | { ".tag": "update"; update: string } = { ".tag": "add" };
    if (existing) {
      if (existing.tag !== "file") {
        return failVersionResult(versionId, "CONFLICT", "DROPBOX_FILE_IS_FOLDER", "A folder already exists at the required Quotation file path.");
      }
      const linkedToUs = version.excelDropboxFileId && existing.id === version.excelDropboxFileId;
      if (!linkedToUs) {
        return failVersionResult(versionId, "CONFLICT", "QUOTATION_VERSION_CONFLICT", "A different, unrelated file already exists at this version's Dropbox path.");
      }
      uploadMode = existing.rev ? { ".tag": "update", update: existing.rev } : { ".tag": "add" };
    }

    const uploaded = await withRateLimitBackoff(() => auth.client.filesUpload({ path: targetPath, mode: uploadMode, autorename: false, contents: buffer }));
    const result = uploaded.result;

    await prisma.quotationDropboxVersion.update({
      where: { id: versionId },
      data: {
        excelDropboxFileId: result.id,
        excelDropboxRevision: result.rev,
        excelDropboxPath: result.path_display ?? targetPath,
        excelSyncStatus: "SYNCED",
        lastSyncedAt: new Date(),
      },
    });
    return { success: true, status: "SYNCED" };
  } catch (err) {
    if (err instanceof DropboxIntegrationError) {
      return failVersionResult(versionId, err.code === "CUSTOMER_DOCUMENT_CONFLICT" ? "CONFLICT" : "ERROR", err.code, err.message);
    }
    const mapped = mapDropboxError(err);
    return failVersionResult(versionId, "ERROR", mapped.code, mapped.message);
  }
}

export type EnsureBusinessFolderResult =
  | { ok: true; folderId: string | null; displayPath: string; finalFolderName: string }
  | { ok: false; status: "ERROR" | "CONFLICT"; code: DropboxErrorCode; message: string };

// Deterministic collision handling (Part 4, requirement 5). This function
// is only called when neither this business-file row nor any sibling
// revision under the same case already has a synced folder — so if
// Dropbox reports something already at the path, it was created by
// something OUTSIDE this app's tracking and must be treated as unrelated,
// never silently reused. Create-and-catch (not check-then-create) closes
// the TOCTOU race window: filesCreateFolderV2 with autorename:false itself
// atomically fails if the path is already occupied.
//
// Exported (Dropbox Integration Phase 5) — disambiguationSuffix was
// "quotationNumber" until this phase; the Policy sync module's fallback-file
// path reuses this exact same folder-creation/collision logic, passing the
// Policy's recordNumber as the suffix instead.
export async function ensureBusinessFolder(
  client: Dropbox,
  customerFolderPath: string,
  businessFolderName: string,
  disambiguationSuffix: string
): Promise<EnsureBusinessFolderResult> {
  const tryCreateAt = async (
    folderName: string
  ): Promise<{ created: true; folderId: string | null; displayPath: string } | { created: false; isFile: boolean }> => {
    const path = joinDropboxPath(customerFolderPath, folderName);
    try {
      const created = await withRateLimitBackoff(() => client.filesCreateFolderV2({ path, autorename: false }));
      return { created: true, folderId: created.result.metadata.id ?? null, displayPath: created.result.metadata.path_display ?? path };
    } catch (err) {
      const existing = await tryGetMetadata(client, path).catch(() => null);
      if (existing) return { created: false, isFile: existing.tag !== "folder" };
      throw err;
    }
  };

  try {
    const first = await tryCreateAt(businessFolderName);
    if (first.created) return { ok: true, folderId: first.folderId, displayPath: first.displayPath, finalFolderName: businessFolderName };
    if (first.isFile) {
      return { ok: false, status: "CONFLICT", code: "BUSINESS_FOLDER_CONFLICT", message: "A file already exists at the required business folder path." };
    }

    // An unrelated folder occupies the plain name — retry once at a
    // suffixed path (never overwrite, never delete).
    const suffixed = disambiguateBusinessFolderName(businessFolderName, disambiguationSuffix);
    const second = await tryCreateAt(suffixed);
    if (second.created) return { ok: true, folderId: second.folderId, displayPath: second.displayPath, finalFolderName: suffixed };

    return {
      ok: false,
      status: "CONFLICT",
      code: "BUSINESS_FOLDER_CONFLICT",
      message: "An unrelated Dropbox folder already occupies both the standard and suffixed business folder paths.",
    };
  } catch (err) {
    if (err instanceof DropboxIntegrationError) {
      return { ok: false, status: "ERROR", code: err.code, message: err.message };
    }
    const mapped = mapDropboxError(err);
    return { ok: false, status: "ERROR", code: mapped.code, message: mapped.message };
  }
}

// --- Read-only verification (Part 9/10) --------------------------------
// Both functions below only call filesGetMetadata — never
// create/upload/move/delete anything in Dropbox. They may still refresh
// our own DB metadata to reflect what was observed, same convention as
// Phase 3's verifyCustomerFolder/verifyCustomerDocumentSync.

// Verifies the business folder itself: resolves by id, confirms it's a
// folder, inside the configured root, and inside the customer's own
// Dropbox folder. Accepts a Quotation (revision) id since callers (UI,
// admin actions) still operate per-revision — the business file is
// resolved via that revision's QuotationCase (Correction 1: one shared
// folder per case, not per revision).
export async function verifyBusinessFolder(quotationId: string): Promise<QuotationSyncResult> {
  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { quotationCaseId: true } });
  if (!quotation?.quotationCaseId) {
    return { success: false, status: "ERROR", code: "QUOTATION_NOT_FOUND", message: "No business file exists for this Quotation yet." };
  }

  const businessFile = await prisma.quotationDropboxBusinessFile.findUnique({
    where: { quotationCaseId: quotation.quotationCaseId },
    include: { quotationCase: { include: { customer: { include: { dropboxFolder: true } } } } },
  });
  if (!businessFile) return { success: false, status: "ERROR", code: "QUOTATION_NOT_FOUND", message: "No business file exists for this Quotation yet." };
  if (!businessFile.dropboxFolderId) return { success: false, status: "PENDING", message: "The business folder has not been synchronized yet." };

  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) return { success: false, status: "ERROR", code: "DROPBOX_NOT_CONNECTED", message: auth.message };

  const customerFolderPath = businessFile.quotationCase.customer.dropboxFolder?.displayPath;
  if (!customerFolderPath) {
    return failBusinessFileResult(businessFile.id, "ERROR", "CUSTOMER_FOLDER_NOT_SYNCED", "The customer's Dropbox folder is not synchronized.");
  }

  try {
    // Read-only single-record check (Part 9/10 convention) — bounded
    // tightly so an admin's Verify click never hangs.
    const metadata = await withRateLimitBackoff(() => auth.client.filesGetMetadata({ path: businessFile.dropboxFolderId! }), INTERACTIVE_BACKOFF);
    if (metadata.result[".tag"] !== "folder") {
      return failBusinessFileResult(businessFile.id, "ERROR", "BUSINESS_FOLDER_CONFLICT", "The linked Dropbox object is not a folder.");
    }
    const resolvedPath = metadata.result.path_display ?? businessFile.dropboxDisplayPath ?? "";
    try {
      assertInsideRoot(resolvedPath, auth.row.rootFolder);
    } catch {
      return failBusinessFileResult(businessFile.id, "ERROR", "DROPBOX_FILE_OUTSIDE_ROOT", "The business folder is outside the configured Dropbox root.");
    }
    if (!resolvedPath.startsWith(`${customerFolderPath}/`)) {
      return failBusinessFileResult(businessFile.id, "CONFLICT", "BUSINESS_FOLDER_CONFLICT", "The business folder is no longer inside the customer's Dropbox folder.");
    }

    await prisma.quotationDropboxBusinessFile.update({
      where: { id: businessFile.id },
      data: {
        dropboxDisplayPath: resolvedPath,
        dropboxPathLower: metadata.result.path_lower ?? resolvedPath.toLowerCase(),
        syncStatus: "SYNCED",
        lastSyncedAt: new Date(),
        lastSyncAttemptAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    return { success: true, status: "SYNCED" };
  } catch (err) {
    if (isNotFoundError(err)) {
      return failBusinessFileResult(businessFile.id, "ERROR", "DROPBOX_FILE_NOT_FOUND", "The business folder could not be found.");
    }
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return failBusinessFileResult(businessFile.id, mapped.code === "BUSINESS_FOLDER_CONFLICT" ? "CONFLICT" : "ERROR", mapped.code, mapped.message);
  }
}

async function failBusinessFileResult(
  businessFileId: string,
  status: QuotationSyncResult["status"],
  code: DropboxErrorCode,
  message: string
): Promise<QuotationSyncResult> {
  await prisma.quotationDropboxBusinessFile
    .update({ where: { id: businessFileId }, data: { syncStatus: status, lastErrorCode: code, lastErrorMessage: message, lastSyncAttemptAt: new Date() } })
    .catch(() => {});
  return { success: false, status, code, message };
}

// Verifies one version's Excel file: resolves by id, confirms it's a file,
// inside the configured root, inside "<business folder>/Quotation", and
// that stored size/hash (if we have them) still match.
export async function verifyQuotationVersion(versionId: string): Promise<QuotationSyncResult> {
  const version = await prisma.quotationDropboxVersion.findUnique({
    where: { id: versionId },
    include: {
      businessFile: { include: { quotationCase: { include: { customer: { include: { dropboxFolder: true } } } } } },
    },
  });
  if (!version) return { success: false, status: "ERROR", code: "QUOTATION_VERSION_CONFLICT", message: "Version not found." };
  if (!version.excelDropboxFileId) return { success: false, status: "PENDING", message: "This version has not been synchronized yet." };

  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) return { success: false, status: "ERROR", code: "DROPBOX_NOT_CONNECTED", message: auth.message };

  const businessFolderPath = version.businessFile.dropboxDisplayPath;
  if (!businessFolderPath) {
    return failVersionResult(versionId, "ERROR", "BUSINESS_FOLDER_NOT_SYNCED", "The business folder is not synchronized.");
  }

  try {
    // Read-only single-record check (Part 9/10 convention) — bounded
    // tightly so an admin's Verify click never hangs.
    const metadata = await withRateLimitBackoff(() => auth.client.filesGetMetadata({ path: version.excelDropboxFileId! }), INTERACTIVE_BACKOFF);
    if (metadata.result[".tag"] !== "file") {
      return failVersionResult(versionId, "ERROR", "DROPBOX_FILE_IS_FOLDER", "The linked Dropbox object is a folder, not a file.");
    }
    const fileMeta = metadata.result;
    const resolvedPath = fileMeta.path_display ?? version.excelDropboxPath ?? "";
    try {
      assertInsideRoot(resolvedPath, auth.row.rootFolder);
    } catch {
      return failVersionResult(versionId, "ERROR", "DROPBOX_FILE_OUTSIDE_ROOT", "The linked file is outside the configured Dropbox root.");
    }
    const expectedPrefix = `${businessFolderPath}/${QUOTATION_SUBFOLDER_NAME}/`;
    if (!resolvedPath.startsWith(expectedPrefix) || resolvedPath.slice(expectedPrefix.length).includes("/")) {
      return failVersionResult(versionId, "CONFLICT", "QUOTATION_VERSION_CONFLICT", "The linked file is not directly inside the expected Quotation folder.");
    }
    if (!fileMeta.name.toLowerCase().startsWith(version.baseFileName.toLowerCase())) {
      return failVersionResult(versionId, "CONFLICT", "QUOTATION_VERSION_CONFLICT", "The linked filename no longer matches the expected version name.");
    }

    await prisma.quotationDropboxVersion.update({
      where: { id: versionId },
      data: {
        excelDropboxRevision: fileMeta.rev,
        excelDropboxPath: resolvedPath,
        excelSyncStatus: "SYNCED",
        lastSyncedAt: new Date(),
      },
    });
    return { success: true, status: "SYNCED" };
  } catch (err) {
    if (isNotFoundError(err)) {
      return failVersionResult(versionId, "ERROR", "DROPBOX_FILE_NOT_FOUND", "The linked Dropbox file could not be found. Re-upload to restore it.");
    }
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return failVersionResult(versionId, mapped.code === "QUOTATION_VERSION_CONFLICT" ? "CONFLICT" : "ERROR", mapped.code, mapped.message);
  }
}

// --- Backfill (Part 11) -----------------------------------------------

export type QuotationBackfillPreview = {
  // Counts QuotationCase rows (Correction 1: the business file is per-case,
  // not per-revision) — the correct denominator for "how many business
  // files should eventually exist."
  totalQuotations: number;
  businessFilesInitialized: number;
  syncedVersions: number;
  pendingVersions: number;
  failedVersions: number;
  conflictVersions: number;
  missingLocalFiles: number;
  // Part 12 — optional ADMIN review: how many Customers already have an
  // explicit Short Name vs. would currently resolve to a derived fallback.
  // Never written anywhere; purely informational.
  customerShortNameStats: CustomerShortNameReviewStats;
};

// Pure DB reads only — never touches Dropbox or the filesystem (Part 11,
// requirement 2). "Missing local files" is approximated by versions that
// were never even attempted to be saved locally (excelLocalStorageKey
// null) rather than a real per-file disk existence check, which would
// mean unbounded filesystem I/O during a read-only preview.
export async function previewQuotationBackfill(): Promise<QuotationBackfillPreview> {
  const [totalQuotations, businessFilesInitialized, versionStatusCounts, missingLocalFiles, customers] = await Promise.all([
    prisma.quotationCase.count(),
    prisma.quotationDropboxBusinessFile.count(),
    prisma.quotationDropboxVersion.groupBy({ by: ["excelSyncStatus"], _count: { _all: true } }),
    prisma.quotationDropboxVersion.count({ where: { excelLocalStorageKey: null } }),
    prisma.customer.findMany({ select: { shortName: true, companyName: true } }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of versionStatusCounts) byStatus[row.excelSyncStatus] = row._count._all;

  return {
    totalQuotations,
    businessFilesInitialized,
    syncedVersions: byStatus.SYNCED ?? 0,
    pendingVersions: (byStatus.PENDING ?? 0) + (byStatus.SYNCING ?? 0),
    failedVersions: byStatus.ERROR ?? 0,
    conflictVersions: byStatus.CONFLICT ?? 0,
    missingLocalFiles,
    customerShortNameStats: classifyCustomerShortNames(customers),
  };
}

export type QuotationBackfillMode = "init-missing" | "sync-missing" | "retry-failed" | "verify-synced";
export type QuotationBackfillBatchResult = {
  processed: number;
  succeeded: number;
  failed: number;
  results: { quotationId: string; success: boolean; status: string; code?: DropboxErrorCode }[];
};

// Default lands in the 10-20 range Part 11 asks for; ceiling caps any
// caller-requested limit there too (floor 1, same convention as Phase 3).
const DEFAULT_QUOTATION_BACKFILL_BATCH_SIZE = 15;
const MAX_QUOTATION_BACKFILL_BATCH_SIZE = 20;
const MIN_QUOTATION_BACKFILL_BATCH_SIZE = 1;

// Every mode except "verify-synced" reuses generateAndSyncQuotationExcel
// directly — it already does exactly what backfill needs: fetch the
// source revision's CURRENT DB state, generate Excel from it, reuse the
// existing version if the content fingerprint is unchanged (never
// inventing a new version, satisfying Part 11 requirement 9) or create V1
// if none exists yet, then attempt sync only if not already SYNCED. This
// makes init-missing/sync-missing/retry-failed behaviorally identical at
// the per-case level — they only differ in which cases are selected.
//
// Correction 1: candidates are selected at the QuotationCase level (one
// business file per case), then resolved down to the specific revision
// (sourceQuotationId) whose current content should be (re)generated — the
// case's currentRevisionId when set, otherwise its most recent revision.
export async function runQuotationBackfillBatch(
  mode: QuotationBackfillMode,
  limit: number = DEFAULT_QUOTATION_BACKFILL_BATCH_SIZE
): Promise<QuotationBackfillBatchResult> {
  const boundedLimit = Math.max(MIN_QUOTATION_BACKFILL_BATCH_SIZE, Math.min(limit, MAX_QUOTATION_BACKFILL_BATCH_SIZE));
  const candidates = await selectQuotationBackfillCandidates(mode, boundedLimit);

  const results: QuotationBackfillBatchResult["results"] = [];
  for (const candidate of candidates) {
    if (mode === "verify-synced") {
      const businessFile = await prisma.quotationDropboxBusinessFile.findUnique({ where: { quotationCaseId: candidate.quotationCaseId } });
      const latest = businessFile
        ? await prisma.quotationDropboxVersion.findFirst({ where: { businessFileId: businessFile.id }, orderBy: { versionNumber: "desc" } })
        : null;
      const outcome = latest ? await verifyQuotationVersion(latest.id) : { success: false, status: "PENDING" as const };
      results.push({ quotationId: candidate.sourceQuotationId, success: outcome.success, status: outcome.status, code: "code" in outcome ? outcome.code : undefined });
      continue;
    }

    const generated = await generateAndSyncQuotationExcel(candidate.sourceQuotationId);
    if (generated.success) {
      results.push({ quotationId: candidate.sourceQuotationId, success: generated.dropboxStatus === "SYNCED", status: generated.dropboxStatus });
    } else {
      results.push({
        quotationId: candidate.sourceQuotationId,
        success: false,
        status: "ERROR",
        code: generated.error,
      });
    }
  }

  return {
    processed: results.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

// Resolves the one revision whose current content represents "the
// business's current state" for a case — the explicitly current revision
// when the case has one, otherwise its latest-numbered revision. Never
// invents a revision: a case with no revisions at all yields null and is
// simply skipped by the caller.
export async function resolveSourceQuotationId(quotationCase: { id: string; currentRevisionId: string | null }): Promise<string | null> {
  if (quotationCase.currentRevisionId) return quotationCase.currentRevisionId;
  const latestRevision = await prisma.quotation.findFirst({
    where: { quotationCaseId: quotationCase.id },
    orderBy: { revisionNumber: "desc" },
    select: { id: true },
  });
  return latestRevision?.id ?? null;
}

async function selectQuotationBackfillCandidates(
  mode: QuotationBackfillMode,
  limit: number
): Promise<{ quotationCaseId: string; sourceQuotationId: string }[]> {
  let cases: { id: string; currentRevisionId: string | null }[];
  if (mode === "init-missing") {
    cases = await prisma.quotationCase.findMany({
      where: { dropboxBusinessFile: null, revisions: { some: {} } },
      select: { id: true, currentRevisionId: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  } else if (mode === "sync-missing") {
    cases = await prisma.quotationCase.findMany({
      where: {
        OR: [
          { dropboxBusinessFile: { syncStatus: { in: ["PENDING", "SYNCING"] } } },
          { dropboxBusinessFile: { versions: { some: { excelSyncStatus: { in: ["PENDING", "SYNCING"] } } } } },
        ],
      },
      select: { id: true, currentRevisionId: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  } else if (mode === "retry-failed") {
    cases = await prisma.quotationCase.findMany({
      where: {
        OR: [
          { dropboxBusinessFile: { syncStatus: { in: ["ERROR", "CONFLICT"] } } },
          { dropboxBusinessFile: { versions: { some: { excelSyncStatus: { in: ["ERROR", "CONFLICT"] } } } } },
        ],
      },
      select: { id: true, currentRevisionId: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  } else {
    // verify-synced
    cases = await prisma.quotationCase.findMany({
      where: { dropboxBusinessFile: { versions: { some: { excelSyncStatus: "SYNCED" } } } },
      select: { id: true, currentRevisionId: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }

  const candidates: { quotationCaseId: string; sourceQuotationId: string }[] = [];
  for (const quotationCase of cases) {
    const sourceQuotationId = await resolveSourceQuotationId(quotationCase);
    if (sourceQuotationId) candidates.push({ quotationCaseId: quotationCase.id, sourceQuotationId });
  }
  return candidates;
}
