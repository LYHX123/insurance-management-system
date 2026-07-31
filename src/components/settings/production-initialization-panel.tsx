"use client";

// Settings > System Preferences — "Production Initialization" danger zone.
// Only ever rendered when the server has confirmed (a) the
// ENABLE_PRODUCTION_INITIALIZATION flag is "true" and (b) the current
// session is an Admin — see src/app/(app)/settings/page.tsx. The API routes
// underneath independently re-verify both on every request; this component
// never trusts its own visibility as a security boundary.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut, getSession } from "next-auth/react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CONFIRMATION_TEXT, PRODUCTION_INIT_REASONS, type ProductionInitReason } from "@/lib/productionInit/constants";
import type { ProductionInitPreview, ProductionInitStatusInfo, ProductionInitDeleteCounts } from "@/lib/productionInit/types";
import type { ExecuteProductionInitializationSuccess } from "@/lib/productionInit/execute";

const DELETE_ROW_KEYS: { key: keyof ProductionInitDeleteCounts; labelKey: string }[] = [
  { key: "customers", labelKey: "willDeleteCustomers" },
  { key: "quotationCases", labelKey: "willDeleteQuotations" },
  { key: "policies", labelKey: "willDeletePolicies" },
  { key: "invoices", labelKey: "willDeleteInvoices" },
  { key: "tasks", labelKey: "willDeleteTasks" },
  { key: "motorClaims", labelKey: "willDeleteMotorClaims" },
  { key: "nonMotorClaims", labelKey: "willDeleteNonMotorClaims" },
  { key: "manualLedgerEntries", labelKey: "willDeleteManualLedger" },
  { key: "policyImportBatches", labelKey: "willDeleteImportBatches" },
  { key: "businessDocumentRecordsTotal", labelKey: "willDeleteDocuments" },
  { key: "dropboxMappingRecords", labelKey: "willDeleteDropboxMappings" },
  { key: "numberCounterRows", labelKey: "willDeleteCounters" },
];

const PRESERVE_LABEL_KEYS = [
  "willPreserveUsers",
  "willPreserveSettings",
  "willPreserveReminders",
  "willPreserveDropbox",
  "willPreserveInsuranceTypes",
  "willPreserveLedgerCategories",
  "willPreserveMigrationHistory",
  "willPreserveTemplates",
  "willPreserveRealDropboxFiles",
  "willPreserveAuditHistory",
] as const;

type ErrorCode = "DISABLED" | "FORBIDDEN" | "INVALID_CONFIRMATION" | "BACKUP_NOT_CONFIRMED" | "INVALID_REASON" | "ALREADY_RUNNING" | "COOLDOWN_ACTIVE" | "TRANSACTION_FAILED" | "GENERIC";

// Reason label i18n keys — src/i18n/dictionaries/{en,zh}.ts define
// t.productionInit.reasonOptions.<REASON> for the dropdown and for
// localizing a past run's stored reason.
const REASON_LABEL_KEYS: Record<ProductionInitReason, string> = {
  PRODUCTION_GO_LIVE: "reasonProductionGoLive",
  SYSTEM_RESET: "reasonSystemReset",
  TESTING: "reasonTesting",
  OTHER: "reasonOther",
};

