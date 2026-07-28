// Server-only. The single place that reads/writes the DropboxIntegration
// singleton row and orchestrates Dropbox SDK calls — routes and server
// actions call into this module, never the SDK directly.
import type { Dropbox } from "dropbox";
import { prisma } from "@/lib/prisma";
import { DROPBOX_INTEGRATION_ID, getDropboxEnv, type DropboxEnvConfig } from "./constants";
import { encryptToken, decryptToken, DropboxTokenDecryptionError } from "./encryption";
import { exchangeCodeForToken } from "./auth";
import { createDropboxClient } from "./client";
import { normalizeRootFolder, assertInsideRoot } from "./paths";
import { DropboxIntegrationError, mapDropboxError, type DropboxErrorCode } from "./errors";
import type { DropboxIntegrationModel } from "@/generated/prisma/models";
import type { DropboxIntegrationView } from "./types";

export async function getDropboxIntegrationRow(): Promise<DropboxIntegrationModel> {
  return prisma.dropboxIntegration.upsert({
    where: { id: DROPBOX_INTEGRATION_ID },
    update: {},
    create: { id: DROPBOX_INTEGRATION_ID },
  });
}

export function toIntegrationView(
  row: DropboxIntegrationModel,
  connectedByName: string | null,
  configurationMissing: boolean
): DropboxIntegrationView {
  return {
    status: configurationMissing ? "ERROR" : row.status,
    dropboxAccountId: row.dropboxAccountId,
    accountEmail: row.accountEmail,
    accountDisplayName: row.accountDisplayName,
    rootFolder: row.rootFolder,
    rootFolderVerifiedAt: row.rootFolderVerifiedAt?.toISOString() ?? null,
    connectedAt: row.connectedAt?.toISOString() ?? null,
    disconnectedAt: row.disconnectedAt?.toISOString() ?? null,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastSuccessfulAt: row.lastSuccessfulAt?.toISOString() ?? null,
    lastErrorCode: configurationMissing ? "CONFIGURATION_MISSING" : row.lastErrorCode,
    lastErrorMessage: configurationMissing ? "Dropbox environment variables are not configured." : row.lastErrorMessage,
    connectedByName,
    configurationMissing,
  };
}

function decryptStoredRefreshToken(row: DropboxIntegrationModel, env: DropboxEnvConfig): string {
  if (!row.encryptedRefreshToken) {
    throw new DropboxIntegrationError("REFRESH_TOKEN_MISSING", "No Dropbox connection is stored.");
  }
  try {
    return decryptToken(row.encryptedRefreshToken, env.tokenEncryptionKey);
  } catch (err) {
    if (err instanceof DropboxTokenDecryptionError) {
      // Never silently overwrite an unreadable token — surface a safe,
      // recoverable error and leave the stored row exactly as-is so an
      // admin can Reconnect deliberately.
      throw new DropboxIntegrationError("TOKEN_REVOKED", "The stored Dropbox connection could not be read. Please reconnect.");
    }
    throw err;
  }
}

export type GetAuthenticatedClientResult =
  | { ok: true; client: Dropbox; env: DropboxEnvConfig; row: DropboxIntegrationModel }
  | { ok: false; code: DropboxErrorCode; message: string; row: DropboxIntegrationModel | null };

