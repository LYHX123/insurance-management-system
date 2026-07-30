"use client";

// Dropbox Integration Phase 7, Part 8 — the Claim detail page's Dropbox
// section. Shared between Motor and Non-Motor Claim via injected server
// actions (mirrors claim-participants-modal.tsx's updateAction prop
// convention) rather than two duplicated files.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropboxPathDisplay } from "@/components/dropbox/dropbox-path-display";
import type { ClaimDropboxSectionView } from "@/components/claims/types";

export function ClaimDropboxSection({
  claimId,
  dropbox,
  isAdmin,
  verifyBusinessFolderAction,
  syncMissingAction,
}: {
  claimId: string;
  dropbox: ClaimDropboxSectionView;
  isAdmin: boolean;
  verifyBusinessFolderAction: (id: string) => Promise<{ success: boolean; forbidden?: boolean }>;
  syncMissingAction: (id: string) => Promise<{ success: boolean; error?: string; processed?: number; succeeded?: number; failed?: number }>;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!dropbox.dropboxConnected) return null;

  const sourceLabel =
    dropbox.source === "QUOTATION_CASE"
      ? t.claims.dropboxSourceQuotation
      : dropbox.source === "POLICY_FALLBACK"
        ? t.claims.dropboxSourcePolicyFallback
        : t.claims.dropboxSourceClaimFallback;

  const handleVerifyBusinessFolder = async () => {
    setIsBusy(true);
    setMessage(null);
    const result = await verifyBusinessFolderAction(claimId);
    setIsBusy(false);
    setMessage(result.forbidden ? t.claims.dropboxUnauthorized : null);
    router.refresh();
  };

  const handleSyncMissing = async () => {
    setIsBusy(true);
    setMessage(null);
    const result = await syncMissingAction(claimId);
    setIsBusy(false);
    if (!result.success) {
      setMessage(t.claims.dropboxUnauthorized);
      return;
    }
    setMessage(
      t.customers.dropboxBatchResultSummary
        .replace("{processed}", String(result.processed ?? 0))
        .replace("{succeeded}", String(result.succeeded ?? 0))
        .replace("{failed}", String(result.failed ?? 0))
    );
    router.refresh();
  };

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <h2 className="section-title">{t.claims.dropboxSectionTitle}</h2>

        {message && <p className="text-sm text-zinc-600">{message}</p>}

        <div>
          <dt className="text-secondary">{t.claims.dropboxBusinessFileFolder}</dt>
          <dd className="text-body font-medium">{dropbox.businessFolderName || "—"}</dd>
        </div>
        <p className="text-xs text-secondary">{sourceLabel}</p>

        <DropboxPathDisplay label={t.claims.dropboxBusinessFolderPath} view={dropbox.businessFolder} />
        <DropboxPathDisplay label={t.claims.dropboxClaimFolderPath} view={dropbox.claimFolder} />
        <DropboxPathDisplay label={t.claims.dropboxClaimReferenceFolderPath} view={dropbox.claimReferenceFolder} />
        {dropbox.claimReferenceFolder.isPlanned && (
          <p className="text-xs text-secondary">
            <span className="font-medium">{t.claims.dropboxPlannedPathTitle}:</span> {t.claims.dropboxPlannedPathNote}
          </p>
        )}

        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={isBusy} onClick={handleVerifyBusinessFolder}>
              <ShieldCheck size={16} />
              {t.claims.dropboxVerifyBusinessFolder}
            </Button>
            <Button type="button" variant="secondary" disabled={isBusy} onClick={handleSyncMissing}>
              <RefreshCw size={16} />
              {t.claims.dropboxSyncMissingDocuments}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
