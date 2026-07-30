// Server-only. The DropboxNamespaceConfig singleton row: which namespace is
// currently active, the (encrypted) destination namespace id, and the
// migration lock flag. Deliberately independent of
// getAuthenticatedDropboxClient() in ../service.ts (which itself reads this
// module to decide what to build) — migration tooling (diagnostic,
// write-test, copy engine) must keep working while the lock is held, since
// the lock exists to pause *normal* application sync, not the migration
// itself.
import { prisma } from "@/lib/prisma";
import {
  DROPBOX_NAMESPACE_CONFIG_ID,
  DROPBOX_INTEGRATION_ID,
  DEFAULT_DESTINATION_ROOT_FOLDER,
  type DropboxEnvConfig,
} from "../constants";
import { encryptToken, decryptToken, DropboxTokenDecryptionError } from "../encryption";
import { DropboxIntegrationError, mapDropboxError } from "../errors";
import { createSourceClient, createNamespaceClient } from "./namespaceClient";
import type { Dropbox } from "dropbox";
import type { DropboxNamespaceConfigModel } from "@/generated/prisma/models";

export async function getNamespaceConfigRow(): Promise<DropboxNamespaceConfigModel> {
  return prisma.dropboxNamespaceConfig.upsert({
    where: { id: DROPBOX_NAMESPACE_CONFIG_ID },
    update: {},
    create: { id: DROPBOX_NAMESPACE_CONFIG_ID },
  });
}

