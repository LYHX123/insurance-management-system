"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { parseWibaScheduleAction, parseCpmScheduleAction } from "@/app/(app)/quotation/actions";
import { WibaSchedulePreview, CpmSchedulePreview } from "@/components/quotations/schedule-import-preview";
import type { WibaScheduleRow, CpmScheduleRow, WibaScheduleTotals, CpmScheduleTotals } from "@/lib/quotationScheduleImport/types";
import type { Dictionary } from "@/i18n/dictionaries/en";

// Phase 9 — WIBA / CPM Schedule Import. Upload -> Parse & Preview -> Confirm
// Import. Never writes to the database itself (see the doc comment on
// parseWibaScheduleAction/parseCpmScheduleAction in quotation/actions.ts):
// "Confirm Import" below only calls props.onImport with the already-
// validated rows, which the caller (WIBASection/CPMSection) merges into the
// existing WibaDraft.payrollRows / CpmDraft.equipmentRows — the user then
// reviews/edits/saves the quotation exactly as with manual entry.

type Props =
  | { kind: "WIBA"; hasExistingRows: boolean; onClose: () => void; onImport: (rows: WibaScheduleRow[]) => void }
  | { kind: "CPM"; hasExistingRows: boolean; onClose: () => void; onImport: (rows: CpmScheduleRow[]) => void };

function topErrorMessage(code: string, kind: "WIBA" | "CPM", t: Dictionary): string {
  switch (code) {
    case "FORBIDDEN":
      return t.quotations.scheduleErrorForbidden;
    case "INVALID_FILE_TYPE":
      return t.quotations.scheduleErrorInvalidFileType;
    case "FILE_TOO_LARGE":
      return t.quotations.scheduleErrorFileTooLarge;
    case "NO_DATA_ROWS":
      return t.quotations.scheduleErrorNoDataRows;
    case "PARSE_FAILED":
      return t.quotations.scheduleErrorParseFailed;
    case "INVALID_TEMPLATE":
      return kind === "WIBA" ? t.quotations.scheduleErrorInvalidWibaTemplate : t.quotations.scheduleErrorInvalidCpmTemplate;
    case "NO_FILE_CHOSEN":
      return t.quotations.scheduleNoFileChosen;
    default:
      return code;
  }
}

export function ScheduleImportModal(props: Props) {
  const { t } = useLocale();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [wibaResult, setWibaResult] = useState<{ rows: WibaScheduleRow[]; totals: WibaScheduleTotals; hasErrors: boolean } | null>(null);
  const [cpmResult, setCpmResult] = useState<{ rows: CpmScheduleRow[]; totals: CpmScheduleTotals; hasErrors: boolean } | null>(null);
  const [showReimportConfirm, setShowReimportConfirm] = useState(false);

  const hasPreview = props.kind === "WIBA" ? wibaResult !== null : cpmResult !== null;
  const hasBlockingErrors = props.kind === "WIBA" ? (wibaResult?.hasErrors ?? true) : (cpmResult?.hasErrors ?? true);

  const handleParse = async () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setTopError("NO_FILE_CHOSEN");
      return;
    }
    setIsParsing(true);
    setTopError(null);
    const formData = new FormData();
    formData.set("file", file);

    if (props.kind === "WIBA") {
      const result = await parseWibaScheduleAction(formData);
      setIsParsing(false);
      if (!result.ok) {
        setTopError(result.error);
        return;
      }
      setWibaResult({ rows: result.rows, totals: result.totals, hasErrors: result.hasErrors });
    } else {
      const result = await parseCpmScheduleAction(formData);
      setIsParsing(false);
      if (!result.ok) {
        setTopError(result.error);
        return;
      }
      setCpmResult({ rows: result.rows, totals: result.totals, hasErrors: result.hasErrors });
    }
  };

  const doImport = () => {
    if (props.kind === "WIBA" && wibaResult) props.onImport(wibaResult.rows);
    if (props.kind === "CPM" && cpmResult) props.onImport(cpmResult.rows);
    props.onClose();
  };

  const handleConfirmClick = () => {
    if (props.hasExistingRows) {
      setShowReimportConfirm(true);
      return;
    }
    doImport();
  };

  const handleChooseAnotherFile = () => {
    setWibaResult(null);
    setCpmResult(null);
    setTopError(null);
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <Modal title={t.quotations.importSchedule} onClose={props.onClose} width="lg">
      {!hasPreview && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-secondary">{t.quotations.uploadExcelSchedule}</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            className="block w-full text-sm text-zinc-600 file:mr-4 file:rounded-control file:border-0 file:bg-emerald-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-emerald-700 hover:file:bg-emerald-100"
          />
          {fileName && <p className="text-sm text-zinc-500">{fileName}</p>}
          {topError && (
            <p role="alert" className="form-error">
              {topErrorMessage(topError, props.kind, t)}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={props.onClose} disabled={isParsing}>
              {t.quotations.scheduleCancelImport}
            </Button>
            <Button type="button" onClick={handleParse} disabled={isParsing}>
              <Upload size={16} />
              {isParsing ? t.quotations.scheduleParsing : t.quotations.parseAndPreview}
            </Button>
          </div>
        </div>
      )}

      {hasPreview && (
        <div className="flex flex-col gap-4">
          <h4 className="table-title">{t.quotations.scheduleImportPreviewTitle}</h4>
          {props.kind === "WIBA" && wibaResult ? (
            <WibaSchedulePreview rows={wibaResult.rows} totals={wibaResult.totals} />
          ) : props.kind === "CPM" && cpmResult ? (
            <CpmSchedulePreview rows={cpmResult.rows} totals={cpmResult.totals} />
          ) : null}

          {hasBlockingErrors && <p className="form-error">{t.quotations.scheduleImportRowsWithErrors}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={handleChooseAnotherFile}>
              {t.quotations.scheduleChooseAnotherFile}
            </Button>
            <Button type="button" variant="secondary" onClick={props.onClose}>
              {t.quotations.scheduleCancelImport}
            </Button>
            <Button type="button" onClick={handleConfirmClick} disabled={hasBlockingErrors}>
              {t.quotations.scheduleConfirmImport}
            </Button>
          </div>
        </div>
      )}

      {showReimportConfirm && (
        <ConfirmDialog
          title={t.quotations.scheduleReimportConfirmTitle}
          message={t.quotations.scheduleReimportConfirmMessage}
          isSubmitting={false}
          onConfirm={() => {
            setShowReimportConfirm(false);
            doImport();
          }}
          onClose={() => setShowReimportConfirm(false)}
        />
      )}
    </Modal>
  );
}
