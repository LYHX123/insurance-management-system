"use client";

// Dropbox Integration Phase 5, Part 8 — per-row Dropbox status/path cell
// for the shared Policy documents table (MotorDocumentsTab, reused by all
// four categories). Mirrors customers/document-dropbox-status.tsx's shape.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ShieldCheck, UploadCloud } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { IconButton } from "@/components/ui/icon-button";
import { DropboxPathDisplay } from "@/components/dropbox/dropbox-path-display";
import { retryPolicyDocumentSyncAction, reuploadPolicyDocumentAction, verifyPolicyDocumentAction } from "@/app/(app)/policy/dropboxActions";
import type { PolicyDocumentDropboxInfo } from "@/components/policy/types";

export function PolicyDocumentDropboxStatus({
  policyDocumentId,
  dropbox,
  isAdmin,
}: {
  policyDocumentId: string;
  dropbox: PolicyDocumentDropboxInfo;
  isAdmin: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);

  const run = async (action: (id: string) => Promise<{ success: boolean; forbidden?: boolean }>) => {
    setIsBusy(true);
    await action(policyDocumentId);
    setIsBusy(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-1">
      <DropboxPathDisplay label={t.policy.dropboxDocumentPath} view={dropbox.view} />
      {isAdmin && dropbox.view.state !== "not_connected" && (
        <div className="flex items-center gap-0.5">
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
