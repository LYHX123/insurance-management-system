// Server-only. Dropbox Root Migration — the only place a Dropbox client is
// constructed with a non-default pathRoot. Two distinct namespaces matter
// here, and they are NOT interchangeable path prefixes of one another:
//
//   - Home namespace: the existing, unchanged behavior (createDropboxClient
//     with no pathRoot) — every pre-migration sync module already uses this.
//   - The Team Folder's OWN namespace: confirmed via a live read-only
//     diagnostic to be a distinct namespace (its shared_folder_id), not a
//     subpath of the account's broader root_namespace_id. Addressing it
//     requires PathRoot tag "namespace_id" (NOT "root" — "root" specifically
//     means "this must equal MY OWN root_namespace_id", it is not a general
//     "address any namespace" selector, and using it for a different
//     namespace throws PathRootError.invalid_root).
//
// Once a client is rooted in the Team Folder's own namespace, paths are
// relative to THAT namespace's own root — "/Insurance Management System",
// never "/ENFB SYSTEM FILE Team Folder/Insurance Management System".
import { Dropbox } from "dropbox";
import type { DropboxEnvConfig } from "../constants";
import { MIGRATION_TARGET_TEAM_FOLDER_NAME } from "../constants";
import { createDropboxClient } from "../client";
import { DropboxIntegrationError, mapDropboxError } from "../errors";
import { withRateLimitBackoff, INTERACTIVE_BACKOFF } from "../rateLimitRetry";

export function createSourceClient(env: DropboxEnvConfig, refreshToken: string): Dropbox {
  return createDropboxClient(env, refreshToken);
}

export function createNamespaceClient(env: DropboxEnvConfig, refreshToken: string, namespaceId: string): Dropbox {
  return new Dropbox({
    clientId: env.appKey,
    clientSecret: env.appSecret,
    refreshToken,
    pathRoot: JSON.stringify({ ".tag": "namespace_id", namespace_id: namespaceId }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

// The SDK's own PathRoot "root" tag is only for echoing the account's own
// root_namespace_id (see module doc comment) — used transiently, during
// resolution only, to look up the Team Folder's mount-point metadata.
function createAccountRootClient(env: DropboxEnvConfig, refreshToken: string, rootNamespaceId: string): Dropbox {
  return new Dropbox({
    clientId: env.appKey,
    clientSecret: env.appSecret,
    refreshToken,
    pathRoot: JSON.stringify({ ".tag": "root", root: rootNamespaceId }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

export type ResolvedTeamFolderNamespace = {
  namespaceId: string;
  displayName: string;
};

// Read-only. Given an authenticated Home-namespace client, resolves the
// Team Folder's own distinct namespace id — never guesses/hardcodes an id,
// always re-derives it from a live metadata lookup so a namespace change on
// Dropbox's side (e.g. the team folder gets recreated) is caught rather than
// silently mismatched.
export async function resolveTeamFolderNamespace(
  env: DropboxEnvConfig,
  refreshToken: string
): Promise<ResolvedTeamFolderNamespace> {
  const homeClient = createSourceClient(env, refreshToken);

  let account;
  try {
    // Single admin-triggered namespace-resolution step (Stage A), not a
    // batch call — bounded tightly.
    account = await withRateLimitBackoff(() => homeClient.usersGetCurrentAccount(), INTERACTIVE_BACKOFF);
  } catch (err) {
    throw mapDropboxError(err);
  }

  const rootInfo = account.result.root_info as unknown as { [key: string]: unknown; ".tag": string };
  const rootNamespaceId = rootInfo.root_namespace_id as string | undefined;
  const homeNamespaceId = rootInfo.home_namespace_id as string | undefined;
  if (!rootNamespaceId) {
    throw new DropboxIntegrationError("NAMESPACE_NOT_TEAM_ELIGIBLE", "This Dropbox account has no distinct root namespace to search.");
  }
  if (rootNamespaceId === homeNamespaceId) {
    throw new DropboxIntegrationError(
      "NAMESPACE_NOT_TEAM_ELIGIBLE",
      "This Dropbox account's root namespace is the same as its Home namespace — no separate Team Folder namespace is reachable."
    );
  }

  const rootClient = createAccountRootClient(env, refreshToken, rootNamespaceId);

  let meta;
  try {
    meta = await withRateLimitBackoff(() => rootClient.filesGetMetadata({ path: `/${MIGRATION_TARGET_TEAM_FOLDER_NAME}` }), INTERACTIVE_BACKOFF);
  } catch (err) {
    throw mapDropboxError(err);
  }

  const result = meta.result as unknown as { [key: string]: unknown; ".tag": string };
  if (result[".tag"] !== "folder") {
    throw new DropboxIntegrationError("NAMESPACE_NOT_TEAM_ELIGIBLE", "The configured Team Folder name does not resolve to a folder.");
  }

  const sharingInfo = result.sharing_info as { shared_folder_id?: string } | undefined;
  const candidateNamespaceId = (result.shared_folder_id as string | undefined) ?? sharingInfo?.shared_folder_id;
  if (!candidateNamespaceId) {
    throw new DropboxIntegrationError(
      "NAMESPACE_NOT_TEAM_ELIGIBLE",
      "Could not determine a distinct namespace id for the Team Folder from its metadata."
    );
  }

  // Verify by actually addressing that namespace directly — do not trust the
  // candidate id without a live round-trip confirming it resolves.
  const candidateClient = createNamespaceClient(env, refreshToken, candidateNamespaceId);
  try {
    await withRateLimitBackoff(() => candidateClient.filesListFolder({ path: "" }), INTERACTIVE_BACKOFF);
  } catch (err) {
    throw mapDropboxError(err);
  }

  return {
    namespaceId: candidateNamespaceId,
    displayName: MIGRATION_TARGET_TEAM_FOLDER_NAME,
  };
}
