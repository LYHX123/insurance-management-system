"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput, formatMoney, stripCommas } from "@/components/ui/money-input";
import { generatePolicyRecordsAction, type GeneratedPolicyRecordRow } from "@/app/(app)/quotation/generatePolicyRecordsAction";
import { uploadPolicyDocumentAction } from "@/app/(app)/policy/motor/documentActions";
import { PolicyDocumentType } from "@/generated/prisma/enums";
import type { SectionRow } from "@/components/quotations/types";

const today = () => new Date().toISOString().slice(0, 10);

// Same allowlist upload-policy-document-modal.tsx hardcodes for its own
// file input (this project's existing convention: the client-side accept
// attribute is a UX hint only, mirrored by hand from
// policyDocuments/constants.ts's ALLOWED_DOCUMENT_TYPES — the Server Action
// this modal reuses, uploadPolicyDocumentAction, is what actually validates
// the file, so a mismatch here is a display inconvenience, never a security
// gap). Not imported directly: that constants module pulls in Node's
// `crypto` at the top level, which is fine in a Server Action file but not
// worth risking in this "use client" bundle.
const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx";

// Phase 3 "per-section cover periods" — each QuotationInsuranceSection may
// legitimately run a different effective/expiry window (CAR vs. a Bond vs.
// Motor Comprehensive on the same quotation are rarely co-terminous), so
// every row keeps its own date fields — see generatePolicyRecordsAction's
// GeneratePolicyRecordsSectionInput doc comment. insurerCost was already
// row-level (Phase 1+2); effectiveDate/expiryDate joined it in Phase 3.
// Phase 4 adds policyNumber/file — both OPTIONAL (this phase's spec, Part
// 3) and both purely client-side state until submission: policyNumber
// travels inside generatePolicyRecordsAction's own payload, file is never
// sent to that action at all (see handleSubmit's two-step flow below).
type RowState = {
  effectiveDate: string;
  expiryDate: string;
  insurerCost: string;
  policyNumber: string;
  file: File | null;
  // "Touched" = the user edited THIS row's date field directly. Once true,
  // changing the top Default Effective/Expiry Date never overwrites it
  // again — see handleDefaultEffectiveDateChange/handleDefaultExpiryDateChange
  // below. Never reset back to false once set (even if the row is
  // unchecked and re-checked) — a manual edit is a durable, explicit user
  // decision for the lifetime of this modal instance. policyNumber/file
  // have no such "default" concept at all (Part 2's note: "不要让 Default
  // Effective/Expiry Date 覆盖或干扰 Policy Number/File") — nothing ever
  // auto-fills them, so there is nothing to protect with a touched flag.
  effectiveTouched: boolean;
  expiryTouched: boolean;
};

function emptyRow(): RowState {
  return { effectiveDate: "", expiryDate: "", insurerCost: "", policyNumber: "", file: null, effectiveTouched: false, expiryTouched: false };
}

type DocumentOutcome = { sectionId: string; sectionName: string; ok: boolean; message?: string };

type GenerateSummary = {
  createdCount: number;
  documentOutcomes: DocumentOutcome[];
};

