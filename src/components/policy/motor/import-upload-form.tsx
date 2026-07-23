"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Upload } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { uploadMotorWorkbookAction } from "@/app/(app)/policy/motor/import/actions";

const ERROR_KEY: Record<string, string> = {
  NO_FILE: "importInvalidFileType",
  INVALID_FILE_TYPE: "importInvalidFileType",
  MOTOR_SHEET_NOT_FOUND: "importSheetNotFound",
  PARSE_FAILED: "genericError",
  PREVIEW_SAVE_FAILED: "genericError",
  FORBIDDEN: "genericError",
};

export function ImportUploadForm() {
  const { t } = useLocale();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError(t.policy.importInvalidFileType);
      return;
    }

    const formData = new FormData();
    formData.set("file", file);

    setIsUploading(true);
    const result = await uploadMotorWorkbookAction(formData);
    setIsUploading(false);

    if (!result.success) {
      setError(t.policy[(ERROR_KEY[result.error] ?? "genericError") as keyof typeof t.policy]);
      return;
    }
    router.push(`/policy/motor/import/${result.batchId}`);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-section">
      <div>
        <Link href="/policy/motor" className="mb-2 inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline">
          <ArrowLeft size={14} />
          {t.policy.backToList}
        </Link>
        <PageHeader title={t.policy.importUploadTitle} description={t.policy.importUploadDescription} />
      </div>

      <Card>
        <div className="flex flex-col items-start gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            className="block w-full text-sm text-zinc-600 file:mr-4 file:rounded-control file:border-0 file:bg-emerald-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-emerald-700 hover:file:bg-emerald-100"
          />
          {fileName && <p className="text-sm text-zinc-500">{fileName}</p>}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push("/policy/motor")} disabled={isUploading}>
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={isUploading}>
          <Upload size={16} />
          {isUploading ? t.policy.importParsing : t.policy.importUploadButton}
        </Button>
      </div>
    </form>
  );
}
