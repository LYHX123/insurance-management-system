"use client";

import { useState } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput } from "@/components/ui/money-input";
import { addProviderPaymentAction } from "@/app/(app)/policy/motor/actions";

const ERROR_KEY: Record<string, string> = {
  RECORD_NOT_FOUND: "recordNotFound",
  PAYMENT_DATE_REQUIRED: "paymentDateRequired",
  AMOUNT_INVALID: "amountInvalid",
  FORBIDDEN: "genericError",
  CREATE_FAILED: "createFailedError",
  IDEMPOTENCY_KEY_REQUIRED: "genericError",
};

export function AddPaymentModal({
  policyRecordId,
  onClose,
  onSuccess,
}: {
  policyRecordId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useLocale();
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Production Readiness Audit V1, finding H6 — see add-receipt-modal.tsx's
  // idempotencyKey doc comment.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const handleSubmit = async () => {
    setError(null);
    if (!paymentDate) {
      setError(t.policy.paymentDateRequired);
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError(t.policy.amountInvalid);
      return;
    }
    setIsSubmitting(true);
    const result = await addProviderPaymentAction(policyRecordId, {
      paymentDate,
      amount,
      paymentMethod: paymentMethod || null,
      referenceNumber: referenceNumber || null,
      notes: notes || null,
      idempotencyKey,
    });
    setIsSubmitting(false);
    if (!result.success) {
      setError(t.policy[(ERROR_KEY[result.error] ?? "genericError") as keyof typeof t.policy]);
      return;
    }
    onSuccess();
  };

  return (
    <Modal title={t.policy.addPayment} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <FormField label={t.policy.paymentDate}>
          <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
        </FormField>
        <FormField label={t.policy.amount}>
          <MoneyInput value={amount} onChange={setAmount} />
        </FormField>
        <FormField label={t.policy.paymentMethodOptional}>
          <Input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} />
        </FormField>
        <FormField label={t.policy.referenceNumberOptional}>
          <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
        </FormField>
        <FormField label={t.policy.notesOptional}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </FormField>
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
