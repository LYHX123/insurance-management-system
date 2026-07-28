"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ShieldCheck, UploadCloud } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import {
  retryDocumentSyncAction,
  verifyDocumentSyncAction,
  reuploadDocumentToDropboxAction,
  type DocumentDropboxActionResult,
} from "@/app/(app)/customer/document-actions";
import type { DropboxDocumentSyncView } from "@/components/customers/types";

// Safe, translated DropboxErrorCode -> i18n key map (never shows a raw SDK
// error, stack trace, or path — Phase 3 Part 7/14/15).
const ERROR_KEY: Record<string, string> = {
  DROPBOX_NOT_CONNECTED: "dropboxErrorNotConnected",
  CUSTOMER_DOCUMENT_NOT_FOUND: "dropboxErrorCustomerDocumentNotFound",
  LOCAL_FILE_NOT_FOUND: "dropboxErrorLocalFileNotFound",
  CUSTOMER_FOLDER_NOT_SYNCED: "dropboxErrorCustomerFolderNotSynced",
  CUSTOMER_DOCUMENT_SYNC_PENDING: "dropboxErrorCustomerDocumentSyncPending",
  CUSTOMER_DOCUMENT_UPLOAD_FAILED: "dropboxErrorCustomerDocumentUploadFailed",
  CUSTOMER_DOCUMENT_CONFLICT: "dropboxErrorCustomerDocumentConflict",
  DROPBOX_FILE_NOT_FOUND: "dropboxErrorDropboxFileNotFound",
  DROPBOX_FILE_IS_FOLDER: "dropboxErrorDropboxFileIsFolder",
  DROPBOX_FILE_OUTSIDE_ROOT: "dropboxErrorDropboxFileOutsideRoot",
  INVALID_STANDARD_FILENAME: "dropboxErrorInvalidStandardFilename",
  TOKEN_REVOKED: "dropboxErrorTokenRevoked",
  INSUFFICIENT_SCOPE: "dropboxErrorInsufficientScope",
  RATE_LIMITED: "dropboxErrorRateLimited",
  NETWORK_ERROR: "dropboxErrorNetwork",
  UNKNOWN_ERROR: "dropboxErrorUnknown",
};

const STATUS_TONE: Record<string, BadgeTone> = {
  SYNCED: "success",
  PENDING: "neutral",
  SYNCING: "info",
  ERROR: "danger",
  CONFLICT: "warning",
  DISABLED: "neutral",
  NOT_CONNECTED: "warning",
};

export function DocumentDropboxStatus({
  documentId,
  dropboxSync,
  dropboxConnected,
  isAdmin,
}: {
  documentId: string;
  dropboxSync: DropboxDocumentSyncView;
  dropboxConnected: boolean;
  isAdmin: boolean;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveStatus = !dropboxConnected ? "NOT_CONNECTED" : dropboxSync?.syncStatus ?? "PENDING";

  const statusLabel: Record<string, string> = {
    SYNCED: t.customers.dropboxDocumentStatusSynced,
    PENDING: t.customers.dropboxDocumentStatusPending,
    SYNCING: t.customers.dropboxDocumentStatusSyncing,
    ERROR: t.customers.dropboxDocumentStatusError,
    CONFLICT: t.customers.dropboxDocumentStatusConflict,
    DISABLED: t.customers.dropboxDocumentStatusDisabled,
    NOT_CONNECTED: t.customers.dropboxDocumentStatusNotConnected,
  };

  const run = async (action: (id: string) => Promise<DocumentDropboxActionResult>) => {
    setIsBusy(true);
    setError(null);
    const result = await action(documentId);
    setIsBusy(false);
    if (result.forbidden) {
      setError(t.customers.dropboxDocumentUnauthorized);
      return;
    }
    if (!result.success) {
      const key = (result.code && ERROR_KEY[result.code]) || "dropboxErrorUnknown";
      setError(t.customers[key as keyof typeof t.customers] as string);
    }
    // Server state (status/error/timestamps) is authoritative either way —
    // refresh so this cell always reflects what was actually persisted.
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Badge tone={STATUS_TONE[effectiveStatus]} title={dropboxSync?.lastErrorMessage ?? undefined}>
          {statusLabel[effectiveStatus]}
        </Badge>
        {isAdmin && dropboxConnected && (
          <div className="flex items-center gap-0.5">
            <IconButton
              title={effectiveStatus === "SYNCED" ? t.customers.dropboxDocumentReupload : t.customers.dropboxDocumentRetry}
              disabled={isBusy}
              onClick={() => run(effectiveStatus === "SYNCED" ? reuploadDocumentToDropboxAction : retryDocumentSyncAction)}
            >
              {effectiveStatus === "SYNCED" ? <UploadCloud size={14} /> : <RefreshCw size={14} />}
            </IconButton>
            {dropboxSync?.syncStatus && dropboxSync.syncStatus !== "PENDING" && (
              <IconButton title={t.customers.dropboxDocumentVerify} disabled={isBusy} onClick={() => run(verifyDocumentSyncAction)}>
                <ShieldCheck size={14} />
              </IconButton>
            )}
          </div>
        )}
      </div>
      {dropboxSync?.lastSyncedAt && (
        <span className="text-xs text-zinc-400">{dateFormatter.format(new Date(dropboxSync.lastSyncedAt))}</span>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
