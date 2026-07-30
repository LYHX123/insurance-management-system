"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/i18n/locale-provider";

// Same shape as ConfirmDialog (src/components/ui/confirm-dialog.tsx) plus a
// required type-to-confirm input — used for irreversible actions (permanent
// Policy delete, list-level Quotation delete) where a plain Confirm/Cancel
// dialog isn't enough friction. The destructive button stays disabled until
// the typed text exactly matches confirmValue (e.g. the record's own
// recordNumber), so a confirmation can never be fired by an accidental extra
// click. Leading/trailing whitespace in what the user typed is trimmed only
// for this comparison (and only what's sent back via onConfirm) — confirmValue
// itself, the actual record identifier, is never altered.
// onConfirm receives the exact text the user typed (trimmed) so callers can
// forward it to their server action, which must independently re-verify it
// against the database record rather than trusting that the client-side
// `matches` gate was honestly evaluated.
export function TypedConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmValue,
  confirmPlaceholder,
  isSubmitting,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  confirmValue: string;
  confirmPlaceholder?: string;
  isSubmitting: boolean;
  onConfirm: (typedValue: string) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === confirmValue;

  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-body">{message}</p>
      <div className="mt-4">
        <Input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={confirmPlaceholder ?? confirmValue}
          disabled={isSubmitting}
          autoFocus
        />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
          {t.common.cancel}
        </Button>
        <Button variant="destructive" onClick={() => onConfirm(typed.trim())} disabled={isSubmitting || !matches}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
