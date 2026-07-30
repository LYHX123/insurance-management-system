"use client";

// Dropbox Integration Phase 5, Part 12 — Settings backfill panel for
// Policy document synchronization. Mirrors quotation-dropbox-sync-section
// .tsx's exact shape/behavior.
import { useState } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  previewPolicyDocumentBackfillAction,
  initMissingPolicyDocumentMetadataAction,
  syncMissingPolicyDocumentsBackfillAction,
  retryFailedPolicyDocumentsAction,
  verifySyncedPolicyDocumentsAction,
} from "@/app/(app)/settings/policyDocumentDropboxBackfillActions";
import type { PolicyDocumentBackfillPreview, PolicyDocumentBackfillBatchResult } from "@/lib/integrations/dropbox/policyDocumentSync";

type PendingBatch = "init-missing" | "sync-missing" | "retry-failed" | null;

export function PolicyDocumentDropboxSyncSection({ isConnected }: { isConnected: boolean }) {
  const { t } = useLocale();
  const [preview, setPreview] = useState<PolicyDocumentBackfillPreview | null>(null);
  const [lastBatch, setLastBatch] = useState<PolicyDocumentBackfillBatchResult | null>(null);
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
    const result = await previewPolicyDocumentBackfillAction();
    setIsLoading(false);
    if (!result.success) {
      setError(t.policy.dropboxUnauthorized);
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
        ? initMissingPolicyDocumentMetadataAction
        : mode === "sync-missing"
          ? syncMissingPolicyDocumentsBackfillAction
          : mode === "retry-failed"
            ? retryFailedPolicyDocumentsAction
            : verifySyncedPolicyDocumentsAction;
    const result = await action();
    setIsLoading(false);
    if (!result.success) {
      setError(t.policy.dropboxUnauthorized);
      return;
    }
    setLastBatch(result.batch);
    const previewResult = await previewPolicyDocumentBackfillAction();
    if (previewResult.success) setPreview(previewResult.preview);
  };

  if (!isConnected) return null;

  return (
    <Card className="max-w-2xl p-6">
      <h2 className="section-title mb-2">{t.policy.dropboxPolicySyncSectionTitle}</h2>
      <p className="mb-4 text-sm text-zinc-500">{t.policy.dropboxPolicySyncSectionDescription}</p>

      {error && (
        <p role="alert" className="form-error mb-3">
          {error}
        </p>
      )}

      {preview && (
        <dl className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stat(t.policy.dropboxPolicyTotalDocuments, preview.totalDocuments)}
          {stat(t.policy.dropboxPolicySynced, preview.synced)}
          {stat(t.policy.dropboxPolicyPending, preview.pending)}
          {stat(t.policy.dropboxPolicyFailed, preview.failed)}
          {stat(t.policy.dropboxPolicyConflicts, preview.conflicts)}
          {stat(t.policy.dropboxPolicyMissingLocalFiles, preview.missingLocalFiles)}
          {stat(t.policy.dropboxPolicyLinkedToQuotationBusinessFile, preview.linkedToQuotationBusinessFile)}
          {stat(t.policy.dropboxPolicyUsingFallbackBusinessFile, preview.usingPolicyFallbackBusinessFile)}
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
          {t.policy.dropboxPolicyPreviewBackfill}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => setPendingBatch("init-missing")}>
          {t.policy.dropboxPolicyInitMissingMetadata}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => setPendingBatch("sync-missing")}>
          {t.policy.dropboxPolicySyncMissing}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => setPendingBatch("retry-failed")}>
          {t.policy.dropboxPolicyRetryFailed}
        </Button>
        <Button type="button" variant="secondary" disabled={isLoading} onClick={() => runBatch("verify-synced")}>
          {t.policy.dropboxPolicyVerifySynced}
        </Button>
      </div>

      {pendingBatch && (
        <ConfirmDialog
          title={t.policy.dropboxPolicyBackfillConfirmTitle}
          message={t.policy.dropboxPolicyBackfillConfirmMessage}
          isSubmitting={isLoading}
          onConfirm={() => runBatch(pendingBatch)}
          onClose={() => setPendingBatch(null)}
        />
      )}
    </Card>
  );
}
