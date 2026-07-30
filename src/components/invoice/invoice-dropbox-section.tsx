"use client";

// Dropbox Integration Phase 6, Part 6 — the Invoice detail page's Dropbox
// section. An Invoice has exactly one generated document, so — unlike
// Policy's per-document table — this combines business-folder-level and
// file-level info in one Card, mirroring policy-dropbox-section.tsx +
// policy-document-dropbox-status.tsx's shape combined.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropboxPathDisplay } from "@/components/dropbox/dropbox-path-display";
import { retryInvoiceDocumentSyncAction, verifyInvoiceDocumentAction, verifyInvoiceBusinessFolderAction } from "@/app/(app)/invoice/dropboxActions";
import type { InvoiceDropboxSectionView } from "@/components/invoice/types";

export function InvoiceDropboxSection({
  invoiceId,
  dropbox,
  isAdmin,
}: {
  invoiceId: string;
  dropbox: InvoiceDropboxSectionView;
  isAdmin: boolean;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dateTimeFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  if (!dropbox.dropboxConnected) return null;

  const sourceLabel =
    dropbox.source === "QUOTATION_CASE"
      ? t.invoice.dropboxSourceQuotation
      : dropbox.source === "POLICY_FALLBACK"
        ? t.invoice.dropboxSourcePolicyFallback
        : t.invoice.dropboxSourceInvoiceFallback;

  const run = async (action: (id: string) => Promise<{ success: boolean; forbidden?: boolean }>) => {
    setIsBusy(true);
    setMessage(null);
    const result = await action(invoiceId);
    setIsBusy(false);
    setMessage(result.forbidden ? t.invoice.dropboxUnauthorized : result.success ? t.invoice.dropboxOperationSucceeded : null);
    router.refresh();
  };

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <h2 className="section-title">{t.invoice.dropboxSectionTitle}</h2>

        {message && <p className="text-sm text-zinc-600">{message}</p>}

        <div>
          <dt className="text-secondary">{t.invoice.dropboxBusinessFileFolder}</dt>
          <dd className="text-body font-medium">{dropbox.businessFolderName || "—"}</dd>
        </div>
        <p className="text-xs text-secondary">{sourceLabel}</p>

        <DropboxPathDisplay label={t.invoice.dropboxBusinessFolderPath} view={dropbox.businessFolder} />
        <DropboxPathDisplay label={t.invoice.dropboxInvoiceFolderPath} view={dropbox.invoiceFolder} />

        {dropbox.standardizedFileName && (
          <div>
            <dt className="text-secondary">{t.invoice.dropboxInvoiceFilename}</dt>
            <dd className="text-body font-medium">{dropbox.standardizedFileName}</dd>
          </div>
        )}
        <DropboxPathDisplay label={t.invoice.dropboxInvoiceFilePath} view={dropbox.invoiceFile} />
        {dropbox.invoiceFile.isPlanned && (
          <p className="text-xs text-secondary">
            <span className="font-medium">{t.invoice.dropboxPlannedPathTitle}:</span> {t.invoice.dropboxPlannedPathNote}
          </p>
        )}

        {dropbox.lastSyncedAt && (
          <div>
            <dt className="text-secondary">{t.invoice.dropboxLastSynchronized}</dt>
            <dd className="text-body font-medium">{dateTimeFormatter.format(new Date(dropbox.lastSyncedAt))}</dd>
          </div>
        )}

        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={isBusy} onClick={() => run(retryInvoiceDocumentSyncAction)}>
              <RefreshCw size={16} />
              {t.invoice.dropboxRetrySync}
            </Button>
            <Button type="button" variant="secondary" disabled={isBusy} onClick={() => run(verifyInvoiceDocumentAction)}>
              <ShieldCheck size={16} />
              {t.invoice.dropboxVerifyFile}
            </Button>
            <Button type="button" variant="secondary" disabled={isBusy} onClick={() => run(verifyInvoiceBusinessFolderAction)}>
              <ShieldCheck size={16} />
              {t.invoice.dropboxVerifyBusinessFolder}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
