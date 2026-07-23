"use client";

import { useState } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput } from "@/components/ui/money-input";
import { resolveBalanceVerificationAction } from "@/app/(app)/policy/motor/actions";

const ERROR_KEY: Record<string, string> = {
  RECORD_NOT_FOUND: "recordNotFound",
  RESOLUTION_NOTE_REQUIRED: "resolutionNoteRequired",
  ALREADY_VERIFIED: "genericError",
  AMOUNT_INVALID: "amountInvalid",
  FORBIDDEN: "genericError",
  RESOLVE_FAILED: "genericError",
};

export function ResolveBalanceModal({
  policyRecordId,
  side,
  currentAmount,
  onClose,
  onSuccess,
}: {
  policyRecordId: string;
  side: "insurer" | "client";
  currentAmount: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useLocale();
  const [correctedAmount, setCorrectedAmount] = useState(currentAmount);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (!note.trim()) {
      setError(t.policy.resolutionNoteRequired);
      return;
    }
    setIsSubmitting(true);
    const result = await resolveBalanceVerificationAction(policyRecordId, {
      side,
      correctedAmount: correctedAmount || null,
      note,
    });
    setIsSubmitting(false);
    if (!result.success) {
      setError(t.policy[(ERROR_KEY[result.error] ?? "genericError") as keyof typeof t.policy]);
      return;
    }
    onSuccess();
  };

  return (
    <Modal title={t.policy.resolveBalanceTitle} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-secondary">{t.policy.resolveBalanceDescription}</p>
        <FormField label={side === "insurer" ? t.policy.insurerCost : t.policy.clientPremium}>
          <MoneyInput value={correctedAmount} onChange={setCorrectedAmount} />
        </FormField>
        <FormField label={t.policy.resolutionNote}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </FormField>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
          {t.common.cancel}
        </Button>
        <Button onClick={handleSubmit} disabled={isSubmitting}>
          {t.policy.markVerified}
        </Button>
      </div>
    </Modal>
  );
}
