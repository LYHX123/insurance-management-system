"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CustomerFolderSyncSection } from "@/components/settings/customer-folder-sync-section";
import { CustomerDocumentFolderSyncSection } from "@/components/settings/customer-document-folder-sync-section";
import { QuotationDropboxSyncSection } from "@/components/settings/quotation-dropbox-sync-section";
import { PolicyDocumentDropboxSyncSection } from "@/components/settings/policy-document-dropbox-sync-section";
import { InvoiceDocumentDropboxSyncSection } from "@/components/settings/invoice-document-dropbox-sync-section";
import { ClaimDocumentDropboxSyncSection } from "@/components/settings/claim-document-dropbox-sync-section";
import {
  testDropboxConnectionAction,
  disconnectDropboxAction,
  saveDropboxRootFolderAction,
} from "@/app/(app)/settings/dropboxActions";
import {
  previewMotorClaimDocumentBackfillAction,
  initMissingMotorClaimDocumentsAction,
  syncMissingMotorClaimDocumentsBackfillAction,
  retryFailedMotorClaimDocumentsAction,
  verifySyncedMotorClaimDocumentsAction,
} from "@/app/(app)/settings/motorClaimDocumentDropboxBackfillActions";
import {
  previewNonMotorClaimDocumentBackfillAction,
  initMissingNonMotorClaimDocumentsAction,
  syncMissingNonMotorClaimDocumentsBackfillAction,
  retryFailedNonMotorClaimDocumentsAction,
  verifySyncedNonMotorClaimDocumentsAction,
} from "@/app/(app)/settings/nonMotorClaimDocumentDropboxBackfillActions";
import type { DropboxIntegrationView } from "@/lib/integrations/dropbox/types";

const ERROR_KEY: Record<string, string> = {
  CONFIGURATION_MISSING: "dropboxConfigIncomplete",
  OAUTH_DENIED: "dropboxAuthDenied",
  OAUTH_STATE_INVALID: "dropboxAuthFailed",
  TOKEN_EXCHANGE_FAILED: "dropboxAuthFailed",
  REFRESH_TOKEN_MISSING: "dropboxAuthFailed",
  TOKEN_REVOKED: "dropboxAuthExpiredOrRevoked",
  INSUFFICIENT_SCOPE: "dropboxInsufficientScope",
  ACCOUNT_VERIFICATION_FAILED: "dropboxAuthFailed",
  ROOT_PATH_INVALID: "dropboxRootPathInvalid",
  ROOT_PATH_IS_FILE: "dropboxRootPathIsFile",
  ROOT_FOLDER_CREATE_FAILED: "dropboxRootPathInvalid",
  ROOT_FOLDER_NOT_FOUND: "dropboxRootPathInvalid",
  RATE_LIMITED: "dropboxRateLimited",
  NETWORK_ERROR: "dropboxNetworkError",
  DEVELOPMENT_USER_RESTRICTED: "dropboxDevUserRestricted",
  FORBIDDEN: "dropboxUnauthorized",
  NOT_FOUND: "dropboxRootPathInvalid",
  UNKNOWN_ERROR: "dropboxUnknownError",
};

function dateFormatter(locale: string) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });
}