// Shared "decrypt stored refresh token -> build an authenticated Dropbox
// client" sequence — previously inlined separately in testDropboxConnection/
// disconnectDropbox/saveDropboxRootFolder below (and now also used by
// Phase 2's customer-folders.ts). `row` is returned even on failure (when
// available) so callers that need to record a safe error on the stored row
// don't have to re-fetch it.
export async function getAuthenticatedDropboxClient(): Promise<GetAuthenticatedClientResult> {
  const envResult = getDropboxEnv();
  if (!envResult.ok) {
    return { ok: false, code: "CONFIGURATION_MISSING", message: "Dropbox is not configured.", row: null };
  }

  const row = await getDropboxIntegrationRow();
  try {
    const refreshToken = decryptStoredRefreshToken(row, envResult.config);
    const client = createDropboxClient(envResult.config, refreshToken);
    return { ok: true, client, env: envResult.config, row };
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return { ok: false, code: mapped.code, message: mapped.message, row };
  }
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

export type RootFolderVerification = { path: string; folderId: string | null };

// Part 10: check-then-create, never destructive. A path that already
// exists as a file fails safely (ROOT_PATH_IS_FILE) rather than being
// overwritten or reused.
export async function verifyOrCreateRootFolder(client: Dropbox, rootFolder: string): Promise<RootFolderVerification> {
  const normalized = normalizeRootFolder(rootFolder);

  try {
    const metadata = await client.filesGetMetadata({ path: normalized });
    if (metadata.result[".tag"] === "folder") {
      return { path: normalized, folderId: metadata.result.id ?? null };
    }
    if (metadata.result[".tag"] === "file") {
      throw new DropboxIntegrationError(
        "ROOT_PATH_IS_FILE",
        "A file already exists at the configured root folder path."
      );
    }
    // "deleted" tag — treat like not-found and fall through to create.
  } catch (err) {
    if (err instanceof DropboxIntegrationError) throw err;
    if (!isNotFoundError(err)) throw mapDropboxError(err);
  }

  try {
    const created = await client.filesCreateFolderV2({ path: normalized, autorename: false });
    return { path: normalized, folderId: created.result.metadata.id ?? null };
  } catch {
    throw new DropboxIntegrationError("ROOT_FOLDER_CREATE_FAILED", "Failed to create the Dropbox root folder.");
  }
}

export type CompleteConnectionInput = { code: string; adminUserId: string };

// The callback route's core logic. Never mutates the stored row until
// every verification step (token exchange -> account info -> root folder)
// has succeeded — a failed attempt leaves any previously-valid connection
// completely untouched.
export async function completeOAuthConnection(input: CompleteConnectionInput): Promise<DropboxIntegrationModel> {
  const envResult = getDropboxEnv();
  if (!envResult.ok) throw new DropboxIntegrationError("CONFIGURATION_MISSING", "Dropbox is not configured.");
  const env = envResult.config;

  const exchanged = await exchangeCodeForToken(env, input.code);

  const client = createDropboxClient(env, exchanged.refreshToken);

  let account;
  try {
    const response = await client.usersGetCurrentAccount();
    account = response.result;
  } catch (err) {
    throw mapDropboxError(err);
  }

  const existing = await getDropboxIntegrationRow();
  const rootFolderToVerify = existing.rootFolder;
  const verification = await verifyOrCreateRootFolder(client, rootFolderToVerify);

  const encryptedRefreshToken = encryptToken(exchanged.refreshToken, env.tokenEncryptionKey);
  const now = new Date();

  return prisma.dropboxIntegration.update({
    where: { id: DROPBOX_INTEGRATION_ID },
    data: {
      status: "CONNECTED",
      encryptedRefreshToken,
      dropboxAccountId: account.account_id,
      accountEmail: account.email ?? null,
      accountDisplayName: account.name?.display_name ?? null,
      rootFolder: verification.path,
      rootFolderVerifiedAt: now,
      connectedAt: now,
      disconnectedAt: null,
      lastTestedAt: now,
      lastSuccessfulAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
      connectedById: input.adminUserId,
    },
  });
}

// Records a safe error on the stored row WITHOUT touching any existing
// valid encryptedRefreshToken/account fields — used when an OAuth attempt
// or reconnect fails after a previous connection existed.
export async function recordDropboxError(code: string, message: string): Promise<void> {
  const existing = await getDropboxIntegrationRow();
  await prisma.dropboxIntegration.update({
    where: { id: DROPBOX_INTEGRATION_ID },
    data: {
      // Only flip to ERROR if there's no previously-connected account to
      // preserve the display of — otherwise keep showing CONNECTED with a
      // stale-but-valid token, and let the next Test Connection / Reconnect
      // surface the problem.
      status: existing.dropboxAccountId ? existing.status : "ERROR",
      lastErrorCode: code,
      lastErrorMessage: message,
    },
  });
}

export type TestConnectionResult = { success: true } | { success: false; code: DropboxErrorCode };

// Part 12. Never creates folders other than verifying the existing root —
// a missing root folder during a test is reported as an error, not
// silently recreated (recreating is only appropriate right after a fresh
// OAuth connection, in completeOAuthConnection above).
export async function testDropboxConnection(): Promise<TestConnectionResult> {
  const auth = await getAuthenticatedDropboxClient();
  if (!auth.ok) {
    if (auth.row) {
      await prisma.dropboxIntegration.update({
        where: { id: DROPBOX_INTEGRATION_ID },
        data: {
          status: auth.code === "TOKEN_REVOKED" || auth.code === "REFRESH_TOKEN_MISSING" ? "ERROR" : auth.row.status,
          lastTestedAt: new Date(),
          lastErrorCode: auth.code,
          lastErrorMessage: auth.message,
        },
      });
    }
    return { success: false, code: auth.code };
  }
  const { client, row } = auth;

  try {
    const accountResponse = await client.usersGetCurrentAccount();
    const account = accountResponse.result;

    const normalizedRoot = normalizeRootFolder(row.rootFolder);
    const metadata = await client.filesGetMetadata({ path: normalizedRoot });
    if (metadata.result[".tag"] !== "folder") {
      throw new DropboxIntegrationError("ROOT_FOLDER_NOT_FOUND", "The configured root folder no longer exists.");
    }
    assertInsideRoot(normalizedRoot, normalizedRoot);

    const now = new Date();
    await prisma.dropboxIntegration.update({
      where: { id: DROPBOX_INTEGRATION_ID },
      data: {
        status: "CONNECTED",
        accountEmail: account.email ?? row.accountEmail,
        accountDisplayName: account.name?.display_name ?? row.accountDisplayName,
        rootFolderVerifiedAt: now,
        lastTestedAt: now,
        lastSuccessfulAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    return { success: true };
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    await prisma.dropboxIntegration.update({
      where: { id: DROPBOX_INTEGRATION_ID },
      data: {
        status: mapped.code === "TOKEN_REVOKED" || mapped.code === "REFRESH_TOKEN_MISSING" ? "ERROR" : row.status,
        lastTestedAt: new Date(),
        lastErrorCode: mapped.code,
        lastErrorMessage: mapped.message,
      },
    });
    return { success: false, code: mapped.code };
  }
}

export type DisconnectResult = { success: true; warning?: string };

// Part 14. Best-effort revoke, then always clears the local connection
// regardless of whether revoke succeeded — an already-invalid token must
// still allow a local disconnect.
export async function disconnectDropbox(): Promise<DisconnectResult> {
  let warning: string | undefined;
  const auth = await getAuthenticatedDropboxClient();
  if (auth.ok) {
    try {
      await auth.client.authTokenRevoke();
    } catch {
      warning = "Dropbox token revocation could not be confirmed; the local connection was cleared regardless.";
    }
  } else if (auth.row?.encryptedRefreshToken) {
    // A stored token existed but couldn't be turned into a working client
    // (missing config / unreadable token) — still non-fatal, same warning.
    warning = "Dropbox token revocation could not be confirmed; the local connection was cleared regardless.";
  }

  await prisma.dropboxIntegration.update({
    where: { id: DROPBOX_INTEGRATION_ID },
    data: {
      status: "DISCONNECTED",
      encryptedRefreshToken: null,
      dropboxAccountId: null,
      accountEmail: null,
      accountDisplayName: null,
      rootFolderVerifiedAt: null,
      disconnectedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
      // rootFolder is intentionally preserved — see Part 14's requirement.
    },
  });

  return { success: true, warning };
}

export type SaveRootFolderResult = { success: true; path: string } | { success: false; code: DropboxErrorCode };

// Part 11's "Save/Verify Root Folder" action. If currently connected, the
// new path is created-or-verified on Dropbox before being persisted, so
// the stored value is never ahead of what's actually confirmed to exist.
export async function saveDropboxRootFolder(newRootFolder: string): Promise<SaveRootFolderResult> {
  let normalized: string;
  try {
    normalized = normalizeRootFolder(newRootFolder);
  } catch (err) {
    const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
    return { success: false, code: mapped.code };
  }

  const row = await getDropboxIntegrationRow();

  if (row.status === "CONNECTED" && row.encryptedRefreshToken) {
    const auth = await getAuthenticatedDropboxClient();
    if (!auth.ok) return { success: false, code: auth.code };
    try {
      const verification = await verifyOrCreateRootFolder(auth.client, normalized);
      await prisma.dropboxIntegration.update({
        where: { id: DROPBOX_INTEGRATION_ID },
        data: { rootFolder: verification.path, rootFolderVerifiedAt: new Date() },
      });
      return { success: true, path: verification.path };
    } catch (err) {
      const mapped = err instanceof DropboxIntegrationError ? err : mapDropboxError(err);
      return { success: false, code: mapped.code };
    }
  }

  await prisma.dropboxIntegration.update({
    where: { id: DROPBOX_INTEGRATION_ID },
    data: { rootFolder: normalized, rootFolderVerifiedAt: null },
  });
  return { success: true, path: normalized };
}
