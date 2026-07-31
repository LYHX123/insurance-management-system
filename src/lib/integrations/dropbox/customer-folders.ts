// Server-only. Dropbox Integration Phase 2 — automatic Customer folder
// filing. Built entirely on Phase 1's authenticated-client helper and
// root-safe path helpers (getAuthenticatedDropboxClient / joinDropboxPath /
// assertInsideRoot / mapDropboxError) — never accepts a raw path from the
// browser, and every folder lookup uses the one deterministic path a
// customer owns (see buildCustomerFolderName), never a fuzzy name search.
import type { Dropbox } from "dropbox";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedDropboxClient } from "./service";
import { joinDropboxPath, assertInsideRoot } from "./paths";
import { DropboxIntegrationError, mapDropboxError, type DropboxErrorCode } from "./errors";
import { buildCustomerFolderName } from "./customer-folder-names";
import { withRateLimitBackoff, INTERACTIVE_BACKOFF } from "./rateLimitRetry";
import type { CustomerDropboxFolderModel } from "@/generated/prisma/models";

// Insurance-type folders (Motor/Non Motor/Bond/Work Permit) are deliberately
// NOT created here — they're created lazily in the Quotation/Policy phases
// only once corresponding business exists for that customer. Existing
// insurance-type folders from before this change are left untouched: they
// are simply outside this list, so sync/verify/rebuild never look for them,
// never flag them missing, and never touch them.
export const STANDARD_CUSTOMER_SUBFOLDERS = ["Customer Documents", "General Documents"] as const;

// A row stuck in SYNCING past this age is treated as abandoned (e.g. a
// crashed process) rather than genuinely in-progress — Part 16, requirement
// 5: never leave a Customer permanently stuck in SYNCING.
const STALE_SYNCING_THRESHOLD_MS = 2 * 60 * 1000;

type CustomerIdentity = { id: string; customerNumber: string; companyName: string };

export type SyncOutcomeStatus = "SYNCED" | "PENDING" | "SYNCING" | "ERROR" | "CONFLICT";
export type FolderOpResult = {
  success: boolean;
  status: SyncOutcomeStatus;
  code?: DropboxErrorCode;
  message?: string;
  path?: string;
  missingSubfolders?: string[];
};

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

async function tryGetFolderMetadata(
  client: Dropbox,
  path: string,
  isFileCode: DropboxErrorCode
): Promise<{ id: string | null; displayPath: string } | null> {
  try {
    // Phase 8 Part 8: bounded backoff on Dropbox rate-limit (429) responses
    // — Stage D's migration copy phase showed this app gets rate-limited
    // more than expected; the same retry applies here, idempotently (a
    // retried GET has no side effect to duplicate).
    const metadata = await withRateLimitBackoff(() => client.filesGetMetadata({ path }));
    if (metadata.result[".tag"] === "folder") {
      return { id: metadata.result.id ?? null, displayPath: metadata.result.path_display ?? path };
    }
    if (metadata.result[".tag"] === "file") {
      throw new DropboxIntegrationError(isFileCode, "A file already exists at the required folder path.");
    }
    return null; // "deleted" tag — treat like not-found
  } catch (err) {
    if (err instanceof DropboxIntegrationError) throw err;
    if (isNotFoundError(err)) return null;
    throw mapDropboxError(err);
  }
}

// Check-then-create, mirroring service.ts's verifyOrCreateRootFolder. On a
// create failure, re-checks once before reporting a hard error — a
// concurrent sync may have created the exact same folder in the race
// window between our check and our create call (Part 16: concurrent syncs
// must not duplicate folders or error out on an "already exists" outcome).
async function ensureFolder(
  client: Dropbox,
  path: string,
  errorCodes: { isFile: DropboxErrorCode; createFailed: DropboxErrorCode }
): Promise<{ id: string | null; displayPath: string }> {
  const existing = await tryGetFolderMetadata(client, path, errorCodes.isFile);
  if (existing) return existing;

  try {
    const created = await withRateLimitBackoff(() => client.filesCreateFolderV2({ path, autorename: false }));
    return { id: created.result.metadata.id ?? null, displayPath: created.result.metadata.path_display ?? path };
  } catch (err) {
    if (err instanceof DropboxIntegrationError) throw err;
    const recheck = await tryGetFolderMetadata(client, path, errorCodes.isFile).catch(() => null);
    if (recheck) return recheck;
    throw new DropboxIntegrationError(errorCodes.createFailed, "Failed to create the required folder.");
  }
}

