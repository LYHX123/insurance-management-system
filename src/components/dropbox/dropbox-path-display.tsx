"use client";

// Dropbox Integration Phase 5, Part 2 — the ONE reusable Dropbox path
// display used by Customer/Quotation/Policy (and, in the future, Invoice/
// Claim) detail pages. Renders a safe display-path view model (never a raw
// Dropbox id/token/local path — see pathDisplay.ts's DropboxPathView),
// distinguishes planned vs. synchronized paths with a badge, and offers
// Copy Path / Open in Dropbox. Pure presentation: never builds a path
// itself from browser input (Part 2, requirement 12) — the `view` prop is
// always a server-computed DropboxPathView.
import { useState } from "react";
import { Copy, ExternalLink, Check, ChevronDown, ChevronRight } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { DropboxPathView, DropboxPathState } from "@/lib/integrations/dropbox/pathDisplay";

// Exported so compact status badges elsewhere (e.g. the Policy documents
// table's collapsed row, policy-document-dropbox-status.tsx) can reuse the
// exact same state->tone mapping instead of redefining it.
export const STATE_TONE: Record<DropboxPathState, BadgeTone> = {
  synced: "success",
  planned: "neutral",
  pending: "neutral",
  syncing: "info",
  error: "danger",
  conflict: "warning",
  not_connected: "warning",
  unavailable: "neutral",
};

// Exported so the compact status badges that duplicated this exact map
// (policy-document-dropbox-status.tsx, claim-document-dropbox-status.tsx)
// can share one copy instead of redefining it (Phase 8 Part 7.1).
export function useDropboxStateLabels(): Record<DropboxPathState, string> {
  const { t } = useLocale();
  return {
    synced: t.dropbox.stateSynced,
    planned: t.dropbox.statePlanned,
    pending: t.dropbox.statePending,
    syncing: t.dropbox.stateSyncing,
    error: t.dropbox.stateError,
    conflict: t.dropbox.stateConflict,
    not_connected: t.dropbox.stateNotConnected,
    unavailable: t.dropbox.stateUnavailable,
  };
}

export function DropboxPathDisplay({ label, view, className = "" }: { label: string; view: DropboxPathView; className?: string }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const stateLabel = useDropboxStateLabels();

  const handleCopy = async () => {
    if (!view.path) return;
    try {
      await navigator.clipboard.writeText(view.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable/denied — silently no-op, the path is
      // still fully visible and selectable as plain text.
    }
  };

  const handleOpenDropbox = () => {
    // Part 2, requirement 18: Dropbox has no stable direct deep link this
    // app can construct safely — open Dropbox home and let the user
    // navigate using the copied path, never an invented/guessed URL.
    window.open("https://www.dropbox.com/home", "_blank", "noopener,noreferrer");
  };

  return (
    <div className={`flex flex-col gap-1.5 ${className}`.trim()}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-secondary">{label}</span>
        <Badge tone={STATE_TONE[view.state]}>{stateLabel[view.state]}</Badge>
      </div>

      {view.path ? (
        <div className="flex flex-wrap items-start gap-2">
          {/* Correction 3: wrap by path segment/word first (CSS
              overflow-wrap: break-word) — the previous word-break: break-
              everything rule wrapped this one character at a time once
              squeezed into a narrow container (e.g. a table cell),
              producing an extremely tall row. This is the single shared
              implementation every consumer (Customer/Quotation/Policy)
              renders through, so the fix applies everywhere at once. */}
          <code className="min-w-0 w-full flex-1 break-words rounded-md bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
            {view.path}
          </code>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              aria-label={t.dropbox.copyPath}
              title={t.dropbox.copyPath}
              onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? t.dropbox.pathCopied : t.dropbox.copyPath}
            </button>
            {view.state === "synced" && (
              <button
                type="button"
                aria-label={t.dropbox.openInDropbox}
                title={t.dropbox.openInDropbox}
                onClick={handleOpenDropbox}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <ExternalLink size={13} />
                {t.dropbox.openInDropbox}
              </button>
            )}
          </div>
        </div>
      ) : (
        <span className="text-sm text-secondary">{t.dropbox.stateUnavailable}</span>
      )}

      {view.errorMessage && (view.state === "error" || view.state === "conflict") && (
        <p className="text-xs text-red-600 dark:text-red-400">{view.errorMessage}</p>
      )}
    </div>
  );
}

// Default-collapsed variant of DropboxPathDisplay — used by every
// record-level "Dropbox Filing" card (Customer/Quotation/Policy/Invoice/
// Claim) so a long synced path never dominates the card on first render.
// The label + status Badge are always visible in the toggle header; the
// path itself (and Copy/Open/error) only render once expanded. Mirrors the
// collapse pattern already used per-row in the Customer/Policy/Claim
// document tables (Phase 8 Part 7.2), just applied at the section level.
export function CollapsibleDropboxPath({ label, view, className = "", defaultExpanded = false }: { label: string; view: DropboxPathView; className?: string; defaultExpanded?: boolean }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const stateLabel = useDropboxStateLabels();

  return (
    <div className={`flex flex-col gap-1.5 ${className}`.trim()}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="inline-flex w-fit items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        {expanded ? <ChevronDown size={14} className="text-emerald-700" /> : <ChevronRight size={14} className="text-emerald-700" />}
        <span className="text-secondary text-sm">{label}</span>
        <Badge tone={STATE_TONE[view.state]}>{stateLabel[view.state]}</Badge>
        <span className="text-xs font-medium text-emerald-700 hover:underline">
          {expanded ? t.dropbox.hideFullPath : t.dropbox.showFullPath}
        </span>
      </button>
      {expanded && <DropboxPathDisplay label={label} view={view} className="pl-5" />}
    </div>
  );
}