export function ProductionInitializationPanel({ initialStatus }: { initialStatus: ProductionInitStatusInfo }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  const [status, setStatus] = useState<ProductionInitStatusInfo>(initialStatus);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [preview, setPreview] = useState<ProductionInitPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [typedText, setTypedText] = useState("");
  const [reason, setReason] = useState<ProductionInitReason | "">("");
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executeError, setExecuteError] = useState<ErrorCode | null>(null);
  const [executeResult, setExecuteResult] = useState<ExecuteProductionInitializationSuccess | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);

  const errorLabel: Record<ErrorCode, string> = {
    DISABLED: t.productionInit.errorDisabled,
    FORBIDDEN: t.productionInit.errorForbidden,
    INVALID_CONFIRMATION: t.productionInit.errorInvalidConfirmation,
    BACKUP_NOT_CONFIRMED: t.productionInit.errorBackupNotConfirmed,
    INVALID_REASON: t.productionInit.errorInvalidReason,
    ALREADY_RUNNING: t.productionInit.errorAlreadyRunning,
    COOLDOWN_ACTIVE: t.productionInit.errorCooldownActive,
    TRANSACTION_FAILED: t.productionInit.errorTransactionFailed,
    GENERIC: t.productionInit.errorGeneric,
  };

  const statusLabel = {
    RUNNING: t.productionInit.statusRunning,
    SUCCESS: t.productionInit.statusSuccess,
    FAILED: t.productionInit.statusFailed,
  };

  const blocked = status.currentlyRunning || !!status.cooldownUntil;

  const openConfirmModal = async () => {
    setExecuteError(null);
    setExecuteResult(null);
    setBackupConfirmed(false);
    setTypedText("");
    setReason("");
    setShowConfirmModal(true);
    setPreview(null);
    setPreviewError(false);
    setPreviewLoading(true);
    try {
      // Part 6: the panel must refresh Preview immediately before showing
      // the confirm step, never reuse a stale count from an earlier load.
      const res = await fetch("/api/settings/production-initialization/preview");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setPreview(data.preview as ProductionInitPreview);
      setStatus(data.status as ProductionInitStatusInfo);
    } catch {
      setPreviewError(true);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closeConfirmModal = () => {
    if (executing) return; // Part 8: never allow closing while a request is in flight.
    setShowConfirmModal(false);
  };

  const canSubmit = backupConfirmed && typedText === CONFIRMATION_TEXT && reason !== "" && !!preview && !previewLoading;

  const handleFinalConfirm = async () => {
    setShowFinalConfirm(false);
    setExecuting(true);
    setExecuteError(null);
    try {
      const res = await fetch("/api/settings/production-initialization/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationText: typedText, backupConfirmed, reason }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setExecuteError((data.error as ErrorCode) ?? "GENERIC");
        setExecuting(false);
        return;
      }
      // Only reachable once the server has already committed the deletion
      // transaction and updated the audit log to SUCCESS — the forced
      // logout below (triggered by the user clicking "Continue to Login"
      // on this success screen) can therefore never happen before that.
      setExecuteResult(data as ExecuteProductionInitializationSuccess);
      setExecuting(false);
      setShowConfirmModal(false);
      // Part 11/16 — clear the Next.js Router Cache and re-fetch every
      // Server Component on this page (this project has no React Query/SWR;
      // router.refresh() is this stack's equivalent cache-invalidation
      // mechanism). Session/Dropbox connection are untouched by this.
      router.refresh();
      const statusRes = await fetch("/api/settings/production-initialization/preview");
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setStatus(statusData.status as ProductionInitStatusInfo);
      }
    } catch {
      setExecuteError("GENERIC");
      setExecuting(false);
    }
  };

  // Forced logout — only ever offered on the post-SUCCESS screen (see
  // executeResult-gated rendering below), so this can never run before the
  // deletion transaction committed and the audit log was updated to
  // SUCCESS. Uses the app's real, existing sign-out flow (next-auth's
  // signOut, the same one src/components/topbar.tsx uses) — never a bare
  // router.push("/login"), which would leave the server session and auth
  // cookie intact. Destroys the server session first, verifies it's
  // actually gone, and only then does a full page navigation (never SPA
  // client-side routing) so every component's in-memory state, the Next.js
  // Router Cache, and the browser's history entry for this page are all
  // replaced — Back can no longer land on a stale authenticated view of
  // the now-cleared business data.
  const handleContinueToLogin = async () => {
    setLoggingOut(true);
    setLogoutFailed(false);
    try {
      await signOut({ redirect: false });
      const session = await getSession();
      if (session) throw new Error("session still active after signOut");
      window.location.replace("/login");
    } catch {
      // Part 5: a failed logout never changes the initialization result —
      // it already succeeded and stays SUCCESS. Never retried automatically.
      setLoggingOut(false);
      setLogoutFailed(true);
    }
  };

  return (
    <Card className="border-2 border-red-300 bg-red-50/40">
      <div className="mb-3 flex items-center gap-2">
        <ShieldAlert size={20} className="text-red-600" />
        <h2 className="section-title text-red-800">{t.productionInit.title}</h2>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-control border border-red-200 bg-white p-3 text-sm text-red-800">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <p>{t.productionInit.dangerZoneWarning}</p>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-zinc-800">{t.productionInit.willDeleteTitle}</h3>
          <ul className="list-inside list-disc text-sm text-zinc-600">
            <li>{t.productionInit.willDeleteCustomers}</li>
            <li>{t.productionInit.willDeleteQuotations}</li>
            <li>{t.productionInit.willDeletePolicies}</li>
            <li>{t.productionInit.willDeleteInvoices}</li>
            <li>{t.productionInit.willDeleteTasks}</li>
            <li>{t.productionInit.willDeleteMotorClaims}</li>
            <li>{t.productionInit.willDeleteNonMotorClaims}</li>
            <li>{t.productionInit.willDeleteManualLedger}</li>
            <li>{t.productionInit.willDeleteImportBatches}</li>
            <li>{t.productionInit.willDeleteDocuments}</li>
            <li>{t.productionInit.willDeleteDropboxMappings}</li>
            <li>{t.productionInit.willDeleteCounters}</li>
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-zinc-800">{t.productionInit.willPreserveTitle}</h3>
          <ul className="list-inside list-disc text-sm text-zinc-600">
            {PRESERVE_LABEL_KEYS.map((key) => (
              <li key={key}>{t.productionInit[key]}</li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mb-4 text-sm font-medium text-amber-800">{t.productionInit.dropboxFilesNotDeletedNotice}</p>
      <p className="mb-4 text-xs text-secondary">{t.productionInit.backupReminder}</p>

      <Card className="mb-4 bg-white">
        <h3 className="mb-2 text-sm font-semibold text-zinc-800">{t.productionInit.lastInitialization}</h3>
        {status.lastRun ? (
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            <div>
              <dt className="text-secondary">{t.productionInit.operator}</dt>
              <dd className="text-zinc-800">{status.lastRun.executedByName}</dd>
            </div>
            <div>
              <dt className="text-secondary">{t.productionInit.startedAt}</dt>
              <dd className="text-zinc-800">{dateFormatter.format(new Date(status.lastRun.startedAt))}</dd>
            </div>
            <div>
              <dt className="text-secondary">{t.productionInit.status}</dt>
              <dd>
                <Badge tone={status.lastRun.status === "SUCCESS" ? "success" : status.lastRun.status === "FAILED" ? "danger" : "brand"}>
                  {statusLabel[status.lastRun.status]}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-secondary">{t.productionInit.completedAt}</dt>
              <dd className="text-zinc-800">{status.lastRun.completedAt ? dateFormatter.format(new Date(status.lastRun.completedAt)) : "—"}</dd>
            </div>
            <div>
              <dt className="text-secondary">{t.productionInit.reason}</dt>
              <dd className="text-zinc-800">
                {status.lastRun.reason && status.lastRun.reason in REASON_LABEL_KEYS
                  ? t.productionInit[REASON_LABEL_KEYS[status.lastRun.reason as ProductionInitReason] as keyof typeof t.productionInit]
                  : t.productionInit.reasonNotRecorded}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-secondary">{t.productionInit.lastInitializationNone}</p>
        )}
      </Card>

      {executeResult && (
        <Card className="mb-4 border-emerald-300 bg-emerald-50">
          <p className="font-medium text-emerald-800">{t.productionInit.successTitle}</p>
          <ul className="mt-2 list-inside list-disc text-sm text-emerald-800">
            <li>{t.productionInit.successUsersRetained}</li>
            <li>{t.productionInit.successSettingsRetained}</li>
            <li>{t.productionInit.successDropboxRetained} ({executeResult.dropboxConnectionStatus})</li>
            <li>{t.productionInit.successDropboxFilesUntouched}</li>
            <li>
              {t.productionInit.completedAt}: {dateFormatter.format(new Date(executeResult.completedAt))}
            </li>
          </ul>

          {logoutFailed && <p className="mt-3 text-sm font-medium text-amber-800">{t.productionInit.logoutFailedNotice}</p>}

          <div className="mt-3">
            <Button variant="secondary" onClick={handleContinueToLogin} disabled={loggingOut}>
              {loggingOut ? t.productionInit.processing : t.productionInit.continueToLogin}
            </Button>
          </div>
        </Card>
      )}

      {blocked && (
        <p className="mb-3 text-sm text-amber-800">
          {status.currentlyRunning ? t.productionInit.currentlyRunningNotice : t.productionInit.cooldownActiveNotice}
          {status.cooldownUntil && !status.currentlyRunning && (
            <> {t.productionInit.nextAvailable}: {dateFormatter.format(new Date(status.cooldownUntil))}</>
          )}
        </p>
      )}

      <Button variant="destructive" onClick={openConfirmModal} disabled={blocked}>
        <ShieldAlert size={16} />
        {t.productionInit.startButton}
      </Button>

      {showConfirmModal && (
        <Modal title={t.productionInit.confirmModalTitle} onClose={closeConfirmModal} width="lg">
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-2 rounded-control border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>{t.productionInit.dangerZoneWarning}</p>
            </div>

            {previewLoading && <p className="text-sm text-secondary">{t.productionInit.previewLoading}</p>}
            {previewError && <p className="text-sm text-red-600">{t.productionInit.previewFailed}</p>}

            {preview && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-zinc-800">{t.productionInit.estimatedDeleteCounts}</h4>
                  <dl className="flex flex-col gap-1 text-sm">
                    {DELETE_ROW_KEYS.map((row) => (
                      <div key={row.key} className="flex items-center justify-between border-b border-zinc-100 py-1">
                        <dt className="text-zinc-600">{t.productionInit[row.labelKey as keyof typeof t.productionInit]}</dt>
                        <dd className="font-medium text-zinc-800">
                          {preview.toDelete[row.key]} {t.productionInit.records}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-zinc-800">{t.productionInit.preservedSummaryTitle}</h4>
                  <ul className="list-inside list-disc text-sm text-zinc-600">
                    {PRESERVE_LABEL_KEYS.map((key) => (
                      <li key={key}>{t.productionInit[key]}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <p className="text-sm font-medium text-amber-800">{t.productionInit.dropboxFilesNotDeletedNotice}</p>

            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">{t.productionInit.reason}</label>
              <Select value={reason} onChange={(e) => setReason(e.target.value as ProductionInitReason)} disabled={executing}>
                <option value="">{t.productionInit.reasonSelectPlaceholder}</option>
                {PRODUCTION_INIT_REASONS.map((value) => (
                  <option key={value} value={value}>
                    {t.productionInit[REASON_LABEL_KEYS[value] as keyof typeof t.productionInit]}
                  </option>
                ))}
              </Select>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={backupConfirmed}
                onChange={(e) => setBackupConfirmed(e.target.checked)}
                disabled={executing}
                className="mt-0.5 h-4 w-4 rounded border-zinc-300"
              />
              {t.productionInit.backupCheckboxLabel}
            </label>

            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">{t.productionInit.confirmationInputLabel}</label>
              <Input
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                placeholder={CONFIRMATION_TEXT}
                disabled={executing}
                autoComplete="off"
                spellCheck={false}
              />
              {typedText.length > 0 && typedText !== CONFIRMATION_TEXT && (
                <p className="mt-1 text-xs text-red-600">{t.productionInit.confirmationMismatchHint}</p>
              )}
            </div>

            {executeError && <p className="text-sm text-red-600">{errorLabel[executeError]}</p>}

            {executing && <p className="text-sm font-medium text-zinc-700">{t.productionInit.processing}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeConfirmModal} disabled={executing}>
                {t.common.cancel}
              </Button>
              <Button variant="destructive" onClick={() => setShowFinalConfirm(true)} disabled={!canSubmit || executing}>
                {executing ? t.productionInit.processing : t.productionInit.finalConfirmButton}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {showFinalConfirm && (
        <ConfirmDialog
          title={t.productionInit.finalConfirmTitle}
          message={t.productionInit.finalConfirmMessage}
          isSubmitting={executing}
          onConfirm={handleFinalConfirm}
          onClose={() => setShowFinalConfirm(false)}
        />
      )}
    </Card>
  );
}
