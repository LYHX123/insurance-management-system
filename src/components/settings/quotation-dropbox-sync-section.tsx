"use client";

import { useState } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  previewQuotationBackfillAction,
  initMissingBusinessFilesAction,
  syncMissingQuotationVersionsAction,
  retryFailedQuotationVersionsAction,
  verifySyncedQuotationVersionsAction,
} from "@/app/(app)/settings/quotationDropboxBackfillActions";
import type { QuotationBackfillPreview, QuotationBackfillBatchResult } from "@/lib/integrations/dropbox/quotationDropboxSync";

type PendingBatch = "init-missing" | "sync-missing" | "retry-failed" | null;

export function QuotationDropboxSyncSection({ isConnected }: { isConnected: boolean }) {
  const { t } = useLocale();
  const [preview, setPreview] = useState<QuotationBackfillPreview | null>(null);
  const [lastBatch, setLastBatch] = useState<QuotationBackfillBatchResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingBatch, setPendingBatch] = useState<PendingBatch>(null);

  const stat = (label: string, value: number) => (
    <div>
      <dt className="text-secondary">{label}</dt>
      <dd className="text-lg font-semibold text-zinc-800">{value}</dd>
    </div>
  );

  const handlePreview = async () => {
    setError(null);
    setIsLoading(true);
    const result = await previewQuotationBackfillAction();
    setIsLoading(false);
    if (!result.success) {
      setError(t.quotations.dropboxUnauthorized);
      return;
    }
    setPreview(result.preview);
  };

  const runBatch = async (mode: "init-missing" | "sync-missing" | "retry-failed" | "verify-synced") => {
    setError(null);
    setIsLoading(true);
    setPendingBatch(null);
    const action =
      mode === "init-missing"
        ? initMissingBusinessFilesAction
        : mode === "sync-missing"
          ? syncMissingQuotationVersionsAction
          : mode === "retry-failed"
            ? retryFailedQuotationVersionsAction
            : verifySyncedQuotationVersionsAction;
    const result = await action();
    setIsLoading(false);
    if (!result.success) {
      setError(t.quotations.dropboxUnauthorized);
      return;
    }
    setLastBatch(result.batch);
    const previewResult = await previewQuotationBackfillAction();
    if (previewResult.success) setPreview(previewResult.preview);
  };

  if (!isConnected) return null;

  return (
    <Card className="max-w-2xl p-6">
      <h2 className="section-title mb-2">{t.quotations.dropboxQuoSyncSectionTitle}</h2>
      <p className="mb-4 text-sm text-zinc-500">{t.quotations.dropboxQuoSyncSectionDescription}</p>

      {error && (
        <p role="alert" className="form-error mb-3">
          {error}
        </p>
      )}

      {preview && (
        <dl className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stat(t.quotations.dropboxQuoTotalQuotations, preview.totalQuotations)}
          {stat(t.quotations.dropboxQuoBusinessFilesInitialized, preview.businessFilesInitialized)}
          {stat(t.quotations.dropboxQuoSyncedVersions, preview.syncedVersions)}
          {stat(t.quotations.dropboxQuoPendingVersions, preview.pendingVersions)}
          {stat(t.quotations.dropboxQuoFailedVersions, preview.failedVersions)}
          {stat(t.quotations.dropboxQuoConflictVersions, preview.conflictVersions)}
          {stat(t.quotations.dropboxQuoMissingLocalFiles, preview.missingLocalFiles)}
        </dl>
      )}

      {preview && (
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-medium text-zinc-700">{t.customers.shortName}</h3>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {stat(t.customers.shortName, preview.customerShortNameStats.withShortName)}
            {stat(t.customers.derivedCustomerShortName, preview.customerShortNameStats.usingDerivedInitials)}
            {stat(t.customers.customerShortNameRequired, preview.customerShortNameStats.usingCustomerNumberFallback)}
          </dl>
        </div>
      )}

      {lastBatch && (
        <p className="mb-4 text-sm text-zinc-600">
          {t.customers.dropboxBatchResultSummary
            .replace("{processed}", String(lastBatch.processed))
            .replace("{succeeded}", String(lastBatch.succeeded))
            .replace("{failed}", String(lastBatch.failed))}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={isLoading} onClick={handlePreview}>
          {t.quotations.dropboxQuoPreviewBackfill}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => setPendingBatch("init-missing")}>
          {t.quotations.dropboxQuoInitMissingBusinessFiles}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => setPendingBatch("sync-missing")}>
          {t.quotations.dropboxQuoSyncMissingVersions}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => setPendingBatch("retry-failed")}>
          {t.quotations.dropboxQuoRetryFailed}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => runBatch("verify-synced")}>
          {t.quotations.dropboxQuoVerifySynced}
        </Button>
      </div>

      {pendingBatch && (
        <ConfirmDialog
          title={t.quotations.dropboxQuoBackfillConfirmTitle}
          message={t.quotations.dropboxQuoBackfillConfirmMessage}
          isSubmitting={isLoading}
          onConfirm={() => runBatch(pendingBatch)}
          onClose={() => setPendingBatch(null)}
        />
      )}
    </Card>
  );
}
