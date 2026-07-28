"use client";

import { useState } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  previewCustomerDocumentBackfillAction,
  syncMissingCustomerDocumentsAction,
  retryFailedCustomerDocumentsAction,
  verifySyncedCustomerDocumentsAction,
} from "@/app/(app)/settings/customerDocumentDropboxBackfillActions";
import type { DocumentBackfillPreview, DocumentBackfillBatchResult } from "@/lib/integrations/dropbox/customerDocumentSync";

type PendingBatch = "missing" | "retry-failed" | null;

export function CustomerDocumentFolderSyncSection({ isConnected }: { isConnected: boolean }) {
  const { t } = useLocale();
  const [preview, setPreview] = useState<DocumentBackfillPreview | null>(null);
  const [lastBatch, setLastBatch] = useState<DocumentBackfillBatchResult | null>(null);
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
    const result = await previewCustomerDocumentBackfillAction();
    setIsLoading(false);
    if (!result.success) {
      setError(t.customers.dropboxDocumentUnauthorized);
      return;
    }
    setPreview(result.preview);
  };

  const runBatch = async (mode: "missing" | "retry-failed" | "verify-all") => {
    setError(null);
    setIsLoading(true);
    setPendingBatch(null);
    const action =
      mode === "missing"
        ? syncMissingCustomerDocumentsAction
        : mode === "retry-failed"
          ? retryFailedCustomerDocumentsAction
          : verifySyncedCustomerDocumentsAction;
    const result = await action();
    setIsLoading(false);
    if (!result.success) {
      setError(t.customers.dropboxDocumentUnauthorized);
      return;
    }
    setLastBatch(result.batch);
    const previewResult = await previewCustomerDocumentBackfillAction();
    if (previewResult.success) setPreview(previewResult.preview);
  };

  if (!isConnected) return null;

  return (
    <Card className="max-w-2xl p-6">
      <h2 className="section-title mb-2">{t.customers.dropboxDocSyncSectionTitle}</h2>
      <p className="mb-4 text-sm text-zinc-500">{t.customers.dropboxDocSyncSectionDescription}</p>

      {error && (
        <p role="alert" className="form-error mb-3">
          {error}
        </p>
      )}

      {preview && (
        <dl className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stat(t.customers.dropboxDocTotalDocuments, preview.totalDocuments)}
          {stat(t.customers.dropboxDocSyncedDocuments, preview.synced)}
          {stat(t.customers.dropboxDocPendingDocuments, preview.pending)}
          {stat(t.customers.dropboxDocFailedDocuments, preview.error)}
        </dl>
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
          {t.customers.dropboxDocPreviewBackfill}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => setPendingBatch("missing")}>
          {t.customers.dropboxDocSyncMissing}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => setPendingBatch("retry-failed")}>
          {t.customers.dropboxDocRetryFailed}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => runBatch("verify-all")}>
          {t.customers.dropboxDocVerifySynced}
        </Button>
      </div>

      {pendingBatch && (
        <ConfirmDialog
          title={t.customers.dropboxDocBackfillConfirmTitle}
          message={t.customers.dropboxDocBackfillConfirmMessage}
          isSubmitting={isLoading}
          onConfirm={() => runBatch(pendingBatch)}
          onClose={() => setPendingBatch(null)}
        />
      )}
    </Card>
  );
}
