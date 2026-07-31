"use client";

// Dropbox Integration Phase 5, Part 8 — "Dropbox Filing" section shared by
// all four Policy category detail views (Motor/Non-Motor/Bond/Work
// Permit). Shows the business folder + Policy folder paths and whether
// this Policy is filed under a linked Quotation's business file or its own
// fallback file.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CollapsibleDropboxPath } from "@/components/dropbox/dropbox-path-display";
import { syncMissingPolicyDocumentsAction, verifyPolicyBusinessFolderAction } from "@/app/(app)/policy/dropboxActions";
import type { PolicyDropboxSectionView } from "@/components/policy/types";

export function PolicyDropboxSection({
  policyRecordId,
  dropbox,
  isAdmin,
}: {
  policyRecordId: string;
  dropbox: PolicyDropboxSectionView;
  isAdmin: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!dropbox.dropboxConnected) return null;

  const handleVerifyBusinessFolder = async () => {
    setIsBusy(true);
    setMessage(null);
    const result = await verifyPolicyBusinessFolderAction(policyRecordId);
    setIsBusy(false);
    setMessage(result.forbidden ? t.policy.dropboxUnauthorized : null);
    router.refresh();
  };

  const handleSyncMissing = async () => {
    setIsBusy(true);
    setMessage(null);
    const result = await syncMissingPolicyDocumentsAction(policyRecordId);
    setIsBusy(false);
    if (!result.success) {
      setMessage(t.policy.dropboxUnauthorized);
      return;
    }
    setMessage(t.customers.dropboxBatchResultSummary
      .replace("{processed}", String(result.processed))
      .replace("{succeeded}", String(result.succeeded))
      .replace("{failed}", String(result.failed)));
    router.refresh();
  };

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <h2 className="section-title">{t.policy.dropboxFilingTitle}</h2>

        {message && <p className="text-sm text-zinc-600">{message}</p>}

        <div>
          <dt className="text-secondary">{t.policy.dropboxBusinessFileFolder}</dt>
          <dd className="text-body font-medium">{dropbox.businessFolderName || "—"}</dd>
        </div>

        <CollapsibleDropboxPath label={t.policy.dropboxBusinessFolderPath} view={dropbox.businessFolder} />
        <CollapsibleDropboxPath label={t.policy.dropboxPolicyFolderPath} view={dropbox.policyFolder} />

        <p className="text-xs text-secondary">
          {dropbox.source === "QUOTATION_CASE" ? t.policy.dropboxLinkedQuotationBusinessFile : t.policy.dropboxPolicyFallbackBusinessFile}
        </p>

        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={isBusy} onClick={handleVerifyBusinessFolder}>
              <ShieldCheck size={16} />
              {t.policy.dropboxVerifyBusinessFolder}
            </Button>
            <Button type="button" variant="secondary" disabled={isBusy} onClick={handleSyncMissing}>
              <RefreshCw size={16} />
              {t.policy.dropboxRetryDocumentSync}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