export async function ensureCustomersFolder(client: Dropbox, root: string): Promise<string> {
  const path = joinDropboxPath(root, "Customers");
  const result = await ensureFolder(client, path, {
    isFile: "CUSTOMER_FOLDER_CONFLICT",
    createFailed: "CUSTOMER_FOLDER_CREATE_FAILED",
  });
  return result.displayPath;
}

export async function ensureCustomerFolder(
  client: Dropbox,
  root: string,
  folderName: string
): Promise<{ path: string; folderId: string | null }> {
  const customersPath = await ensureCustomersFolder(client, root);
  const path = joinDropboxPath(customersPath, folderName);
  const result = await ensureFolder(client, path, {
    isFile: "CUSTOMER_FOLDER_IS_FILE",
    createFailed: "CUSTOMER_FOLDER_CREATE_FAILED",
  });
  return { path: result.displayPath, folderId: result.id };
}

// Only creates whatever's missing — a no-op if everything already exists,
// safe to call repeatedly (Part 4/Part 9 REBUILD requirement).
export async function ensureStandardSubfolders(client: Dropbox, customerFolderPath: string): Promise<void> {
  for (const name of STANDARD_CUSTOMER_SUBFOLDERS) {
    const path = joinDropboxPath(customerFolderPath, name);
    await ensureFolder(client, path, { isFile: "STANDARD_FOLDER_CONFLICT", createFailed: "STANDARD_FOLDER_CONFLICT" });
  }
}

async function loadCustomerIdentity(customerId: string): Promise<CustomerIdentity | null> {
  return prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, customerNumber: true, companyName: true },
  });
}

function classifySyncStatus(code: DropboxErrorCode): "ERROR" | "CONFLICT" {
  return code === "CUSTOMER_FOLDER_IS_FILE" || code === "CUSTOMER_FOLDER_CONFLICT" || code === "STANDARD_FOLDER_CONFLICT"
    ? "CONFLICT"
    : "ERROR";
}

