"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { CollapsibleDropboxPath } from "@/components/dropbox/dropbox-path-display";
import {
  syncCustomerFolderAction,
  verifyCustomerFolderAction,
  rebuildCustomerSubfoldersAction,
  type CustomerDropboxActionResult,
} from "@/app/(app)/customer/dropboxActions";
import type { DropboxPathViewPlain } from "@/components/customers/types";

export type CustomerDropboxFolderView = {
  syncStatus: "PENDING" | "SYNCING" | "SYNCED" | "ERROR" | "CONFLICT" | "DISABLED";
  folderName: string;
  displayPath: string | null;
  lastSyncedAt: string | null;
  lastSyncAttemptAt: string | null;
  lastErrorMessage: string | null;
} | null;

const ERROR_KEY: Record<string, string> = {
  CONFIGURATION_MISSING: "dropboxErrorConfigMissing",
  DROPBOX_NOT_CONNECTED: "dropboxErrorNotConnected",
  TOKEN_REVOKED: "dropboxErrorTokenRevoked",
  INSUFFICIENT_SCOPE: "dropboxErrorInsufficientScope",
  RATE_LIMITED: "dropboxErrorRateLimited",
  NETWORK_ERROR: "dropboxErrorNetwork",
  CUSTOMER_NOT_FOUND: "dropboxErrorCustomerNotFound",
  CUSTOMER_FOLDER_CONFLICT: "dropboxErrorFolderConflict",
  CUSTOMER_FOLDER_CREATE_FAILED: "dropboxErrorFolderCreateFailed",
  CUSTOMER_FOLDER_NOT_FOUND: "dropboxErrorFolderNotFound",
  CUSTOMER_FOLDER_IS_FILE: "dropboxErrorFolderIsFile",
  CUSTOMER_FOLDER_OUTSIDE_ROOT: "dropboxErrorFolderOutsideRoot",
  CUSTOMER_FOLDER_RENAME_FAILED: "dropboxErrorFolderRenameFailed",
  STANDARD_FOLDER_CONFLICT: "dropboxErrorStandardFolderConflict",
  DEVELOPMENT_USER_RESTRICTED: "dropboxErrorDevUserRestricted",
  FORBIDDEN: "dropboxUnauthorized",
  UNKNOWN_ERROR: "dropboxErrorUnknown",
};