function maskAccountId(id: string | null): string {
  if (!id) return "—";
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function DropboxIntegrationForm({
  dropbox,
  callbackResult,
  callbackErrorCode,
}: {
  dropbox: DropboxIntegrationView;
  callbackResult: string | null;
  callbackErrorCode: string | null;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fmt = dateFormatter(locale);

  const [rootFolder, setRootFolder] = useState(dropbox.rootFolder);
  const [error, setError] = useState<string | null>(
    callbackResult === "error" && callbackErrorCode ? t.settings[(ERROR_KEY[callbackErrorCode] ?? "dropboxUnknownError") as keyof typeof t.settings] : null
  );
  const [message, setMessage] = useState<string | null>(
    callbackResult === "connected" ? t.settings.dropboxConnectedSuccessfully : null
  );

  // The OAuth callback's one-shot signal (?dropbox=connected|error&code=...)
  // must only ever be shown once — strip it from the URL (replace, no new
  // history entry) right after reading it into local state, so returning to
  // this exact URL later (browser history, a bookmark, or a smart-back
  // returnTo capture) never replays the banner (Phase 8 Part 1 finding).
  useEffect(() => {
    if (!callbackResult) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("dropbox");
    params.delete("code");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [isTesting, setIsTesting] = useState(false);
  const [isSavingRoot, setIsSavingRoot] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const isConnected = dropbox.status === "CONNECTED" && !dropbox.configurationMissing;

  const statusTone = dropbox.configurationMissing
    ? "warning"
    : dropbox.status === "CONNECTED"
    ? "success"
    : dropbox.status === "ERROR"
    ? "danger"
    : "neutral";

  const statusLabel = dropbox.configurationMissing
    ? t.settings.dropboxStatusConfigMissing
    : dropbox.status === "CONNECTED"
    ? t.settings.dropboxStatusConnected
    : dropbox.status === "ERROR"
    ? t.settings.dropboxStatusError
    : t.settings.dropboxStatusDisconnected;

  const handleTest = async () => {
    setError(null);
    setMessage(null);
    setIsTesting(true);
    const result = await testDropboxConnectionAction();
    setIsTesting(false);
    if (!result.success) {
      setError(t.settings[(ERROR_KEY[result.error] ?? "dropboxUnknownError") as keyof typeof t.settings]);
      return;
    }
    setMessage(t.settings.dropboxConnectionWorking);
    router.refresh();
  };

  const handleSaveRootFolder = async () => {
    setError(null);
    setMessage(null);
    setIsSavingRoot(true);
    const result = await saveDropboxRootFolderAction(rootFolder);
    setIsSavingRoot(false);
    if (!result.success) {
      setError(t.settings[(ERROR_KEY[result.error] ?? "dropboxUnknownError") as keyof typeof t.settings]);
      return;
    }
    setRootFolder(result.path);
    setMessage(isConnected ? t.settings.dropboxRootFolderVerifiedMessage : t.settings.dropboxSaveSuccess);
    router.refresh();
  };

  const handleDisconnect = async () => {
    setError(null);
    setMessage(null);
    setIsDisconnecting(true);
    const result = await disconnectDropboxAction();
    setIsDisconnecting(false);
    setShowDisconnectConfirm(false);
    if (!result.success) {
      setError(t.settings[(ERROR_KEY[result.error] ?? "dropboxUnknownError") as keyof typeof t.settings]);
      return;
    }
    setMessage(result.warning ?? t.settings.dropboxSaveSuccess);
    router.refresh();
  };

  const handleOpenFolder = () => {
    window.open("https://www.dropbox.com/home", "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="max-w-2xl p-6">
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="section-title">{t.settings.dropboxIntegrationTitle}</h2>
            <p className="mt-1 text-sm text-zinc-500">{t.settings.dropboxIntegrationDescription}</p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-secondary">{t.settings.dropboxStatusLabel}</span>
            <Badge tone={statusTone}>{statusLabel}</Badge>
          </div>

          {dropbox.configurationMissing && <p className="text-sm text-zinc-500">{t.settings.dropboxConfigMissingHint}</p>}

          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {message && <p className="text-sm text-emerald-700">{message}</p>}

          <div className="flex flex-wrap gap-2">
            {!isConnected ? (
              <a href="/api/integrations/dropbox/connect">
                <Button type="button" disabled={dropbox.configurationMissing}>
                  {t.settings.dropboxConnect}
                </Button>
              </a>
            ) : (
              <>
                <Button type="button" variant="secondary" onClick={handleTest} disabled={isTesting}>
                  {t.settings.dropboxTestConnection}
                </Button>
                <Button type="button" variant="secondary" onClick={handleOpenFolder}>
                  {t.settings.dropboxOpenFolder}
                </Button>
                <a href="/api/integrations/dropbox/connect">
                  <Button type="button" variant="secondary">
                    {t.settings.dropboxReconnect}
                  </Button>
                </a>
                <Button type="button" variant="destructive" onClick={() => setShowDisconnectConfirm(true)}>
                  {t.settings.dropboxDisconnect}
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      {isConnected && (
        <Card className="max-w-2xl p-6">
          <h2 className="section-title mb-4">{t.settings.dropboxConnectedAccountTitle}</h2>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-secondary">{t.settings.dropboxAccountName}</dt>
              <dd className="font-medium text-zinc-800">{dropbox.accountDisplayName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-secondary">{t.settings.dropboxAccountEmail}</dt>
              <dd className="font-medium text-zinc-800">{dropbox.accountEmail ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-secondary">{t.settings.dropboxAccountId}</dt>
              <dd className="font-medium text-zinc-800">{maskAccountId(dropbox.dropboxAccountId)}</dd>
            </div>
            <div>
              <dt className="text-secondary">{t.settings.dropboxConnectedDate}</dt>
              <dd className="font-medium text-zinc-800">{dropbox.connectedAt ? fmt.format(new Date(dropbox.connectedAt)) : "—"}</dd>
            </div>
            <div>
              <dt className="text-secondary">{t.settings.dropboxConnectedBy}</dt>
              <dd className="font-medium text-zinc-800">{dropbox.connectedByName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-secondary">{t.settings.dropboxLastSuccessfulTest}</dt>
              <dd className="font-medium text-zinc-800">
                {dropbox.lastSuccessfulAt ? fmt.format(new Date(dropbox.lastSuccessfulAt)) : t.settings.dropboxNotConnectedYet}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      <Card className="max-w-2xl p-6">
        <h2 className="section-title mb-2">{t.settings.dropboxRootFolderTitle}</h2>
        <p className="mb-4 text-sm text-zinc-500">{t.settings.dropboxRootFolderExplanation}</p>
        <FormField label={t.settings.dropboxRootFolderLabel}>
          <Input value={rootFolder} onChange={(e) => setRootFolder(e.target.value)} />
        </FormField>
        {dropbox.rootFolderVerifiedAt && (
          <p className="mt-2 text-xs text-zinc-500">
            {t.settings.dropboxRootFolderVerifiedAt}: {fmt.format(new Date(dropbox.rootFolderVerifiedAt))}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={handleSaveRootFolder} disabled={isSavingRoot}>
            {t.settings.dropboxSaveRootFolder}
          </Button>
        </div>
      </Card>

      <CustomerFolderSyncSection isConnected={isConnected} />

      <CustomerDocumentFolderSyncSection isConnected={isConnected} />

      <QuotationDropboxSyncSection isConnected={isConnected} />
      <PolicyDocumentDropboxSyncSection isConnected={isConnected} />
      <InvoiceDocumentDropboxSyncSection isConnected={isConnected} />
      <ClaimDocumentDropboxSyncSection
        isConnected={isConnected}
        title={t.claims.dropboxClaimSyncSectionTitleMotor}
        description={t.claims.dropboxClaimSyncSectionDescriptionMotor}
        previewAction={previewMotorClaimDocumentBackfillAction}
        initMissingAction={initMissingMotorClaimDocumentsAction}
        syncMissingAction={syncMissingMotorClaimDocumentsBackfillAction}
        retryFailedAction={retryFailedMotorClaimDocumentsAction}
        verifySyncedAction={verifySyncedMotorClaimDocumentsAction}
      />
      <ClaimDocumentDropboxSyncSection
        isConnected={isConnected}
        title={t.claims.dropboxClaimSyncSectionTitleNonMotor}
        description={t.claims.dropboxClaimSyncSectionDescriptionNonMotor}
        previewAction={previewNonMotorClaimDocumentBackfillAction}
        initMissingAction={initMissingNonMotorClaimDocumentsAction}
        syncMissingAction={syncMissingNonMotorClaimDocumentsBackfillAction}
        retryFailedAction={retryFailedNonMotorClaimDocumentsAction}
        verifySyncedAction={verifySyncedNonMotorClaimDocumentsAction}
      />

      {showDisconnectConfirm && (
        <ConfirmDialog
          title={t.settings.dropboxDisconnectConfirmTitle}
          message={t.settings.dropboxDisconnectConfirmMessage}
          isSubmitting={isDisconnecting}
          onConfirm={handleDisconnect}
          onClose={() => setShowDisconnectConfirm(false)}
        />
      )}
    </div>
  );
}