// Main entry point: create/reuse the customer folder + standard
// subfolders, and record the outcome on CustomerDropboxFolder. Never
// throws — always returns a normalized result (Part 15, requirement 4).
export async function syncCustomerFolder(customerId: string): Promise<FolderOpResult> {
  const customer = await loadCustomerIdentity(customerId);
  if (!customer) {
    return { success: false, status: "ERROR", code: "CUSTOMER_NOT_FOUND", message: "Customer not found." };
  }
  const folderName = buildCustomerFolderName(customer);

  const existing = await prisma.customerDropboxFolder.findUnique({ where: { customerId } });
  if (existing?.syncStatus === "SYNCING" && existing.lastSyncAttemptAt) {
    const age = Date.now() - existing.lastSyncAttemptAt.getTime();
    if (age < STALE_SYNCING_THRESHOLD_MS) {
      return { success: false, status: "SYNCING", message: "A synchronization is already in progress." };
    }
  }

  await prisma.customerDropboxFolder.upsert({
    where: { customerId },
    create: { customerId, folderName, syncStatus: "SYNCING", lastSyncAttemptAt: new Date() },
    update: { folderName, syncStatus: "SYNCING", lastSyncAttemptAt: new Date() },
  });

  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) {
    await prisma.customerDropboxFolder.update({
      where: { customerId },
      data: { syncStatus: "ERROR", lastErrorCode: auth.code, lastErrorMessage: auth.message, lastSyncAttemptAt: new Date() },
    });
    return { success: false, status: "ERROR", code: auth.code, message: auth.message };
  }

  try {
    const { path: customerPath, folderId } = await ensureCustomerFolder(auth.client, auth.row.rootFolder, folderName);
    await ensureStandardSubfolders(auth.client, customerPath);

    const now = new Date();
    await prisma.customerDropboxFolder.update({
      where: { customerId },
      data: {
        dropboxFolderId: folderId,
        displayPath: customerPath,
        pathLower: customerPath.toLowerCase(),
        syncStatus: "SYNCED",
        lastSyncedAt: now,
        lastSyncAttemptAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    console.info(`[dropbox-customer-sync] customer=${customerId} status=SYNCED path="${customerPath}"`);
    return { success: true, status: "SYNCED", path: customerPath };
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    const status = classifySyncStatus(mapped.code);
    await prisma.customerDropboxFolder.update({
      where: { customerId },
      data: { syncStatus: status, lastErrorCode: mapped.code, lastErrorMessage: mapped.message, lastSyncAttemptAt: new Date() },
    });
    console.info(`[dropbox-customer-sync] customer=${customerId} status=${status} code=${mapped.code}`);
    return { success: false, status, code: mapped.code, message: mapped.message };
  }
}

// Read-only: confirms the stored folder still resolves, is a folder, is
// inside the configured root, and every standard subfolder exists. Never
// creates/renames/moves anything (Part 9 VERIFY requirement).
export async function verifyCustomerFolder(customerId: string): Promise<FolderOpResult> {
  const row = await prisma.customerDropboxFolder.findUnique({ where: { customerId } });
  if (!row || !row.dropboxFolderId) {
    return { success: false, status: "PENDING", message: "Customer folder has not been synchronized yet." };
  }

  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) {
    return { success: false, status: "ERROR", code: auth.code, message: auth.message };
  }

  try {
    // Phase 8 Part 8: bounded backoff on Dropbox rate-limit (429) responses.
    const metadata = await withRateLimitBackoff(() => auth.client.filesGetMetadata({ path: row.dropboxFolderId! }), INTERACTIVE_BACKOFF);
    if (metadata.result[".tag"] !== "folder") {
      throw new DropboxIntegrationError("CUSTOMER_FOLDER_NOT_FOUND", "The customer folder no longer exists or is not a folder.");
    }
    const resolvedPath = metadata.result.path_display ?? row.displayPath ?? "";
    try {
      assertInsideRoot(resolvedPath, auth.row.rootFolder);
    } catch {
      throw new DropboxIntegrationError("CUSTOMER_FOLDER_OUTSIDE_ROOT", "The customer folder is outside the configured Dropbox root.");
    }

    const missing: string[] = [];
    for (const name of STANDARD_CUSTOMER_SUBFOLDERS) {
      const subfolder = await tryGetFolderMetadata(auth.client, joinDropboxPath(resolvedPath, name), "STANDARD_FOLDER_CONFLICT").catch(
        (err) => {
          if (err instanceof DropboxIntegrationError && err.code === "STANDARD_FOLDER_CONFLICT") return null;
          throw err;
        }
      );
      if (!subfolder) missing.push(name);
    }

    const now = new Date();
    if (missing.length === 0) {
      await prisma.customerDropboxFolder.update({
        where: { customerId },
        data: {
          displayPath: resolvedPath,
          pathLower: resolvedPath.toLowerCase(),
          syncStatus: "SYNCED",
          lastSyncedAt: now,
          lastSyncAttemptAt: now,
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      return { success: true, status: "SYNCED", path: resolvedPath };
    }

    const message = `Missing standard subfolders: ${missing.join(", ")}.`;
    await prisma.customerDropboxFolder.update({
      where: { customerId },
      data: { lastSyncAttemptAt: now, syncStatus: "ERROR", lastErrorCode: "CUSTOMER_FOLDER_NOT_FOUND", lastErrorMessage: message },
    });
    return { success: false, status: "ERROR", code: "CUSTOMER_FOLDER_NOT_FOUND", message, missingSubfolders: missing };
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    const status = classifySyncStatus(mapped.code);
    await prisma.customerDropboxFolder.update({
      where: { customerId },
      data: { syncStatus: status, lastErrorCode: mapped.code, lastErrorMessage: mapped.message, lastSyncAttemptAt: new Date() },
    });
    return { success: false, status, code: mapped.code, message: mapped.message };
  }
}

// Renames/moves the customer's folder by its stored dropboxFolderId (never
// by the old path string) to match the customer's current
// customerNumber+companyName. A no-op if the computed name hasn't actually
// changed. Dropbox's own autorename:false guarantees a name collision at
// the destination is refused, never silently overwritten (Part 10,
// requirement 8).
export async function renameCustomerFolder(customerId: string): Promise<FolderOpResult> {
  const customer = await loadCustomerIdentity(customerId);
  if (!customer) {
    return { success: false, status: "ERROR", code: "CUSTOMER_NOT_FOUND", message: "Customer not found." };
  }
  const newFolderName = buildCustomerFolderName(customer);

  const row = await prisma.customerDropboxFolder.findUnique({ where: { customerId } });
  if (!row || !row.dropboxFolderId) {
    // Nothing synced yet — just record the up-to-date expected name for
    // whenever the first sync happens; no Dropbox call needed.
    await prisma.customerDropboxFolder.upsert({
      where: { customerId },
      create: { customerId, folderName: newFolderName, syncStatus: "PENDING" },
      update: { folderName: newFolderName },
    });
    return { success: true, status: "PENDING" };
  }

  if (newFolderName === row.folderName) {
    return { success: true, status: row.syncStatus as SyncOutcomeStatus, path: row.displayPath ?? undefined };
  }

  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) {
    await prisma.customerDropboxFolder.update({
      where: { customerId },
      data: { folderName: newFolderName, syncStatus: "ERROR", lastErrorCode: auth.code, lastErrorMessage: auth.message, lastSyncAttemptAt: new Date() },
    });
    return { success: false, status: "ERROR", code: auth.code, message: auth.message };
  }

  try {
    const customersPath = await ensureCustomersFolder(auth.client, auth.row.rootFolder);
    const newPath = joinDropboxPath(customersPath, newFolderName);
    // Phase 8 Part 8: bounded backoff on Dropbox rate-limit (429) responses.
    const moved = await withRateLimitBackoff(
      () => auth.client.filesMoveV2({ from_path: row.dropboxFolderId!, to_path: newPath, autorename: false }),
      INTERACTIVE_BACKOFF
    );
    const movedMetadata = moved.result.metadata;
    // A successful folder move always yields folder metadata in practice;
    // the SDK's union type also allows "deleted" for other Relocation use
    // cases, so this falls back to the pre-move values rather than assuming.
    const resolvedId = movedMetadata[".tag"] !== "deleted" ? movedMetadata.id ?? row.dropboxFolderId : row.dropboxFolderId;
    const resolvedPath = movedMetadata[".tag"] !== "deleted" ? movedMetadata.path_display ?? newPath : newPath;

    const now = new Date();
    await prisma.customerDropboxFolder.update({
      where: { customerId },
      data: {
        folderName: newFolderName,
        dropboxFolderId: resolvedId,
        displayPath: resolvedPath,
        pathLower: resolvedPath.toLowerCase(),
        syncStatus: "SYNCED",
        lastSyncedAt: now,
        lastSyncAttemptAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    console.info(`[dropbox-customer-sync] customer=${customerId} renamed path="${resolvedPath}"`);
    return { success: true, status: "SYNCED", path: resolvedPath };
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    const code = mapped.code === "UNKNOWN_ERROR" || mapped.code === "NOT_FOUND" ? "CUSTOMER_FOLDER_RENAME_FAILED" : mapped.code;
    await prisma.customerDropboxFolder.update({
      where: { customerId },
      data: { folderName: newFolderName, syncStatus: "ERROR", lastErrorCode: code, lastErrorMessage: mapped.message, lastSyncAttemptAt: new Date() },
    });
    return { success: false, status: "ERROR", code, message: mapped.message };
  }
}

// Creates only whatever standard subfolders are currently missing — never
// touches/renames/deletes existing content, never recreates the customer
// root folder if its stored id still resolves (Part 9 REBUILD requirement).
export async function rebuildCustomerSubfolders(customerId: string): Promise<FolderOpResult> {
  const row = await prisma.customerDropboxFolder.findUnique({ where: { customerId } });
  if (!row || !row.dropboxFolderId) {
    return { success: false, status: "PENDING", message: "Customer folder has not been synchronized yet." };
  }

  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) return { success: false, status: "ERROR", code: auth.code, message: auth.message };

  try {
    // Single admin-triggered "Rebuild" action on one customer — bounded
    // tightly so the click never hangs.
    const metadata = await withRateLimitBackoff(() => auth.client.filesGetMetadata({ path: row.dropboxFolderId! }), INTERACTIVE_BACKOFF);
    if (metadata.result[".tag"] !== "folder") {
      throw new DropboxIntegrationError("CUSTOMER_FOLDER_NOT_FOUND", "The customer folder no longer exists or is not a folder.");
    }
    const resolvedPath = metadata.result.path_display ?? row.displayPath ?? "";
    await ensureStandardSubfolders(auth.client, resolvedPath);

    const now = new Date();
    await prisma.customerDropboxFolder.update({
      where: { customerId },
      data: {
        displayPath: resolvedPath,
        pathLower: resolvedPath.toLowerCase(),
        syncStatus: "SYNCED",
        lastSyncedAt: now,
        lastSyncAttemptAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    return { success: true, status: "SYNCED", path: resolvedPath };
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    const status = classifySyncStatus(mapped.code);
    await prisma.customerDropboxFolder.update({
      where: { customerId },
      data: { syncStatus: status, lastErrorCode: mapped.code, lastErrorMessage: mapped.message, lastSyncAttemptAt: new Date() },
    });
    return { success: false, status, code: mapped.code, message: mapped.message };
  }
}

// --- Backfill (Part 12) -----------------------------------------------

export type BackfillPreview = {
  totalCustomers: number;
  synced: number;
  pending: number;
  error: number;
  notInitialized: number;
};

// Pure DB read — never touches Dropbox (Part 12, requirement 1).
export async function previewCustomerFolderBackfill(): Promise<BackfillPreview> {
  const [totalCustomers, statusCounts] = await Promise.all([
    prisma.customer.count(),
    prisma.customerDropboxFolder.groupBy({ by: ["syncStatus"], _count: { _all: true } }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of statusCounts) byStatus[row.syncStatus] = row._count._all;

  const synced = byStatus.SYNCED ?? 0;
  const error = (byStatus.ERROR ?? 0) + (byStatus.CONFLICT ?? 0);
  const pending = (byStatus.PENDING ?? 0) + (byStatus.SYNCING ?? 0) + (byStatus.DISABLED ?? 0);
  const rowCount = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  const notInitialized = Math.max(0, totalCustomers - rowCount);

  return { totalCustomers, synced, pending, error, notInitialized };
}

export type BackfillMode = "missing" | "retry-failed" | "verify-all";
export type BackfillBatchResult = {
  processed: number;
  succeeded: number;
  failed: number;
  results: { customerId: string; companyName: string; success: boolean; status: SyncOutcomeStatus; code?: DropboxErrorCode }[];
};

const DEFAULT_BACKFILL_BATCH_SIZE = 20;

// Processes up to `limit` customers SEQUENTIALLY (never Promise.all — Part
// 12, requirement 11, and respects Dropbox rate limits). Safe to call again
// for the next batch: it always re-queries whichever customers still match
// the mode's criteria, so it's naturally resumable and never reprocesses
// already-synced customers.
export async function runCustomerFolderBackfillBatch(
  mode: BackfillMode,
  limit: number = DEFAULT_BACKFILL_BATCH_SIZE
): Promise<BackfillBatchResult> {
  const boundedLimit = Math.max(1, Math.min(limit, 50));

  const customers = await selectBackfillCandidates(mode, boundedLimit);

  const results: BackfillBatchResult["results"] = [];
  for (const customer of customers) {
    const outcome =
      mode === "verify-all" ? await verifyCustomerFolder(customer.id) : await syncCustomerFolder(customer.id);
    results.push({
      customerId: customer.id,
      companyName: customer.companyName,
      success: outcome.success,
      status: outcome.status,
      code: outcome.code,
    });
  }

  return {
    processed: results.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

async function selectBackfillCandidates(
  mode: BackfillMode,
  limit: number
): Promise<{ id: string; companyName: string }[]> {
  if (mode === "missing") {
    return prisma.customer.findMany({
      where: { OR: [{ dropboxFolder: null }, { dropboxFolder: { syncStatus: { in: ["PENDING", "SYNCING"] } } }] },
      select: { id: true, companyName: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }
  if (mode === "retry-failed") {
    return prisma.customer.findMany({
      where: { dropboxFolder: { syncStatus: { in: ["ERROR", "CONFLICT"] } } },
      select: { id: true, companyName: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
  }
  // verify-all
  return prisma.customer.findMany({
    where: { dropboxFolder: { syncStatus: "SYNCED" } },
    select: { id: true, companyName: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export type { CustomerDropboxFolderModel };
