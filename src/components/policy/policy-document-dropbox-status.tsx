"use client";

// Dropbox Integration Phase 5, Part 8 — per-row Dropbox status for the
// shared Policy documents table (MotorDocumentsTab, reused by all four
// categories). Split into two pieces so the collapsed table row stays
// compact (PolicyDocumentDropboxBadge: a status Badge + standardized
// filename + a details toggle) while the full path, sync metadata, and
// admin actions only render once expanded, in a separate full-width row
// (PolicyDocumentDropboxDetails) — see motor-documents-tab.tsx. Mirrors
// customers/document-dropbox-status.tsx's shape.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, RefreshCw, ShieldCheck, UploadCloud } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { IconButton } from "@/components/ui/icon-button";
import { Badge } from "@/components/ui/badge";
import { DropboxPathDisplay, STATE_TONE, useDropboxStateLabels } from "@/components/dropbox/dropbox-path-display";
import { retryPolicyDocumentSyncAction, reuploadPolicyDocumentAction, verifyPolicyDocumentAction } from "@/app/(app)/policy/dropboxActions";
import type { PolicyDocumentDropboxInfo } from "@/components/policy/types";

export function PolicyDocumentDropboxBadge({
  dropbox,
  expanded,
  onToggle,
}: {
  dropbox: PolicyDocumentDropboxInfo;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useLocale();
  const stateLabel = useDropboxStateLabels();

  return (
    <div className="flex flex-col items-start gap-1">
      <Badge tone={STATE_TONE[dropbox.view.state]}>{stateLabel[dropbox.view.state]}</Badge>
      {dropbox.standardizedFileName && (
        <span className="max-w-[180px] truncate text-xs text-zinc-500" title={dropbox.standardizedFileName}>
          {dropbox.standardizedFileName}
        </span>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {t.policy.dropboxDetailsButton}
      </button>
    </div>
  );
}

export function PolicyDocumentDropboxDetails({
  policyDocumentId,
  dropbox,
  isAdmin,
}: {
  policyDocumentId: string;
  dropbox: PolicyDocumentDropboxInfo;
  isAdmin: boolean;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const dateTimeFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  const run = async (action: (id: string) => Promise<{ success: boolean; forbidden?: boolean }>) => {
    setIsBusy(true);
    await action(policyDocumentId);
    setIsBusy(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <DropboxPathDisplay label={t.policy.dropboxDocumentPath} view={dropbox.view} className="w-full" />
      {dropbox.lastSyncedAt && (
        <div className="text-xs text-secondary">
          {t.policy.dropboxLastSynchronized}: {dateTimeFormatter.format(new Date(dropbox.lastSyncedAt))}
        </div>
      )}
      {isAdmin && dropbox.view.state !== "not_connected" && (
        <div className="flex items-center gap-1">
          <IconButton
            title={dropbox.view.state === "synced" ? t.policy.dropboxReuploadDocument : t.policy.dropboxRetryDocumentSync}
            disabled={isBusy}
            onClick={() => run(dropbox.view.state === "synced" ? reuploadPolicyDocumentAction : retryPolicyDocumentSyncAction)}
          >
            {dropbox.view.state === "synced" ? <UploadCloud size={14} /> : <RefreshCw size={14} />}
          </IconButton>
          {dropbox.view.state !== "pending" && dropbox.view.state !== "planned" && (
            <IconButton title={t.policy.dropboxVerifyDocument} disabled={isBusy} onClick={() => run(verifyPolicyDocumentAction)}>
              <ShieldCheck size={14} />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}
