"use client";

// Dropbox Integration Phase 7, Part 12/13 — Settings backfill panel for
// Claim document synchronization. Mirrors
// invoice-document-dropbox-sync-section.tsx's exact shape/behavior, shared
// between Motor and Non-Motor via injected server actions (same
// "injected action as prop" pattern used throughout this phase — see
// claim-documents-section.tsx) rather than duplicating the whole component.
import { useState } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ClaimDocumentBackfillPreview, ClaimDocumentBackfillBatchResult } from "@/lib/integrations/dropbox/motorClaimDocumentSync";

type PendingBatch = "init-missing" | "sync-missing" | "retry-failed" | null;

type BackfillPreviewResult = { success: true; preview: ClaimDocumentBackfillPreview } | { success: false; error: "FORBIDDEN" };
type BackfillBatchResult = { success: true; batch: ClaimDocumentBackfillBatchResult } | { success: false; error: "FORBIDDEN" };

export function ClaimDocumentDropboxSyncSection({
  isConnected,
  title,
  description,
  previewAction,
  initMissingAction,
  syncMissingAction,
  retryFailedAction,
  verifySyncedAction,
}: {
  isConnected: boolean;
  title: string;
  description: string;
  previewAction: () => Promise<BackfillPreviewResult>;
  initMissingAction: () => Promise<BackfillBatchResult>;
  syncMissingAction: () => Promise<BackfillBatchResult>;
  retryFailedAction: () => Promise<BackfillBatchResult>;
  verifySyncedAction: () => Promise<BackfillBatchResult>;
}) {
  const { t } = useLocale();
  const [preview, setPreview] = useState<ClaimDocumentBackfillPreview | null>(null);
  const [lastBatch, setLastBatch] = useState<ClaimDocumentBackfillBatchResult | null>(null);
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
    const result = await previewAction();
    setIsLoading(false);
    if (!result.success) {
      setError(t.claims.dropboxUnauthorized);
      return;
    }
    setPreview(result.preview);
  };

  const runBatch = async (mode: "init-missing" | "sync-missing" | "retry-failed" | "verify-synced") => {
    setError(null);
    setIsLoading(true);
    setPendingBatch(null);
    const action =
      mode === "init-missing" ? initMissingAction : mode === "sync-missing" ? syncMissingAction : mode === "retry-failed" ? retryFailedAction : verifySyncedAction;
    const result = await action();
    setIsLoading(false);
    if (!result.success) {
      setError(t.claims.dropboxUnauthorized);
      return;
    }
    setLastBatch(result.batch);
    const previewResult = await previewAction();
    if (previewResult.success) setPreview(previewResult.preview);
  };

  if (!isConnected) return null;

  return (
    <Card className="max-w-2xl p-6">
      <h2 className="section-title mb-2">{title}</h2>
      <p className="mb-4 text-sm text-zinc-500">{description}</p>

      {error && (
        <p role="alert" className="form-error mb-3">
          {error}
        </p>
      )}

      {preview && (
        <dl className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stat(t.claims.dropboxClaimTotalDocuments, preview.totalDocuments)}
          {stat(t.claims.dropboxClaimSynced, preview.synced)}
          {stat(t.claims.dropboxClaimPending, preview.pending)}
          {stat(t.claims.dropboxClaimFailed, preview.failed)}
          {stat(t.claims.dropboxClaimConflicts, preview.conflicts)}
          {stat(t.claims.dropboxClaimMissingLocalFiles, preview.missingLocalFiles)}
          {stat(t.claims.dropboxClaimLinkedToPolicy, preview.linkedToPolicy)}
          {stat(t.claims.dropboxClaimUsingClaimFallback, preview.usingClaimFallbackBusinessFile)}
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
          {t.claims.dropboxClaimPreviewBackfill}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => setPendingBatch("init-missing")}>
          {t.claims.dropboxClaimInitMissing}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => setPendingBatch("sync-missing")}>
          {t.claims.dropboxClaimSyncMissing}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => setPendingBatch("retry-failed")}>
          {t.claims.dropboxClaimRetryFailed}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => runBatch("verify-synced")}>
          {t.claims.dropboxClaimVerifySynced}
        </Button>
      </div>

      {pendingBatch && (
        <ConfirmDialog
          title={t.claims.dropboxClaimBackfillConfirmTitle}
          message={t.claims.dropboxClaimBackfillConfirmMessage}
          isSubmitting={isLoading}
          onConfirm={() => runBatch(pendingBatch)}
          onClose={() => setPendingBatch(null)}
        />
      )}
    </Card>
  );
}
