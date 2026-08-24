"use client";

import { RefreshCw } from "lucide-react";

// Phase 8 — the lightweight, non-intrusive notice shown on a Task/Claim
// detail view the current user has open when another participant updates
// that exact record (see this phase's spec, Part I). Deliberately not a
// modal, never auto-dismissed by anything other than the user's own click
// or the detail data actually changing underneath it — refreshing only
// happens when the user clicks the button, never automatically, so an
// in-progress edit/open modal on the page is never disturbed.
export function ExternalUpdateBanner({ message, refreshLabel, onRefresh }: { message: string; refreshLabel: string; onRefresh: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <span>{message}</span>
      <button
        type="button"
        onClick={onRefresh}
        className="flex shrink-0 items-center gap-1.5 font-medium text-amber-900 hover:underline"
      >
        <RefreshCw size={14} />
        {refreshLabel}
      </button>
    </div>
  );
}