export function CustomerDropboxCard({
  customerId,
  dropboxFolder,
  dropboxConnected,
  isAdmin,
  dropboxPaths,
}: {
  customerId: string;
  dropboxFolder: CustomerDropboxFolderView;
  dropboxConnected: boolean;
  isAdmin: boolean;
  dropboxPaths?: { customerFolder: DropboxPathViewPlain; customerDocumentsFolder: DropboxPathViewPlain; generalDocumentsFolder: DropboxPathViewPlain };
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  // No local copy of dropboxFolder — every action refreshes the server
  // page afterward (success or failure), so this prop is always the
  // authoritative, up-to-date status; copying it into useState would go
  // stale across a Server Component re-render triggered by router.refresh().
  const current = dropboxFolder;
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveStatus = !dropboxConnected ? "NOT_CONNECTED" : current?.syncStatus ?? "NOT_INITIALIZED";

  const statusTone: Record<string, BadgeTone> = {
    SYNCED: "success",
    PENDING: "neutral",
    SYNCING: "info",
    ERROR: "danger",
    CONFLICT: "warning",
    DISABLED: "neutral",
    NOT_CONNECTED: "warning",
    NOT_INITIALIZED: "neutral",
  };

  const statusLabel: Record<string, string> = {
    SYNCED: t.customers.dropboxStatusSynced,
    PENDING: t.customers.dropboxStatusPending,
    SYNCING: t.customers.dropboxStatusSyncing,
    ERROR: t.customers.dropboxStatusError,
    CONFLICT: t.customers.dropboxStatusConflict,
    DISABLED: t.customers.dropboxStatusDisabled,
    NOT_CONNECTED: t.customers.dropboxStatusNotConnected,
    NOT_INITIALIZED: t.customers.dropboxStatusNotInitialized,
  };

  const runAction = async (
    action: (customerId: string) => Promise<CustomerDropboxActionResult>,
    successKey: keyof typeof t.customers
  ) => {
    setIsBusy(true);
    setError(null);
    setMessage(null);
    const result = await action(customerId);
    setIsBusy(false);

    if (result.forbidden) {
      setError(t.customers.dropboxUnauthorized);
      return;
    }
    if (!result.success) {
      const key = (result.code && ERROR_KEY[result.code]) || "dropboxErrorUnknown";
      setError(t.customers[key as keyof typeof t.customers] as string);
      // The service layer already persisted the new status/error fields on
      // the server regardless of outcome — refresh so this card reflects
      // the authoritative server state rather than guessing it client-side.
      router.refresh();
      return;
    }
    setMessage(t.customers[successKey] as string);
    router.refresh();
  };

  const handleOpenFolder = () => {
    window.open("https://www.dropbox.com/home", "_blank", "noopener,noreferrer");
  };

  const hasFolder = !!current?.displayPath;

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="section-title">{t.customers.dropboxFilingTitle}</h2>
          <Badge tone={statusTone[effectiveStatus]}>{statusLabel[effectiveStatus]}</Badge>
        </div>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {message && <p className="text-sm text-emerald-700">{message}</p>}

        {dropboxConnected && current ? (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-secondary">{t.customers.dropboxCustomerFolder}</dt>
              <dd className="text-body font-medium">{current.folderName}</dd>
            </div>
            <div>
              <dt className="text-secondary">{t.customers.dropboxLastSynchronized}</dt>
              <dd className="text-body">{current.lastSyncedAt ? dateFormatter.format(new Date(current.lastSyncedAt)) : "—"}</dd>
            </div>
            {current.lastErrorMessage && (
              <div className="sm:col-span-2">
                <dt className="text-secondary">{t.customers.dropboxStatusError}</dt>
                <dd className="text-sm text-red-600">{current.lastErrorMessage}</dd>
              </div>
            )}
          </dl>
        ) : dropboxConnected ? (
          <p className="text-secondary text-sm">{t.customers.dropboxNoFolder}</p>
        ) : null}

        {dropboxPaths && (
          <div className="flex flex-col gap-3">
            <CollapsibleDropboxPath label={t.customers.dropboxCustomerFolderPath} view={dropboxPaths.customerFolder} />
            <CollapsibleDropboxPath label={t.customers.dropboxCustomerDocumentsFolderPath} view={dropboxPaths.customerDocumentsFolder} />
            <CollapsibleDropboxPath label={t.customers.dropboxGeneralDocumentsFolderPath} view={dropboxPaths.generalDocumentsFolder} />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {dropboxConnected && current?.syncStatus === "SYNCED" && (
            <Button type="button" variant="secondary" onClick={handleOpenFolder}>
              {t.customers.dropboxOpenCustomerFolder}
            </Button>
          )}
          {isAdmin && dropboxConnected && (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={isBusy}
                onClick={() => runAction(syncCustomerFolderAction, "dropboxFolderCreated")}
              >
                {hasFolder ? t.customers.dropboxRetrySync : t.customers.dropboxSyncCustomerFolder}
              </Button>
              {hasFolder && (
                <>
                  <Button type="button" variant="secondary" disabled={isBusy} onClick={() => runAction(verifyCustomerFolderAction, "dropboxFolderVerified")}>
                    {t.customers.dropboxVerifyFolder}
                  </Button>
                  <Button type="button" variant="secondary" disabled={isBusy} onClick={() => runAction(rebuildCustomerSubfoldersAction, "dropboxFolderVerified")}>
                    {t.customers.dropboxRebuildMissingFolders}
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
