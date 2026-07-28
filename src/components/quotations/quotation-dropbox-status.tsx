"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ShieldCheck, UploadCloud } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  retryQuotationDropboxSyncAction,
  reuploadQuotationVersionAction,
  verifyBusinessFolderAction,
  verifyQuotationVersionAction,
  type QuotationDropboxActionResult,
} from "@/app/(app)/quotation/dropboxActions";

// Safe view model only — never a raw Dropbox folder/file id, never an
// absolute local storage path (Part 9, requirement 3-4).
export type QuotationDropboxView = {
  businessFolderName: string;
  businessFileSyncStatus: string;
  businessFileLastErrorMessage: string | null;
  currentVersion: {
    id: string;
    versionNumber: number;
    excelFileName: string;
    excelSyncStatus: string;
    lastSyncedAt: string | null;
  } | null;
} | null;

const ERROR_KEY: Record<string, string> = {
  DROPBOX_NOT_CONNECTED: "dropboxErrorNotConnected",
  CUSTOMER_FOLDER_NOT_SYNCED: "dropboxErrorCustomerFolderNotSynced",
  BUSINESS_FOLDER_NOT_SYNCED: "dropboxErrorBusinessFolderNotSynced",
  BUSINESS_FOLDER_CONFLICT: "dropboxErrorBusinessFolderConflict",
  QUOTATION_VERSION_CONFLICT: "dropboxErrorQuotationVersionConflict",
  EXPORT_FAILED: "dropboxErrorExportFailed",
  DROPBOX_FILE_NOT_FOUND: "dropboxErrorFileNotFound",
  TOKEN_REVOKED: "dropboxErrorTokenRevoked",
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

export function QuotationDropboxSection({
  quotationId,
  dropbox,
  dropboxConnected,
  isAdmin,
}: {
  quotationId: string;
  dropbox: QuotationDropboxView;
  dropboxConnected: boolean;
  isAdmin: boolean;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveStatus = !dropboxConnected ? "NOT_CONNECTED" : dropbox?.currentVersion?.excelSyncStatus ?? "PENDING";
  const statusLabel: Record<string, string> = {
    SYNCED: t.quotations.dropboxStatusSynced,
    PENDING: t.quotations.dropboxStatusPending,
    SYNCING: t.quotations.dropboxStatusSyncing,
    ERROR: t.quotations.dropboxStatusError,
    CONFLICT: t.quotations.dropboxStatusConflict,
    NOT_CONNECTED: t.quotations.dropboxStatusNotConnected,
  };

  const run = async (action: () => Promise<QuotationDropboxActionResult>) => {
    setIsBusy(true);
    setError(null);
    const result = await action();
    setIsBusy(false);
    if (result.forbidden) {
      setError(t.quotations.dropboxUnauthorized);
      return;
    }
    if (!result.success) {
      const key = (result.code && ERROR_KEY[result.code]) || "dropboxErrorUnknown";
      setError(t.quotations[key as keyof typeof t.quotations] as string);
    }
    router.refresh();
  };

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="section-title">{t.quotations.dropboxFilename}</h2>
          <Badge tone={STATUS_TONE[effectiveStatus]}>{statusLabel[effectiveStatus]}</Badge>
        </div>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        {dropboxConnected && dropbox ? (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-secondary">{t.quotations.businessFileFolder}</dt>
              <dd className="text-body font-medium">{dropbox.businessFolderName}</dd>
            </div>
            <div>
              <dt className="text-secondary">{t.quotations.currentVersion}</dt>
              <dd className="text-body font-medium">{dropbox.currentVersion ? `V${dropbox.currentVersion.versionNumber}` : "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-secondary">{t.quotations.dropboxExcelFilename}</dt>
              <dd className="text-body">
                {dropbox.currentVersion?.excelFileName ?? "—"}
                {dropbox.currentVersion && dropbox.currentVersion.excelSyncStatus !== "SYNCED" && (
                  <span className="ml-2 text-xs text-secondary">({t.quotations.dropboxFilenamePlanned})</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-secondary">{t.quotations.dropboxLastSynchronized}</dt>
              <dd className="text-body">
                {dropbox.currentVersion?.lastSyncedAt ? dateFormatter.format(new Date(dropbox.currentVersion.lastSyncedAt)) : "—"}
              </dd>
            </div>
            {(dropbox.businessFileLastErrorMessage || dropbox.businessFileSyncStatus === "ERROR" || dropbox.businessFileSyncStatus === "CONFLICT") && (
              <div className="sm:col-span-2">
                <dt className="text-secondary">{t.quotations.dropboxStatusError}</dt>
                <dd className="text-sm text-red-600">{dropbox.businessFileLastErrorMessage}</dd>
              </div>
            )}
          </dl>
        ) : dropboxConnected ? (
          <p className="text-secondary text-sm">{t.quotations.dropboxNotGeneratedYet}</p>
        ) : null}

        {isAdmin && dropboxConnected && dropbox?.currentVersion && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={isBusy}
              onClick={() =>
                run(() =>
                  effectiveStatus === "SYNCED"
                    ? reuploadQuotationVersionAction(dropbox.currentVersion!.id)
                    : retryQuotationDropboxSyncAction(dropbox.currentVersion!.id)
                )
              }
            >
              {effectiveStatus === "SYNCED" ? <UploadCloud size={16} /> : <RefreshCw size={16} />}
              {effectiveStatus === "SYNCED" ? t.quotations.reuploadCurrentVersion : t.quotations.retryDropboxSync}
            </Button>
            <Button type="button" variant="secondary" disabled={isBusy} onClick={() => run(() => verifyBusinessFolderAction(quotationId))}>
              <ShieldCheck size={16} />
              {t.quotations.verifyBusinessFolderAction}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isBusy}
              onClick={() => run(() => verifyQuotationVersionAction(dropbox.currentVersion!.id))}
            >
              <ShieldCheck size={16} />
              {t.quotations.verifyQuotationFilesAction}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
