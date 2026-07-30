"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import {
  runNamespaceDiagnosticAction,
  runDestinationWriteAccessTestAction,
  runCopyPreviewAction,
  startCopyPhaseAction,
  pauseCopyPhaseAction,
  runCopyBatchAction,
  runVerificationBatchAction,
  activateDestinationNamespaceAction,
} from "@/app/(app)/settings/dropboxMigrationActions";
import type { DropboxMigrationNamespaceView } from "@/lib/integrations/dropbox/migration/config";
import type { DropboxMigrationJobView } from "@/lib/integrations/dropbox/migration/types";

const ERROR_KEY: Record<string, string> = {
  CONFIGURATION_MISSING: "dropboxConfigIncomplete",
  TOKEN_REVOKED: "dropboxAuthExpiredOrRevoked",
  FORBIDDEN: "dropboxUnauthorized",
  NAMESPACE_NOT_RESOLVED: "dropboxMigrationDestinationNotResolved",
};

function statusLabel(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (["ACTIVE", "COMPLETED", "VERIFIED", "COPY_COMPLETE", "WRITE_TEST_PASSED", "READY_TO_ACTIVATE"].includes(status)) return "success";
  if (["FAILED", "COPY_FAILED", "VERIFICATION_FAILED"].includes(status)) return "danger";
  if (["NOT_STARTED"].includes(status)) return "neutral";
  return "warning";
}

