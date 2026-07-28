// Server-only. Safe, application-level error categories for the Dropbox
// integration — every Dropbox SDK/HTTP error is translated into one of
// these before it ever reaches a log line, a stored DB field, or the UI.
// Raw SDK error objects (which may contain request/response internals) are
// never passed through directly.

export type DropboxErrorCode =
  | "CONFIGURATION_MISSING"
  | "OAUTH_DENIED"
  | "OAUTH_STATE_INVALID"
  | "TOKEN_EXCHANGE_FAILED"
  | "REFRESH_TOKEN_MISSING"
  | "TOKEN_REVOKED"
  | "INSUFFICIENT_SCOPE"
  | "ACCOUNT_VERIFICATION_FAILED"
  | "ROOT_PATH_INVALID"
  | "ROOT_PATH_IS_FILE"
  | "ROOT_FOLDER_CREATE_FAILED"
  | "ROOT_FOLDER_NOT_FOUND"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "DEVELOPMENT_USER_RESTRICTED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "UNKNOWN_ERROR"
  // --- Phase 2: Customer automatic filing ---
  | "DROPBOX_NOT_CONNECTED"
  | "CUSTOMER_NOT_FOUND"
  | "CUSTOMER_FOLDER_CONFLICT"
  | "CUSTOMER_FOLDER_CREATE_FAILED"
  | "CUSTOMER_FOLDER_NOT_FOUND"
  | "CUSTOMER_FOLDER_IS_FILE"
  | "CUSTOMER_FOLDER_OUTSIDE_ROOT"
  | "CUSTOMER_FOLDER_RENAME_FAILED"
  | "STANDARD_FOLDER_CONFLICT"
  // --- Phase 3: Customer document synchronization ---
  | "CUSTOMER_DOCUMENT_NOT_FOUND"
  | "LOCAL_FILE_NOT_FOUND"
  | "CUSTOMER_FOLDER_NOT_SYNCED"
  | "CUSTOMER_DOCUMENT_SYNC_PENDING"
  | "CUSTOMER_DOCUMENT_UPLOAD_FAILED"
  | "CUSTOMER_DOCUMENT_CONFLICT"
  | "DROPBOX_FILE_NOT_FOUND"
  | "DROPBOX_FILE_IS_FOLDER"
  | "DROPBOX_FILE_OUTSIDE_ROOT"
  | "INVALID_STANDARD_FILENAME"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_TOO_LARGE"
  // --- Phase 4: Insurance business file + Quotation version sync ---
  | "QUOTATION_NOT_FOUND"
  | "QUOTATION_HAS_NO_CASE"
  | "BUSINESS_FOLDER_NOT_SYNCED"
  | "BUSINESS_FOLDER_CONFLICT"
  | "QUOTATION_VERSION_CONFLICT"
  | "EXPORT_FAILED";

export class DropboxIntegrationError extends Error {
  readonly code: DropboxErrorCode;

  constructor(code: DropboxErrorCode, message?: string) {
    super(message ?? code);
    this.name = "DropboxIntegrationError";
    this.code = code;
  }
}

// Dropbox SDK errors are shaped inconsistently depending on failure type —
// a DropboxResponseError (HTTP-level, has `.status` and `.error`) for most
// API call failures, or a plain Error (e.g. network failure from `fetch`)
// for transport-level problems. This never re-throws or logs the raw
// object — see src/lib/integrations/dropbox/service.ts callers, which log
// only `err.code` and a short safe summary.
export function mapDropboxError(err: unknown): DropboxIntegrationError {
  if (err instanceof DropboxIntegrationError) return err;

  const status = extractStatus(err);
  const summary = extractErrorSummary(err);

  if (status === 401) {
    if (summary?.includes("expired_access_token") || summary?.includes("invalid_access_token")) {
      return new DropboxIntegrationError("TOKEN_REVOKED", "Dropbox authorization has expired or was revoked.");
    }
    return new DropboxIntegrationError("TOKEN_REVOKED", "Dropbox authorization is no longer valid.");
  }
  if (status === 403) {
    if (summary?.includes("insufficient_scope") || summary?.includes("missing_scope")) {
      return new DropboxIntegrationError("INSUFFICIENT_SCOPE", "The Dropbox connection is missing a required permission.");
    }
    if (summary?.includes("disallowed_app") || summary?.includes("user")) {
      return new DropboxIntegrationError(
        "DEVELOPMENT_USER_RESTRICTED",
        "This Dropbox account is not enabled as a development user for this app."
      );
    }
    return new DropboxIntegrationError("FORBIDDEN", "Dropbox denied this request.");
  }
  if (status === 404) {
    return new DropboxIntegrationError("NOT_FOUND", "The requested Dropbox resource was not found.");
  }
  if (status === 429) {
    return new DropboxIntegrationError("RATE_LIMITED", "Too many Dropbox requests. Please try again shortly.");
  }
  if (status !== undefined && status >= 500) {
    return new DropboxIntegrationError("NETWORK_ERROR", "Dropbox is temporarily unavailable.");
  }
  if (err instanceof TypeError || (err instanceof Error && /fetch|network/i.test(err.message))) {
    return new DropboxIntegrationError("NETWORK_ERROR", "Could not reach Dropbox. Check your network connection.");
  }
  return new DropboxIntegrationError("UNKNOWN_ERROR", "An unexpected Dropbox error occurred.");
}

function extractStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number") {
    return (err as { status: number }).status;
  }
  return undefined;
}

// Dropbox's error payloads nest the machine-readable summary under
// `.error.error_summary` (a short, safe, non-secret string like
// "expired_access_token/..") — safe to log/store as-is, never the full
// `.error` object (which can echo back request parameters).
function extractErrorSummary(err: unknown): string | undefined {
  if (err && typeof err === "object" && "error" in err) {
    const inner = (err as { error: unknown }).error;
    if (inner && typeof inner === "object" && "error_summary" in inner) {
      const summary = (inner as { error_summary: unknown }).error_summary;
      if (typeof summary === "string") return summary;
    }
  }
  return undefined;
}