// Phase 1+2 "Generate Policy Records" — replaces the old category-picker
// "Create Policy" modal on the Quotation Detail page. Lists every
// QuotationInsuranceSection on the current revision with its
// Generated / Not Generated / Unsupported state (see
// sectionPolicyMapping.ts's resolveSectionPolicyPlan, computed server-side
// in getQuotationDetailData — this component never re-derives that rule),
// and lets the user generate any subset (one, several, or all) in a single
// batch. Does not remove the single-record "/policy/{category}/new" flow —
// that page/action is untouched and still reachable directly.
export function GeneratePolicyRecordsModal({
  quotationId,
  quotationNumber,
  sections,
  onClose,
}: {
  quotationId: string;
  quotationNumber: string;
  sections: SectionRow[];
  onClose: () => void;
}) {
  const { t } = useLocale();
  const router = useRouter();

  // Client-generated once per modal open, reused across any retry of this
  // same submission attempt — same H6 idempotency pattern as
  // add-receipt-modal.tsx (see addCustomerReceiptAction's own
  // idempotencyKey doc comment).
  const [idempotencyKey] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  );

  const creatableSections = sections.filter((s) => !s.generatedPolicy && s.policyGenerationSupported);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(creatableSections.map((s) => s.id)));
  // Processing Date stays batch-level (this phase's spec, Part 1) — every
  // PolicyRecord generated in this submission shares it.
  const [processingDate, setProcessingDate] = useState(today());
  // "Quick fill" only — never written to the database directly. No
  // fabricated default (e.g. today+1y): both start blank, same as the
  // previous phase's single batch-wide fields did.
  const [defaultEffectiveDate, setDefaultEffectiveDate] = useState("");
  const [defaultExpiryDate, setDefaultExpiryDate] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(sections.map((s) => [s.id, emptyRow()]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Non-null once STEP A (create) has committed — the modal switches to a
  // read-only result view instead of closing immediately, so a document
  // upload failure (STEP B, never rolled back — this phase's spec, Part 6)
  // is always visible to the user rather than silently lost.
  const [summary, setSummary] = useState<GenerateSummary | null>(null);

  const ERROR_LABEL: Record<string, string> = {
    FORBIDDEN: t.quotations.genericError,
    IDEMPOTENCY_KEY_REQUIRED: t.quotations.genericError,
    NO_SECTIONS_SELECTED: t.quotations.noSectionsSelectedError,
    PROCESSING_DATE_REQUIRED: t.policy.processingDateRequired,
    DATES_REQUIRED: t.policy.datesRequired,
    EXPIRY_BEFORE_EFFECTIVE: t.policy.expiryBeforeEffective,
    QUOTATION_NOT_FOUND: t.quotations.revisionNotFoundError,
    QUOTATION_NOT_ELIGIBLE: t.policy.quotationNotEligibleError,
    SECTION_NOT_FOUND: t.quotations.genericError,
    UNSUPPORTED_SECTION: t.quotations.unsupportedSectionError,
    INSURER_COST_INVALID: t.policy.insurerCostInvalid,
    GENERATE_FAILED: t.quotations.generatePolicyRecordsFailedError,
  };

  // Mirrors upload-policy-document-modal.tsx's own ERROR_KEY mapping
  // exactly (same Server Action, same error codes) — see that component's
  // doc comment.
  const DOCUMENT_ERROR_LABEL: Record<string, string> = {
    NO_FILE: t.policy.documentFileRequired,
    FILE_TOO_LARGE: t.policy.documentFileTooLarge,
    FILE_EMPTY: t.policy.documentFileTooLarge,
    UNSUPPORTED_FILE_TYPE: t.policy.documentFileTypeNotAllowed,
    FILE_SIGNATURE_MISMATCH: t.policy.documentFileTypeNotAllowed,
    DANGEROUS_FILE_CONTENT: t.policy.documentFileTypeNotAllowed,
    UNSAFE_FILE_NAME: t.policy.documentFileTypeNotAllowed,
    RECORD_NOT_FOUND: t.policy.recordNotFound,
    INVALID_DOCUMENT_TYPE: t.quotations.genericError,
    FORBIDDEN: t.quotations.genericError,
    UPLOAD_FAILED: t.policy.documentUploadFailed,
    SAVE_FAILED: t.policy.documentUploadFailed,
  };

  function toggle(sectionId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
        // Newly checked: pick up whatever default is currently set, but
        // only into fields the user has never touched and that are still
        // blank — never clobber a value the row already carries. Never
        // touches policyNumber/file — those have no default concept.
        setRows((prevRows) => {
          const row = prevRows[sectionId] ?? emptyRow();
          const patch: Partial<RowState> = {};
          if (!row.effectiveTouched && !row.effectiveDate && defaultEffectiveDate) patch.effectiveDate = defaultEffectiveDate;
          if (!row.expiryTouched && !row.expiryDate && defaultExpiryDate) patch.expiryDate = defaultExpiryDate;
          if (Object.keys(patch).length === 0) return prevRows;
          return { ...prevRows, [sectionId]: { ...row, ...patch } };
        });
      }
      return next;
    });
  }

  function handleDefaultEffectiveDateChange(value: string) {
    setDefaultEffectiveDate(value);
    setRows((prev) => {
      const next = { ...prev };
      for (const id of selected) {
        const row = next[id];
        if (row && !row.effectiveTouched) next[id] = { ...row, effectiveDate: value };
      }
      return next;
    });
  }

  function handleDefaultExpiryDateChange(value: string) {
    setDefaultExpiryDate(value);
    setRows((prev) => {
      const next = { ...prev };
      for (const id of selected) {
        const row = next[id];
        if (row && !row.expiryTouched) next[id] = { ...row, expiryDate: value };
      }
      return next;
    });
  }

  function handleRowEffectiveDateChange(sectionId: string, value: string) {
    setRows((prev) => ({ ...prev, [sectionId]: { ...(prev[sectionId] ?? emptyRow()), effectiveDate: value, effectiveTouched: true } }));
  }

  function handleRowExpiryDateChange(sectionId: string, value: string) {
    setRows((prev) => ({ ...prev, [sectionId]: { ...(prev[sectionId] ?? emptyRow()), expiryDate: value, expiryTouched: true } }));
  }

  function handleRowInsurerCostChange(sectionId: string, raw: string) {
    setRows((prev) => ({ ...prev, [sectionId]: { ...(prev[sectionId] ?? emptyRow()), insurerCost: raw } }));
  }

  function handleRowPolicyNumberChange(sectionId: string, value: string) {
    setRows((prev) => ({ ...prev, [sectionId]: { ...(prev[sectionId] ?? emptyRow()), policyNumber: value } }));
  }

  function handleRowFileChange(sectionId: string, file: File | null) {
    setRows((prev) => ({ ...prev, [sectionId]: { ...(prev[sectionId] ?? emptyRow()), file } }));
  }

  // STEP B (this phase's spec, Part 4/6) — reuses uploadPolicyDocumentAction
  // as-is (never duplicated), called once per newly-created PolicyRecord
  // that has a selected file, entirely AFTER and OUTSIDE
  // generatePolicyRecordsAction's own database transaction. A failure here
  // never rolls back or hides the already-committed PolicyRecord — it only
  // surfaces as one row in the result summary (Part 7).
  async function uploadDocumentFor(policyRecordId: string, file: File): Promise<{ ok: boolean; message?: string }> {
    const formData = new FormData();
    formData.set("policyRecordId", policyRecordId);
    formData.set("documentType", PolicyDocumentType.POLICY_SCHEDULE);
    formData.set("issueDate", "");
    formData.set("expiryDate", "");
    formData.set("notes", "");
    formData.set("file", file);
    const result = await uploadPolicyDocumentAction(formData);
    if (result.success) return { ok: true };
    return { ok: false, message: DOCUMENT_ERROR_LABEL[result.error] ?? t.policy.documentUploadFailed };
  }

  async function handleSubmit() {
    if (selected.size === 0) {
      setError(ERROR_LABEL.NO_SECTIONS_SELECTED);
      return;
    }
    // Fast, client-side pre-check (never a substitute for the Server
    // Action's own re-validation, which is authoritative — see
    // generatePolicyRecordsAction's per-section validation loop) — a
    // single invalid/missing selected row fails the whole submission,
    // never a partial batch. policyNumber/file are OPTIONAL (Part 3) and
    // deliberately never checked here.
    for (const id of selected) {
      const row = rows[id] ?? emptyRow();
      if (!row.effectiveDate || !row.expiryDate) {
        setError(ERROR_LABEL.DATES_REQUIRED);
        return;
      }
      if (new Date(row.expiryDate) <= new Date(row.effectiveDate)) {
        setError(ERROR_LABEL.EXPIRY_BEFORE_EFFECTIVE);
        return;
      }
    }

    setBusy(true);
    setError(null);

    // STEP A — create every PolicyRecord in one atomic, idempotency- and
    // row-lock-protected batch (unchanged from Phase 1-3; see
    // generatePolicyRecordsAction's own doc comment).
    const result = await generatePolicyRecordsAction({
      quotationId,
      processingDate,
      sections: Array.from(selected).map((id) => {
        const row = rows[id] ?? emptyRow();
        return {
          sectionId: id,
          insurerCost: stripCommas(row.insurerCost),
          effectiveDate: row.effectiveDate,
          expiryDate: row.expiryDate,
          policyNumber: row.policyNumber,
        };
      }),
      idempotencyKey,
    });

    if (!result.success) {
      setBusy(false);
      setError(ERROR_LABEL[result.error] ?? t.quotations.generatePolicyRecordsFailedError);
      return;
    }

    // STEP B — upload only for sections that (a) were actually created in
    // THIS call (never alreadyGenerated — those already have whatever
    // document history they have, untouched) and (b) have a selected file.
    // Run independently per section: one upload failing never affects the
    // others, and never un-does the PolicyRecord creation itself.
    const created: GeneratedPolicyRecordRow[] = result.created;
    const uploadTargets = created.filter((c) => rows[c.sectionId]?.file);
    const outcomes = await Promise.all(
      uploadTargets.map(async (c) => {
        const sectionName = sections.find((s) => s.id === c.sectionId)?.insuranceTypeNameSnapshot ?? c.sectionId;
        const file = rows[c.sectionId]!.file!;
        const outcome = await uploadDocumentFor(c.id, file);
        return { sectionId: c.sectionId, sectionName, ok: outcome.ok, message: outcome.message } satisfies DocumentOutcome;
      })
    );

    setBusy(false);
    setSummary({ createdCount: created.length, documentOutcomes: outcomes });
    // Deliberately does NOT call onClose() here — the summary view below
    // stays open until the user acknowledges it (Part 7: partial document
    // failures must never look like the whole batch failed, but must also
    // never be silently swallowed).
    router.refresh();
  }

  function handleDone() {
    onClose();
  }

  if (summary) {
    const failedOutcomes = summary.documentOutcomes.filter((o) => !o.ok);
    return (
      <Modal title={t.quotations.generatePolicyRecordsModalTitle} onClose={handleDone} width="lg">
        <div className="flex flex-col gap-4">
          <div className="rounded-control border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {t.quotations.generatePolicyRecordsSuccessMessage.replace("{count}", String(summary.createdCount))}
          </div>
          {failedOutcomes.length > 0 && (
            <div className="rounded-control border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p>{t.quotations.generatePolicyRecordsDocumentFailureMessage.replace("{count}", String(failedOutcomes.length))}</p>
              <ul className="mt-2 list-disc pl-5">
                {failedOutcomes.map((o) => (
                  <li key={o.sectionId}>
                    <span className="font-medium">{o.sectionName}</span>: {o.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="primary" onClick={handleDone}>
              {t.common.done}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t.quotations.generatePolicyRecordsModalTitle} onClose={onClose} width="lg">
      <div className="flex flex-col gap-4">
        <div>
          <div className="text-secondary text-sm">{t.quotations.quotationNumber}</div>
          <div className="font-medium text-zinc-800">{quotationNumber}</div>
        </div>

        {error && <div className="rounded-control border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <p className="text-secondary text-sm">{t.quotations.generatePolicyRecordsModalDescription}</p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label={t.policy.processingDate} htmlFor="gpr-processing-date">
            <Input id="gpr-processing-date" type="date" value={processingDate} onChange={(e) => setProcessingDate(e.target.value)} required />
          </FormField>
          <FormField label={t.quotations.defaultEffectiveDate} htmlFor="gpr-default-effective-date">
            <Input
              id="gpr-default-effective-date"
              type="date"
              value={defaultEffectiveDate}
              onChange={(e) => handleDefaultEffectiveDateChange(e.target.value)}
            />
          </FormField>
          <FormField label={t.quotations.defaultExpiryDate} htmlFor="gpr-default-expiry-date">
            <Input
              id="gpr-default-expiry-date"
              type="date"
              value={defaultExpiryDate}
              onChange={(e) => handleDefaultExpiryDateChange(e.target.value)}
            />
          </FormField>
        </div>
        <p className="text-xs text-secondary">{t.quotations.generatePolicyRecordsDatesHint}</p>

        {/* Column header row — desktop only, mirrors the grid columns each
            section row below uses so headers and values stay aligned. */}
        <div className="hidden text-xs font-medium text-secondary sm:grid sm:grid-cols-[minmax(160px,1.4fr)_6.5rem_8.5rem_8.5rem_8rem] sm:items-center sm:gap-3 sm:px-3">
          <span>{t.quotations.insuranceSectionColumn}</span>
          <span>{t.common.status}</span>
          <span>{t.policy.effectiveDate}</span>
          <span>{t.policy.expiryDate}</span>
          <span>{t.policy.insurerCost}</span>
        </div>

        <div className="flex flex-col gap-2">
          {sections.map((section) => {
            const isGenerated = !!section.generatedPolicy;
            const isUnsupported = !section.policyGenerationSupported;
            const isDisabled = isGenerated || isUnsupported;
            const isChecked = selected.has(section.id);
            const row = rows[section.id] ?? emptyRow();
            const canEditRow = !isDisabled && isChecked;
            return (
              <div
                key={section.id}
                className={`flex flex-col gap-3 rounded-control border p-3 ${isDisabled ? "border-zinc-200 bg-zinc-50" : "border-zinc-200"}`}
              >
                <div className="sm:grid sm:grid-cols-[minmax(160px,1.4fr)_6.5rem_8.5rem_8.5rem_8rem] sm:items-center sm:gap-3">
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isDisabled}
                      onChange={() => toggle(section.id)}
                      aria-label={section.insuranceTypeNameSnapshot}
                      className="h-4 w-4 shrink-0 rounded border-zinc-300"
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-zinc-800">{section.insuranceTypeNameSnapshot}</div>
                      <div className="text-secondary text-sm">
                        {t.quotations.premium}: {formatMoney(section.sectionTotal)}
                      </div>
                    </div>
                  </label>

                  <div>
                    {isGenerated && (
                      <div className="text-sm">
                        <Badge tone="success">{t.quotations.generatedBadge}</Badge>
                        <div className="text-secondary mt-1">{section.generatedPolicy!.recordNumber}</div>
                      </div>
                    )}
                    {!isGenerated && isUnsupported && <Badge tone="neutral">{t.quotations.unsupportedBadge}</Badge>}
                    {!isGenerated && !isUnsupported && <Badge tone="warning">{t.quotations.notGeneratedBadge}</Badge>}
                  </div>

                  {canEditRow ? (
                    <>
                      <Input
                        type="date"
                        value={row.effectiveDate}
                        onChange={(e) => handleRowEffectiveDateChange(section.id, e.target.value)}
                        aria-label={`${t.policy.effectiveDate} — ${section.insuranceTypeNameSnapshot}`}
                        required
                      />
                      <Input
                        type="date"
                        value={row.expiryDate}
                        onChange={(e) => handleRowExpiryDateChange(section.id, e.target.value)}
                        aria-label={`${t.policy.expiryDate} — ${section.insuranceTypeNameSnapshot}`}
                        required
                      />
                      <MoneyInput
                        value={row.insurerCost}
                        onChange={(raw) => handleRowInsurerCostChange(section.id, raw)}
                        placeholder={t.policy.insurerCost}
                        aria-label={`${t.policy.insurerCost} — ${section.insuranceTypeNameSnapshot}`}
                      />
                    </>
                  ) : (
                    <>
                      <span className="hidden text-sm text-zinc-400 sm:block">—</span>
                      <span className="hidden text-sm text-zinc-400 sm:block">—</span>
                      <span className="hidden text-sm text-zinc-400 sm:block">—</span>
                    </>
                  )}
                </div>

                {/* Phase 4 "Policy Number at generation time" — OPTIONAL
                    sub-row, only shown for a section actually being
                    generated in this batch (Part 2's note: already-
                    Generated/Unsupported sections require neither a
                    number nor a file). */}
                {canEditRow && (
                  <div className="flex flex-col gap-2 border-t border-zinc-100 pt-3 sm:flex-row sm:items-center sm:gap-3">
                    <div className="sm:w-56">
                      <Input
                        type="text"
                        value={row.policyNumber}
                        onChange={(e) => handleRowPolicyNumberChange(section.id, e.target.value)}
                        onBlur={(e) => handleRowPolicyNumberChange(section.id, e.target.value.trim())}
                        placeholder={t.policy.policyNumber}
                        aria-label={`${t.policy.policyNumber} — ${section.insuranceTypeNameSnapshot}`}
                      />
                    </div>
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <input
                        type="file"
                        accept={DOCUMENT_ACCEPT}
                        onChange={(e) => handleRowFileChange(section.id, e.target.files?.[0] ?? null)}
                        aria-label={`${t.policy.uploadDocument} — ${section.insuranceTypeNameSnapshot}`}
                        className="input h-auto max-w-xs py-1.5 text-sm"
                      />
                      {row.file && (
                        <>
                          <span className="min-w-0 truncate text-sm text-secondary" title={row.file.name}>
                            {row.file.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRowFileChange(section.id, null)}
                            className="text-secondary shrink-0 text-sm hover:text-zinc-800"
                            aria-label={`${t.common.clear} — ${section.insuranceTypeNameSnapshot}`}
                          >
                            {t.common.clear}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={busy || selected.size === 0}>
            {t.quotations.generateButton}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
