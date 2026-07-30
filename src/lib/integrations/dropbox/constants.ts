// Server-only. Central place for Dropbox integration constants and
// environment-variable handling — see the doc comment on getDropboxEnv()
// for why env validation happens at call time rather than at import time.

// Same fixed-id singleton convention as SystemSettings
// (src/lib/settings/constants.ts's SYSTEM_SETTINGS_ID) — every read/write
// targets `where: { id: DROPBOX_INTEGRATION_ID }` so a second row can never
// be accidentally created.
export const DROPBOX_INTEGRATION_ID = "singleton";

export const DEFAULT_DROPBOX_ROOT_FOLDER = "/Insurance Management System";

// Individual (non-Team) scopes only, matching exactly what's configured on
// the Dropbox app — never request Team scopes.
export const DROPBOX_SCOPES = [
  "account_info.read",
  "files.metadata.read",
  "files.metadata.write",
  "files.content.read",
  "files.content.write",
] as const;

export const DROPBOX_OAUTH_STATE_COOKIE = "dropbox_oauth_state";
export const DROPBOX_OAUTH_STATE_MAX_AGE_SECONDS = 600; // ~10 minutes

// Dropbox Root Migration — fixed-id singleton, same convention as
// DROPBOX_INTEGRATION_ID above.
export const DROPBOX_NAMESPACE_CONFIG_ID = "singleton";

// Confirmed via a live read-only diagnostic (Stage A) — the real API-visible
// name of the Team Folder is NOT the literal string "ENFB SYSTEM FILE" (that
// is only the Dropbox Team's display name); it has a " Team Folder" suffix.
// Never assume the Dropbox web UI label matches the API path.
export const MIGRATION_TARGET_TEAM_FOLDER_NAME = "ENFB SYSTEM FILE Team Folder";
export const MIGRATION_SAFE_DESTINATION_LABEL = "Team Folder — ENFB SYSTEM FILE Team Folder";
export const DEFAULT_DESTINATION_ROOT_FOLDER = "/Insurance Management System";

export type DropboxEnvConfig = {
  appKey: string;
  appSecret: string;
  redirectUri: string;
  tokenEncryptionKey: Buffer; // decoded, exactly 32 bytes
};

export type DropboxEnvResult =
  | { ok: true; config: DropboxEnvConfig }
  | { ok: false; reason: string };

// Deliberately validated at call time (inside every route/action that needs
// it), not at module load — a missing/invalid var must surface as a safe
// CONFIGURATION_MISSING result in Settings, never crash the whole app on
// boot (this codebase has no existing env-validation layer to reuse; see
// the Phase 1 investigation notes — this is new, minimal infrastructure).
export function getDropboxEnv(): DropboxEnvResult {
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const redirectUri = process.env.DROPBOX_REDIRECT_URI;
  const encryptionKeyRaw = process.env.DROPBOX_TOKEN_ENCRYPTION_KEY;

  if (!appKey || !appSecret || !redirectUri || !encryptionKeyRaw) {
    return { ok: false, reason: "MISSING_ENV_VARS" };
  }

  let tokenEncryptionKey: Buffer;
  try {
    tokenEncryptionKey = Buffer.from(encryptionKeyRaw, "base64");
  } catch {
    return { ok: false, reason: "INVALID_ENCRYPTION_KEY_ENCODING" };
  }
  if (tokenEncryptionKey.length !== 32) {
    return { ok: false, reason: "INVALID_ENCRYPTION_KEY_LENGTH" };
  }

  return { ok: true, config: { appKey, appSecret, redirectUri, tokenEncryptionKey } };
}
