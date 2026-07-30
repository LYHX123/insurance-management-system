"use client";

// Dropbox Integration Phase 6, Part 10 — Settings backfill panel for
// Invoice document synchronization. Mirrors
// policy-document-dropbox-sync-section.tsx's exact shape/behavior.
import { useState } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  previewInvoiceDocumentBackfillAction,
  initMissingInvoiceDocumentsAction,
  syncMissingInvoiceDocumentsAction,
  retryFailedInvoiceDocumentsAction,
  verifySyncedInvoiceDocumentsAction,
} from "@/app/(app)/settings/invoiceDocumentDropboxBackfillActions";
import type { InvoiceDocumentBackfillPreview, InvoiceDocumentBackfillBatchResult } from "@/lib/integrations/dropbox/invoiceDocumentSync";

type PendingBatch = "init-missing" | "sync-missing" | "retry-failed" | null;

export function InvoiceDocumentDropboxSyncSection({ isConnected }: { isConnected: boolean }) {
  const { t } = useLocale();
  const [preview, setPreview] = useState<InvoiceDocumentBackfillPreview | null>(null);
  const [lastBatch, setLastBatch] = useState<InvoiceDocumentBackfillBatchResult | null>(null);
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
    const result = await previewInvoiceDocumentBackfillAction();
    setIsLoading(false);
    if (!result.success) {
      setError(t.invoice.dropboxUnauthorized);
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
        ? initMissingInvoiceDocumentsAction
        : mode === "sync-missing"
          ? syncMissingInvoiceDocumentsAction
          : mode === "retry-failed"
            ? retryFailedInvoiceDocumentsAction
            : verifySyncedInvoiceDocumentsAction;
    const result = await action();
    setIsLoading(false);
    if (!result.success) {
      setError(t.invoice.dropboxUnauthorized);
      return;
    }
    setLastBatch(result.batch);
    const previewResult = await previewInvoiceDocumentBackfillAction();
    if (previewResult.success) setPreview(previewResult.preview);
  };

  if (!isConnected) return null;

  return (
    <Card className="max-w-2xl p-6">
      <h2 className="section-title mb-2">{t.invoice.dropboxInvoiceSyncSectionTitle}</h2>
      <p className="mb-4 text-sm text-zinc-500">{t.invoice.dropboxInvoiceSyncSectionDescription}</p>

      {error && (
        <p role="alert" className="form-error mb-3">
          {error}
        </p>
      )}

      {preview && (
        <dl className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stat(t.invoice.dropboxInvoiceTotalInvoices, preview.totalInvoices)}
          {stat(t.invoice.dropboxInvoiceSynced, preview.synced)}
          {stat(t.invoice.dropboxInvoicePending, preview.pending)}
          {stat(t.invoice.dropboxInvoiceFailed, preview.failed)}
          {stat(t.invoice.dropboxInvoiceConflicts, preview.conflicts)}
          {stat(t.invoice.dropboxInvoiceMissingLocalFiles, preview.missingLocalFiles)}
          {stat(t.invoice.dropboxInvoiceLinkedToQuotationBusinessFile, preview.linkedToQuotationBusinessFile)}
          {stat(t.invoice.dropboxInvoiceUsingPolicyFallbackBusinessFile, preview.usingPolicyFallbackBusinessFile)}
          {stat(t.invoice.dropboxInvoiceUsingInvoiceFallbackBusinessFile, preview.usingInvoiceFallbackBusinessFile)}
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
          {t.invoice.dropboxInvoicePreviewBackfill}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => setPendingBatch("init-missing")}>
          {t.invoice.dropboxInvoiceInitMissing}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => setPendingBatch("sync-missing")}>
          {t.invoice.dropboxInvoiceSyncMissing}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => setPendingBatch("retry-failed")}>
          {t.invoice.dropboxInvoiceRetryFailed}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => runBatch("verify-synced")}>
          {t.invoice.dropboxInvoiceVerifySynced}
        </Button>
      </div>

      {pendingBatch && (
        <ConfirmDialog
          title={t.invoice.dropboxInvoiceBackfillConfirmTitle}
          message={t.invoice.dropboxInvoiceBackfillConfirmMessage}
          isSubmitting={isLoading}
          onConfirm={() => runBatch(pendingBatch)}
          onClose={() => setPendingBatch(null)}
        />
      )}
    </Card>
  );
}
