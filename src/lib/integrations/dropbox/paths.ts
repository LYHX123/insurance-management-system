// Server-only. All Dropbox operations in this and future phases must be
// confined to one configured root folder — these are the only functions
// allowed to decide whether a path is "inside" that root. Never accept a
// raw Dropbox path from the browser as trusted; always re-derive it
// through joinDropboxPath() below.
import { DropboxIntegrationError } from "./errors";

const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/;

// Rejects: not starting with "/", exactly "/", any ".." path segment,
// control characters, and normalizes a trailing slash away. Does NOT
// collapse "//" or ensure the syntax matches Dropbox's own path rules
// beyond what's needed for our own containment guarantee — Dropbox itself
// will reject genuinely malformed paths at the API level.
export function normalizeRootFolder(input: string): string {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/")) {
    throw new DropboxIntegrationError("ROOT_PATH_INVALID", "Root folder must start with \"/\".");
  }
  if (trimmed === "/") {
    throw new DropboxIntegrationError("ROOT_PATH_INVALID", "Root folder cannot be the Dropbox root (\"/\").");
  }
  if (CONTROL_CHAR_PATTERN.test(trimmed)) {
    throw new DropboxIntegrationError("ROOT_PATH_INVALID", "Root folder contains invalid control characters.");
  }

  const segments = trimmed.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "..")) {
    throw new DropboxIntegrationError("ROOT_PATH_INVALID", "Root folder cannot contain \"..\".");
  }
  if (segments.length === 0) {
    throw new DropboxIntegrationError("ROOT_PATH_INVALID", "Root folder cannot be empty.");
  }

  // Rebuilding from validated segments (rather than just stripping a
  // trailing slash) also collapses any accidental "//" runs.
  return "/" + segments.join("/");
}

// Joins `relative` onto the already-normalized `root` and asserts the
// result is genuinely inside it — the boundary check uses `root + "/"` as
// the required prefix (never a naive `startsWith(root)`), which is what
// correctly rejects a sibling folder like "/Insurance Management System 2"
// from being mistaken as being under "/Insurance Management System".
export function joinDropboxPath(root: string, relative: string): string {
  const normalizedRoot = normalizeRootFolder(root);

  const relativeSegments = relative
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (relativeSegments.some((segment) => segment === "..")) {
    throw new DropboxIntegrationError("ROOT_PATH_INVALID", "Path cannot contain \"..\".");
  }
  if (relativeSegments.some((segment) => CONTROL_CHAR_PATTERN.test(segment))) {
    throw new DropboxIntegrationError("ROOT_PATH_INVALID", "Path contains invalid control characters.");
  }

  const joined = relativeSegments.length === 0 ? normalizedRoot : `${normalizedRoot}/${relativeSegments.join("/")}`;

  assertInsideRoot(joined, normalizedRoot);
  return joined;
}

// Exported separately so callers can validate a path obtained from
// elsewhere (e.g. Dropbox metadata) without re-joining it.
export function assertInsideRoot(path: string, root: string): void {
  const normalizedRoot = normalizeRootFolder(root);
  if (path !== normalizedRoot && !path.startsWith(normalizedRoot + "/")) {
    throw new DropboxIntegrationError("ROOT_PATH_INVALID", "Path escapes the configured Dropbox root folder.");
  }
}
