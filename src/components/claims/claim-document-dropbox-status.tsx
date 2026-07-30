"use client";

// Dropbox Integration Phase 7, Part 9 — per-row Dropbox status for the
// shared Claim documents table/cards (Motor and Non-Motor). Mirrors
// policy-document-dropbox-status.tsx's split shape (compact badge +
// separate expanded details) exactly. Shared between both Claim types via
// injected server actions (same "action prop" convention already used by
// claim-participants-modal.tsx's updateAction prop) rather than two
// duplicated ~110-line files.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, RefreshCw, ShieldCheck } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { IconButton } from "@/components/ui/icon-button";
import { Badge } from "@/components/ui/badge";
import { DropboxPathDisplay, STATE_TONE } from "@/components/dropbox/dropbox-path-display";
import type { ClaimDocumentDropboxInfo, DropboxPathState } from "@/components/claims/types";

export function ClaimDocumentDropboxBadge({
  dropbox,
  expanded,
  onToggle,
}: {
  dropbox: ClaimDocumentDropboxInfo;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useLocale();

  const stateLabel: Record<DropboxPathState, string> = {
    synced: t.dropbox.stateSynced,
    planned: t.dropbox.statePlanned,
    pending: t.dropbox.statePending,
    syncing: t.dropbox.stateSyncing,
    error: t.dropbox.stateError,
    conflict: t.dropbox.stateConflict,
    not_connected: t.dropbox.stateNotConnected,
    unavailable: t.dropbox.stateUnavailable,
  };

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
        {t.claims.dropboxDetailsButton}
      </button>
    </div>
  );
}

export type ClaimDocumentDropboxAction = (id: string) => Promise<{ success: boolean; forbidden?: boolean }>;

export function ClaimDocumentDropboxDetails({
  documentId,
  dropbox,
  isAdmin,
  retryAction,
  verifyAction,
}: {
  documentId: string;
  dropbox: ClaimDocumentDropboxInfo;
  isAdmin: boolean;
  retryAction: ClaimDocumentDropboxAction;
  verifyAction: ClaimDocumentDropboxAction;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const dateTimeFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  const run = async (action: ClaimDocumentDropboxAction) => {
    setIsBusy(true);
    await action(documentId);
    setIsBusy(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <DropboxPathDisplay label={t.claims.dropboxDocumentPath} view={dropbox.view} className="w-full" />
      {dropbox.lastSyncedAt && (
        <div className="text-xs text-secondary">
          {t.claims.dropboxLastSynchronized}: {dateTimeFormatter.format(new Date(dropbox.lastSyncedAt))}
        </div>
      )}
      {isAdmin && dropbox.view.state !== "not_connected" && (
        <div className="flex items-center gap-1">
          <IconButton title={t.claims.dropboxRetrySync} disabled={isBusy} onClick={() => run(retryAction)}>
            <RefreshCw size={14} />
          </IconButton>
          {dropbox.view.state !== "pending" && dropbox.view.state !== "planned" && (
            <IconButton title={t.claims.dropboxVerifyFile} disabled={isBusy} onClick={() => run(verifyAction)}>
              <ShieldCheck size={14} />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}
