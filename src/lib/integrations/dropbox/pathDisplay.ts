// Server-only, pure. Dropbox Integration Phase 5, Part 2 — the single
// source of truth for turning "is Dropbox connected + what does the DB say
// about this folder/file's sync state" into one safe, renderable view
// model. Never includes a Dropbox file/folder/account id, namespace id,
// pathLower, local absolute path, token, or revision — only a human
// display path and a small discriminated state (Part 2, requirements
// 11-13). Reused by Customer/Quotation/Policy (and, in the future,
// Invoice/Claim) detail pages via the shared DropboxPathDisplay component.
import { joinDropboxPath } from "./paths";

export type DropboxPathState =
  | "synced"
  | "planned"
  | "pending"
  | "syncing"
  | "error"
  | "conflict"
  | "not_connected"
  | "unavailable";

export type DropboxPathView = {
  state: DropboxPathState;
  // The one path to render/copy — the actual synchronized display path
  // when state is "synced", otherwise the deterministic planned path (or
  // null only for "unavailable", when even a planned path could not be
  // computed).
  path: string | null;
  isPlanned: boolean;
  errorMessage: string | null;
};

export type DropboxPathSyncStatus = "PENDING" | "SYNCING" | "SYNCED" | "ERROR" | "CONFLICT" | "DISABLED" | null | undefined;

export type BuildDropboxPathViewInput = {
  dropboxConnected: boolean;
  syncStatus: DropboxPathSyncStatus;
  actualPath: string | null;
  plannedPath: string | null;
  errorMessage?: string | null;
};

// The single state-resolution function every path view goes through,
// regardless of entity (Customer folder, Quotation Excel, Policy document,
// ...) — callers only ever differ in how they compute plannedPath/
// actualPath, never in how the resulting state is decided (Part 2,
// requirements 6-7: deterministic planned path with a Pending badge before
// sync; actual stored path after).
export function buildDropboxPathView(input: BuildDropboxPathViewInput): DropboxPathView {
  if (!input.dropboxConnected) {
    return { state: "not_connected", path: input.plannedPath, isPlanned: true, errorMessage: null };
  }
  if (input.actualPath && input.syncStatus === "SYNCED") {
    return { state: "synced", path: input.actualPath, isPlanned: false, errorMessage: null };
  }
  if (input.syncStatus === "CONFLICT") {
    return { state: "conflict", path: input.plannedPath, isPlanned: true, errorMessage: input.errorMessage ?? null };
  }
  if (input.syncStatus === "ERROR") {
    return { state: "error", path: input.plannedPath, isPlanned: true, errorMessage: input.errorMessage ?? null };
  }
  if (input.syncStatus === "SYNCING") {
    return { state: "syncing", path: input.plannedPath, isPlanned: true, errorMessage: null };
  }
  if (input.plannedPath === null) {
    return { state: "unavailable", path: null, isPlanned: true, errorMessage: null };
  }
  return { state: "planned", path: input.plannedPath, isPlanned: true, errorMessage: null };
}

// Joins a folder/file name segment onto an already-resolved parent path
// (either a planned or an actual one — both are plain display-path strings
// by this point). Defense in depth only: every input here is server-derived
// (never raw browser input, Part 2 requirement 12); a malformed parent path
// safely degrades to "unavailable" rather than throwing into a Server
// Component render.
export function safeJoinPlannedPath(parentPath: string, segment: string): string | null {
  try {
    return joinDropboxPath(parentPath, segment);
  } catch {
    return null;
  }
}