// Safe, browser-facing view — never the encrypted namespace id field.
export type DropboxMigrationNamespaceView = {
  activeNamespaceMode: "HOME" | "TEAM_FOLDER_NAMESPACE";
  activeRootFolder: string;
  destinationConfigured: boolean;
  destinationNamespaceDisplayName: string | null;
  destinationRootFolder: string;
  destinationResolvedAt: string | null;
  migrationLocked: boolean;
  migrationLockedAt: string | null;
  activatedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

export function toMigrationNamespaceView(row: DropboxNamespaceConfigModel): DropboxMigrationNamespaceView {
  return {
    activeNamespaceMode: row.activeNamespaceMode,
    activeRootFolder: row.activeRootFolder,
    destinationConfigured: !!row.encryptedDestinationNamespaceId,
    destinationNamespaceDisplayName: row.destinationNamespaceDisplayName,
    destinationRootFolder: row.destinationRootFolder,
    destinationResolvedAt: row.destinationResolvedAt?.toISOString() ?? null,
    migrationLocked: row.migrationLocked,
    migrationLockedAt: row.migrationLockedAt?.toISOString() ?? null,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
  };
}

// Independent decrypt-refresh-token helper — reads the DropboxIntegration
// row directly (not via service.ts's getDropboxIntegrationRow()/
// getAuthenticatedDropboxClient()) to avoid a circular module dependency:
// service.ts's getAuthenticatedDropboxClient() itself reads THIS module to
// decide what to build, and migration tooling must keep working while the
// lock is held (the lock pauses normal application sync, not the migration
// itself).
async function getDecryptedRefreshToken(env: DropboxEnvConfig): Promise<string> {
  const row = await prisma.dropboxIntegration.upsert({
    where: { id: DROPBOX_INTEGRATION_ID },
    update: {},
    create: { id: DROPBOX_INTEGRATION_ID },
  });
  if (!row.encryptedRefreshToken) {
    throw new DropboxIntegrationError("REFRESH_TOKEN_MISSING", "No Dropbox connection is stored.");
  }
  try {
    return decryptToken(row.encryptedRefreshToken, env.tokenEncryptionKey);
  } catch (err) {
    if (err instanceof DropboxTokenDecryptionError) {
      throw new DropboxIntegrationError("TOKEN_REVOKED", "The stored Dropbox connection could not be read. Please reconnect.");
    }
    throw err;
  }
}

export async function getMigrationSourceClient(env: DropboxEnvConfig): Promise<{ client: Dropbox; refreshToken: string }> {
  const refreshToken = await getDecryptedRefreshToken(env);
  return { client: createSourceClient(env, refreshToken), refreshToken };
}

// Throws NAMESPACE_NOT_RESOLVED if the destination namespace hasn't been
// discovered yet (run the diagnostic first).
export async function getMigrationDestinationClient(env: DropboxEnvConfig): Promise<Dropbox> {
  const config = await getNamespaceConfigRow();
  if (!config.encryptedDestinationNamespaceId) {
    throw new DropboxIntegrationError("NAMESPACE_NOT_RESOLVED", "The destination Team Folder namespace has not been resolved yet. Run the diagnostic first.");
  }
  const refreshToken = await getDecryptedRefreshToken(env);
  let namespaceId: string;
  try {
    namespaceId = decryptToken(config.encryptedDestinationNamespaceId, env.tokenEncryptionKey);
  } catch (err) {
    if (err instanceof DropboxTokenDecryptionError) {
      throw new DropboxIntegrationError("NAMESPACE_NOT_RESOLVED", "The stored destination namespace could not be read. Re-run the diagnostic.");
    }
    throw err;
  }
  return createNamespaceClient(env, refreshToken, namespaceId);
}

export async function storeResolvedDestinationNamespace(
  env: DropboxEnvConfig,
  namespaceId: string,
  displayName: string
): Promise<void> {
  const encrypted = encryptToken(namespaceId, env.tokenEncryptionKey);
  await prisma.dropboxNamespaceConfig.upsert({
    where: { id: DROPBOX_NAMESPACE_CONFIG_ID },
    update: {
      encryptedDestinationNamespaceId: encrypted,
      destinationNamespaceDisplayName: displayName,
      destinationRootFolder: DEFAULT_DESTINATION_ROOT_FOLDER,
      destinationResolvedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    },
    create: {
      id: DROPBOX_NAMESPACE_CONFIG_ID,
      encryptedDestinationNamespaceId: encrypted,
      destinationNamespaceDisplayName: displayName,
      destinationRootFolder: DEFAULT_DESTINATION_ROOT_FOLDER,
      destinationResolvedAt: new Date(),
    },
  });
}

export async function recordNamespaceConfigError(code: string, message: string): Promise<void> {
  await prisma.dropboxNamespaceConfig.upsert({
    where: { id: DROPBOX_NAMESPACE_CONFIG_ID },
    update: { lastErrorCode: code, lastErrorMessage: message },
    create: { id: DROPBOX_NAMESPACE_CONFIG_ID, lastErrorCode: code, lastErrorMessage: message },
  });
}

// Idempotent by design, not a mutex — this app has one admin-driven
// migration flow at a time, so re-entering the copy phase after a crash
// (Part 6/7's "safe to rerun"/"resume after interruption" requirements)
// must succeed even if the lock was already held from the interrupted run.
export async function acquireMigrationLock(): Promise<void> {
  await getNamespaceConfigRow();
  await prisma.dropboxNamespaceConfig.update({
    where: { id: DROPBOX_NAMESPACE_CONFIG_ID },
    data: { migrationLocked: true, migrationLockedAt: new Date() },
  });
}

export async function releaseMigrationLock(): Promise<void> {
  await prisma.dropboxNamespaceConfig.update({
    where: { id: DROPBOX_NAMESPACE_CONFIG_ID },
    data: { migrationLocked: false },
  });
}

export function mapMigrationError(err: unknown) {
  if (err instanceof DropboxIntegrationError) return err;
  return mapDropboxError(err);
}

export type ActiveClientResult =
  | { ok: true; client: Dropbox; effectiveRootFolder: string }
  | { ok: false; code: "MIGRATION_LOCKED" | "NAMESPACE_NOT_RESOLVED" | "TOKEN_REVOKED" | "UNKNOWN_ERROR"; message: string };

// The single choke point every existing Dropbox sync module passes through
// (via service.ts's getAuthenticatedDropboxClient(), which delegates here
// once the refresh token is already decrypted). Every one of those modules
// reads its Dropbox client and effective root folder ONLY from that
// function's return value — never DropboxIntegration.rootFolder directly —
// so switching what this returns is sufficient to move the whole
// application's Dropbox writes to the destination namespace after
// activation, and to safely pause them during the migration lock, with zero
// changes required in those modules themselves.
export async function getActiveClient(
  env: DropboxEnvConfig,
  refreshToken: string,
  homeRootFolder: string
): Promise<ActiveClientResult> {
  const config = await getNamespaceConfigRow();

  if (config.migrationLocked) {
    return {
      ok: false,
      code: "MIGRATION_LOCKED",
      message: "Dropbox storage migration is in progress. Business data has been saved, and Dropbox synchronization will resume automatically after migration.",
    };
  }

  if (config.activeNamespaceMode === "HOME") {
    return { ok: true, client: createSourceClient(env, refreshToken), effectiveRootFolder: homeRootFolder };
  }

  if (!config.encryptedDestinationNamespaceId) {
    return { ok: false, code: "NAMESPACE_NOT_RESOLVED", message: "The destination Dropbox namespace is not configured." };
  }

  try {
    const namespaceId = decryptToken(config.encryptedDestinationNamespaceId, env.tokenEncryptionKey);
    const client = createNamespaceClient(env, refreshToken, namespaceId);
    return { ok: true, client, effectiveRootFolder: config.activeRootFolder };
  } catch (err) {
    if (err instanceof DropboxTokenDecryptionError) {
      return { ok: false, code: "TOKEN_REVOKED", message: "The stored destination namespace could not be read." };
    }
    return { ok: false, code: "UNKNOWN_ERROR", message: "Could not build the active Dropbox client." };
  }
}
