"use client";

import { useState } from "react";
import { useLocale } from "@/i18n/locale-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput } from "@/components/ui/money-input";
import { addCustomerReceiptAction } from "@/app/(app)/policy/motor/actions";

const ERROR_KEY: Record<string, string> = {
  RECORD_NOT_FOUND: "recordNotFound",
  RECEIPT_DATE_REQUIRED: "receiptDateRequired",
  AMOUNT_INVALID: "amountInvalid",
  FORBIDDEN: "genericError",
  CREATE_FAILED: "createFailedError",
  IDEMPOTENCY_KEY_REQUIRED: "genericError",
};

export function AddReceiptModal({
  policyRecordId,
  onClose,
  onSuccess,
}: {
  policyRecordId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useLocale();
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Production Readiness Audit V1, finding H6: one key per modal-open (this
  // component is unmounted/remounted by its parent on each "Add Receipt"
  // click — see motor-financial-tab.tsx), reused across any retry of the
  // same submission so a double-click or network retry can only ever create
  // one receipt server-side.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const handleSubmit = async () => {
    setError(null);
    if (!receiptDate) {
      setError(t.policy.receiptDateRequired);
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError(t.policy.amountInvalid);
      return;
    }
    setIsSubmitting(true);
    const result = await addCustomerReceiptAction(policyRecordId, {
      receiptDate,
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
    <Modal title={t.policy.addReceipt} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <FormField label={t.policy.receiptDate}>
          <Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} required />
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
