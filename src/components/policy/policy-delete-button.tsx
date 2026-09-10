"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPolicyDeleteBlockers, policyDeleteBlockerLabels } from "@/lib/policy/deleteBlockerMessage";
import type { DeletePolicyResult } from "@/lib/policy/deletePolicyRecord";

// Phase 13D — the permanent-delete launcher + confirmation dialog, extracted
// into ONE self-contained Client Component shared by all four Policy category
// Overview tabs (Motor / Non-Motor / Bond / Work Permit). Previously this was
// inline-duplicated in each tab via the generic TypedConfirmDialog, where a
// blocked delete only swapped one line of body text and gave the user no
// clear signal — see the Phase 13D UI bug report.
//
// Contract:
//   - The launcher <Button> is type="button" and only toggles local state —
//     it NEVER deletes on the first click.
//   - The dialog shows the Record Number, Customer and Category, and requires
//     the user to type the exact Record Number before "Delete Permanently"
//     enables (§I preferred safeguard).
//   - `deleteAction` is the existing per-category server action
//     (delete{Motor,NonMotor,Bond,WorkPermit}PolicyAction) — the server stays
//     authoritative for permission, category resolution and every dependency
//     blocker. This component never re-implements any of that.
//   - A blocked delete shows a prominent, role="alert" error listing the
//     translated blocker reasons and keeps the dialog open and usable.
//   - A successful delete redirects to the category list with
//     ?deleted=<recordNumber>, where PolicyDeleteSuccessBanner shows the
//     success message.
export function PolicyDeleteButton({
  policyId,
  recordNumber,
  customerName,
  categoryLabel,
  listPath,
  deleteAction,
}: {
  policyId: string;
  recordNumber: string;
  customerName: string;
  categoryLabel: string;
  listPath: string;
  deleteAction: (policyId: string, confirmationValue: string) => Promise<DeletePolicyResult>;
}) {
  const { t } = useLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = typed.trim() === recordNumber;

  const close = () => {
    if (isDeleting) return;
    setOpen(false);
    setTyped("");
    setError(null);
  };

  const handleConfirm = async () => {
    if (!matches || isDeleting) return;
    setError(null);
    setIsDeleting(true);
    let result: DeletePolicyResult;
    try {
      result = await deleteAction(policyId, typed.trim());
    } catch {
      setIsDeleting(false);
      setError(t.policy.deletePolicyDeleteFailedError);
      return;
    }
    setIsDeleting(false);

    if (!result.success) {
      if (result.error === "HAS_DEPENDENCIES") {
        setError(
          formatPolicyDeleteBlockers(t.policy.deletePolicyBlocked, policyDeleteBlockerLabels(t.policy), result.blockers ?? [])
        );
      } else if (result.error === "CONFIRMATION_MISMATCH") {
        setError(t.policy.deletePolicyConfirmationMismatch);
      } else if (result.error === "FORBIDDEN") {
        setError(t.policy.genericError);
      } else if (result.error === "NOT_FOUND") {
        setError(t.policy.recordNotFound);
      } else {
        setError(t.policy.deletePolicyDeleteFailedError);
      }
      return;
    }

    // Leave the dialog as-is (disabled) during the navigation away.
    router.replace(`${listPath}?deleted=${encodeURIComponent(result.recordNumber)}`);
  };

  return (
    <>
      <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
        {t.policy.deletePolicy}
      </Button>

      {open && (
        <Modal title={t.policy.deletePolicyConfirmTitle} onClose={close}>
          <div className="flex flex-col gap-4">
            <p className="text-body">{t.policy.deletePolicyConfirmMessage}</p>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-control border border-zinc-200 bg-zinc-50 p-3 text-sm">
              <dt className="text-secondary">{t.policy.recordNumber}</dt>
              <dd className="font-medium text-zinc-800">{recordNumber}</dd>
              <dt className="text-secondary">{t.policy.customer}</dt>
              <dd className="font-medium text-zinc-800">{customerName}</dd>
              <dt className="text-secondary">{t.policy.category}</dt>
              <dd className="font-medium text-zinc-800">{categoryLabel}</dd>
            </dl>

            <p className="text-xs text-secondary">{t.policy.dropboxRetentionNote}</p>

            <label className="flex flex-col gap-1 text-sm text-zinc-700">
              {t.policy.deletePolicyConfirmInstruction.replace("{recordNumber}", recordNumber)}
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={recordNumber}
                disabled={isDeleting}
                autoFocus
              />
            </label>

            {error && (
              <p role="alert" className="rounded-control border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close} disabled={isDeleting}>
                {t.common.cancel}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirm}
                disabled={!matches || isDeleting}
              >
                {t.policy.deletePolicyConfirmButton}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