export function DropboxMigrationPanel({
  namespace,
  latestJob,
}: {
  namespace: DropboxMigrationNamespaceView;
  latestJob: DropboxMigrationJobView | null;
}) {
  const { t } = useLocale();
  const router = useRouter();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [showWriteTestConfirm, setShowWriteTestConfirm] = useState(false);
  const [writeTestInput, setWriteTestInput] = useState("");

  const [showActivateConfirm, setShowActivateConfirm] = useState(false);
  const [activateInput, setActivateInput] = useState("");
  const [backupConfirmed, setBackupConfirmed] = useState(false);

  const [copyProgress, setCopyProgress] = useState<{ succeeded: number; failed: number; remaining: number } | null>(null);
  const [verifyProgress, setVerifyProgress] = useState<{ verified: number; failed: number; remaining: number } | null>(null);
  const stopRequested = useRef(false);

  const showError = (code: string) => {
    setMessage(null);
    setError(t.settings[(ERROR_KEY[code] ?? "dropboxUnknownError") as keyof typeof t.settings] ?? code);
  };

  const jobId = latestJob?.id ?? null;
  const status = latestJob?.status ?? "NOT_STARTED";

  const handleDiagnostic = async () => {
    setError(null);
    setMessage(null);
    setBusy("diagnostic");
    const result = await runNamespaceDiagnosticAction();
    setBusy(null);
    if (!result.success) return showError(result.error);
    setMessage(t.settings.dropboxMigrationDiagnosticSuccess);
    router.refresh();
  };

  const handleWriteTest = async () => {
    setError(null);
    setMessage(null);
    setBusy("write-test");
    const result = await runDestinationWriteAccessTestAction(writeTestInput);
    setBusy(null);
    setShowWriteTestConfirm(false);
    setWriteTestInput("");
    if (!result.success) return showError(result.error);
    setMessage(t.settings.dropboxMigrationWriteTestSuccess);
    router.refresh();
  };

  const handlePreview = async () => {
    setError(null);
    setMessage(null);
    setBusy("preview");
    const result = await runCopyPreviewAction();
    setBusy(null);
    if (!result.success) return showError(result.error);
    const key =
      result.result === "SAFE_TO_CONTINUE"
        ? "dropboxMigrationPreviewSafe"
        : result.result === "BLOCKED_BY_CONFLICT"
        ? "dropboxMigrationPreviewBlockedConflict"
        : result.result === "BLOCKED_BY_PERMISSION"
        ? "dropboxMigrationPreviewBlockedPermission"
        : result.result === "BLOCKED_BY_STRUCTURE"
        ? "dropboxMigrationPreviewBlockedStructure"
        : "dropboxMigrationPreviewManualReview";
    setMessage(t.settings[key as keyof typeof t.settings]);
    router.refresh();
  };

  const handleStartOrResumeCopy = async () => {
    if (!jobId) return;
    setError(null);
    setMessage(null);
    setBusy("copy");
    stopRequested.current = false;

    if (status === "PREVIEW_READY" || status === "READY_FOR_COPY") {
      const started = await startCopyPhaseAction(jobId);
      if (!started.success) {
        setBusy(null);
        return showError(started.error);
      }
    }

    let done = false;
    while (!done && !stopRequested.current) {
      const result = await runCopyBatchAction(jobId);
      if (!result.success) {
        setBusy(null);
        return showError(result.error);
      }
      setCopyProgress({ succeeded: result.succeeded, failed: result.failed, remaining: result.remainingFolders + result.remainingFiles });
      done = result.phaseComplete;
    }
    setBusy(null);
    router.refresh();
  };

  const handlePauseCopy = async () => {
    if (!jobId) return;
    stopRequested.current = true;
    await pauseCopyPhaseAction(jobId);
    setBusy(null);
    router.refresh();
  };

  const handleVerify = async () => {
    if (!jobId) return;
    setError(null);
    setMessage(null);
    setBusy("verify");

    let remaining = Infinity;
    while (remaining > 0) {
      const result = await runVerificationBatchAction(jobId);
      if (!result.success) {
        setBusy(null);
        return showError(result.error);
      }
      setVerifyProgress({ verified: result.verified, failed: result.failed, remaining: result.remaining });
      remaining = result.remaining;
      if (result.processed === 0) break; // nothing left to verify this pass
    }
    setBusy(null);
    router.refresh();
  };

  const handleActivate = async () => {
    if (!jobId) return;
    setError(null);
    setMessage(null);
    setBusy("activate");
    const result = await activateDestinationNamespaceAction(jobId, activateInput, backupConfirmed);
    setBusy(null);
    setShowActivateConfirm(false);
    setActivateInput("");
    setBackupConfirmed(false);
    if (!result.success) return showError(result.error);
    setMessage(t.settings.dropboxMigrationActivateSuccess);
    router.refresh();
  };

  const isActive = namespace.activeNamespaceMode === "TEAM_FOLDER_NAMESPACE";

  return (
    <Card className="max-w-2xl p-6">
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="section-title">{t.settings.dropboxMigrationSectionTitle}</h2>
          <p className="mt-1 text-sm text-zinc-500">{t.settings.dropboxMigrationSectionDescription}</p>
        </div>

        {namespace.migrationLocked && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <p>{t.settings.dropboxMigrationLockedNotice}</p>
            <p className="mt-1">Dropbox 存储位置正在迁移。业务数据已保存，Dropbox 同步将在迁移完成后自动恢复。</p>
          </div>
        )}

        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-secondary">{t.settings.dropboxMigrationCurrentLocationLabel}</dt>
            <dd className="font-medium text-zinc-800">
              {isActive ? t.settings.dropboxMigrationLegacySourceLabel : t.settings.dropboxMigrationCurrentLocationValue}
            </dd>
            <dd className="text-xs text-zinc-500">{latestJob?.sourceRootPath ?? "/Insurance Management System"}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.settings.dropboxMigrationTargetLocationLabel}</dt>
            <dd className="font-medium text-zinc-800">{namespace.destinationNamespaceDisplayName ?? t.settings.dropboxMigrationTargetLocationValue}</dd>
            <dd className="text-xs text-zinc-500">{namespace.destinationRootFolder}</dd>
          </div>
          <div>
            <dt className="text-secondary">{t.settings.dropboxMigrationStatusLabel}</dt>
            <dd>
              <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
            </dd>
          </div>
        </dl>

        {error && <p role="alert" className="form-error">{error}</p>}
        {message && <p className="text-sm text-emerald-700">{message}</p>}

        {latestJob?.previewSummary && (
          <div className="rounded-md border border-zinc-200 p-3 text-sm text-zinc-600">{latestJob.previewSummary}</div>
        )}

        {copyProgress && (
          <p className="text-xs text-zinc-500">
            {t.settings.dropboxMigrationCopyProgress}: {copyProgress.succeeded} succeeded, {copyProgress.failed} failed, {copyProgress.remaining} remaining
          </p>
        )}
        {verifyProgress && (
          <p className="text-xs text-zinc-500">
            {t.settings.dropboxMigrationVerifyProgress}: {verifyProgress.verified} verified, {verifyProgress.failed} failed, {verifyProgress.remaining} remaining
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={handleDiagnostic} disabled={busy !== null}>
            {t.settings.dropboxMigrationRunDiagnostic}
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={() => setShowWriteTestConfirm(true)}
            disabled={busy !== null || !namespace.destinationConfigured}
          >
            {t.settings.dropboxMigrationTestWriteAccess}
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={handlePreview}
            disabled={busy !== null || status === "NOT_STARTED" || status === "DIAGNOSTIC_COMPLETE" || status === "WRITE_TEST_REQUIRED"}
          >
            {t.settings.dropboxMigrationPreviewCopy}
          </Button>

          {status === "COPYING" ? (
            <Button type="button" variant="secondary" onClick={handlePauseCopy} disabled={busy !== "copy"}>
              {t.settings.dropboxMigrationPauseCopy}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleStartOrResumeCopy}
              disabled={
                busy !== null ||
                !jobId ||
                !["PREVIEW_READY", "READY_FOR_COPY", "COPY_PAUSED", "COPY_FAILED"].includes(status) ||
                (latestJob?.previewResult !== "SAFE_TO_CONTINUE" && latestJob?.previewResult !== "MANUAL_REVIEW_REQUIRED")
              }
            >
              {status === "COPY_PAUSED" || status === "COPY_FAILED" ? t.settings.dropboxMigrationResumeCopy : t.settings.dropboxMigrationStartCopy}
            </Button>
          )}

          <Button
            type="button"
            variant="secondary"
            onClick={handleVerify}
            disabled={busy !== null || !jobId || !["COPY_COMPLETE", "VERIFYING", "VERIFICATION_FAILED"].includes(status)}
          >
            {t.settings.dropboxMigrationVerifyCopy}
          </Button>

          <Button
            type="button"
            onClick={() => setShowActivateConfirm(true)}
            disabled={busy !== null || !jobId || status !== "READY_TO_ACTIVATE"}
          >
            {t.settings.dropboxMigrationActivate}
          </Button>
        </div>
      </div>

      {showWriteTestConfirm && (
        <Modal title={t.settings.dropboxMigrationWriteTestConfirmTitle} onClose={() => setShowWriteTestConfirm(false)}>
          <p className="text-body">{t.settings.dropboxMigrationWriteTestConfirmMessage}</p>
          <div className="mt-4">
            <label className="text-sm text-secondary">{t.settings.dropboxMigrationWriteTestConfirmInputLabel}</label>
            <Input value={writeTestInput} onChange={(e) => setWriteTestInput(e.target.value)} className="mt-1" />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowWriteTestConfirm(false)} disabled={busy === "write-test"}>
              {t.common.cancel}
            </Button>
            <Button variant="destructive" onClick={handleWriteTest} disabled={busy === "write-test" || writeTestInput.trim() !== "TEST WRITE ACCESS"}>
              {t.common.confirm}
            </Button>
          </div>
        </Modal>
      )}

      {showActivateConfirm && (
        <Modal title={t.settings.dropboxMigrationActivateConfirmTitle} onClose={() => setShowActivateConfirm(false)}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700">
            <li>The Dropbox root location will change.</li>
            <li>Synchronization will be temporarily paused.</li>
            <li>Existing file IDs and paths will be revalidated.</li>
            <li>Do not upload new Dropbox files during migration.</li>
          </ul>
          <label className="mt-4 flex items-start gap-2 text-sm text-zinc-700">
            <input type="checkbox" checked={backupConfirmed} onChange={(e) => setBackupConfirmed(e.target.checked)} className="mt-1" />
            {t.settings.dropboxMigrationActivateBackupCheckboxLabel}
          </label>
          <div className="mt-4">
            <p className="text-sm text-secondary">{t.settings.dropboxMigrationActivateInputLabel}</p>
            <p className="text-xs text-zinc-500">请输入 ACTIVATE ENFB SYSTEM FILE 以确认迁移。</p>
            <Input value={activateInput} onChange={(e) => setActivateInput(e.target.value)} className="mt-1" />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowActivateConfirm(false)} disabled={busy === "activate"}>
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={handleActivate}
              disabled={busy === "activate" || !backupConfirmed || activateInput.trim() !== "ACTIVATE ENFB SYSTEM FILE"}
            >
              {t.common.confirm}
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
