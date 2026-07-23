"use client";

import { useState } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput } from "@/components/ui/money-input";
import { updateCommissionAction } from "@/app/(app)/policy/motor/actions";
import type { MotorDetail } from "@/components/policy/types";

const ERROR_KEY: Record<string, string> = {
  RECORD_NOT_FOUND: "recordNotFound",
  COMMISSION_AMOUNT_INVALID: "commissionAmountInvalid",
  COMMISSION_DATE_REQUIRED: "commissionDateRequired",
  FORBIDDEN: "genericError",
  UPDATE_FAILED: "genericError",
};

// Deliberately just these three fields (Phase 1B, Section 2) — no payment
// method, reference number, tax, notes, attachment, insurer selection,
// multiple receipt rows, or balance/outstanding status. Saving never
// creates a CustomerReceipt/PolicyProviderPayment and never touches any
// balance — see updateCommissionAction's doc comment.
export function EditCommissionModal({
  detail,
  onClose,
  onSuccess,
}: {
  detail: MotorDetail;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useLocale();
  const [commissionReceived, setCommissionReceived] = useState(detail.commissionReceived);
  const [commissionAmount, setCommissionAmount] = useState(detail.commissionAmount ?? "");
  const [commissionReceivedDate, setCommissionReceivedDate] = useState(
    detail.commissionReceivedDate ? detail.commissionReceivedDate.slice(0, 10) : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (commissionReceived) {
      if (!commissionAmount || Number(commissionAmount) < 0) {
        setError(t.policy.commissionAmountInvalid);
        return;
      }
      if (!commissionReceivedDate) {
        setError(t.policy.commissionDateRequired);
        return;
      }
    }
    setIsSubmitting(true);
    const result = await updateCommissionAction(detail.id, {
      commissionReceived,
      commissionAmount: commissionReceived ? commissionAmount : null,
      commissionReceivedDate: commissionReceived ? commissionReceivedDate || null : null,
    });
    setIsSubmitting(false);
    if (!result.success) {
      setError(t.policy[(ERROR_KEY[result.error] ?? "genericError") as keyof typeof t.policy]);
      return;
    }
    onSuccess();
  };

  return (
    <Modal title={t.policy.editCommission} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={commissionReceived}
            onChange={(e) => setCommissionReceived(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300"
            disabled={isSubmitting}
          />
          {t.policy.commissionReceived}
        </label>
        {commissionReceived && (
          <>
            <FormField label={t.policy.commissionAmount}>
              <MoneyInput value={commissionAmount} onChange={setCommissionAmount} disabled={isSubmitting} />
            </FormField>
            <FormField label={t.policy.commissionReceivedDate}>
              <Input
                type="date"
                value={commissionReceivedDate}
                onChange={(e) => setCommissionReceivedDate(e.target.value)}
                disabled={isSubmitting}
              />
            </FormField>
          </>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
          {t.common.cancel}
        </Button>
        <Button onClick={handleSubmit} disabled={isSubmitting}>
          {t.common.save}
        </Button>
      </div>
    </Modal>
  );
}
