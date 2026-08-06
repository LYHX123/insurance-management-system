"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { MoneyInput } from "@/components/ui/money-input";
import { createManualEntryAction, updateManualEntryAction, createLedgerCategoryAction } from "@/app/(app)/ledger/actions";
import type { ManualEntryRow, LedgerCategoryOption, LedgerTransactionType } from "@/components/ledger/types";

const ERROR_KEY: Record<string, string> = {
  DATE_REQUIRED: "dateRequired",
  TYPE_REQUIRED: "typeRequired",
  CATEGORY_REQUIRED: "categoryRequired",
  CATEGORY_NOT_FOUND: "categoryNotFound",
  CATEGORY_TYPE_MISMATCH: "categoryTypeMismatch",
  CATEGORY_INACTIVE: "categoryInactive",
  AMOUNT_INVALID: "amountInvalid",
  ENTRY_NOT_FOUND: "entryNotFound",
  CREATE_FAILED: "createFailed",
  UPDATE_FAILED: "updateFailed",
  FORBIDDEN: "forbidden",
  IDEMPOTENCY_KEY_REQUIRED: "createFailed",
};

const today = () => new Date().toISOString().slice(0, 10);

export function ManualEntryModal({
  categories,
  entry,
  fixedType,
  onClose,
  onSuccess,
}: {
  categories: LedgerCategoryOption[];
  entry: ManualEntryRow | null;
  fixedType: LedgerTransactionType;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useLocale();
  const isEditing = !!entry;
  // The transaction type is fixed for the lifetime of this modal instance:
  // chosen by the New Income / New Expense button for creation, or carried
  // over unchanged from the record being edited. There is no in-form way to
  // change it — this mirrors the existing immutable-category-type design
  // (see ledger/actions.ts) and this phase's spec ("Do not allow switching
  // an existing record between Income and Expense").
  const transactionType: LedgerTransactionType = entry?.transactionType ?? fixedType;

  const [localCategories, setLocalCategories] = useState(categories);
  const [transactionDate, setTransactionDate] = useState(entry ? entry.transactionDate.slice(0, 10) : today());
  const [categoryId, setCategoryId] = useState(entry?.categoryId ?? "");
  const [amount, setAmount] = useState(entry?.amount ?? "");
  const [paymentMethod, setPaymentMethod] = useState(entry?.paymentMethod ?? "");
  const [referenceNumber, setReferenceNumber] = useState(entry?.referenceNumber ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");

  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [quickCreateError, setQuickCreateError] = useState<string | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Production Readiness Audit V1, finding H6: only meaningful for the
  // create path (see createManualEntryAction's own doc comment on why
  // update doesn't need one) — still generated unconditionally per
  // modal-open since that's cheap and keeps this hook unconditional.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const availableCategories = useMemo(
    () => localCategories.filter((c) => c.transactionType === transactionType && (c.isActive || c.id === entry?.categoryId)),
    [localCategories, transactionType, entry]
  );

  const title = isEditing
    ? transactionType === "INCOME"
      ? t.ledger.editIncome
      : t.ledger.editExpense
    : transactionType === "INCOME"
      ? t.ledger.newIncome
      : t.ledger.newExpense;

  const handleQuickCreate = async () => {
    setQuickCreateError(null);
    const name = newCategoryName.trim();
    if (!name) {
      setQuickCreateError(t.ledger.categoryNameRequired);
      return;
    }
    setIsCreatingCategory(true);
    const result = await createLedgerCategoryAction({ name, transactionType });
    setIsCreatingCategory(false);
    if (!result.success) {
      setQuickCreateError(t.ledger[(ERROR_KEY[result.error] ?? "genericError") as keyof typeof t.ledger]);
      return;
    }
    setLocalCategories((prev) => [...prev, { id: result.id, name: result.name, transactionType: result.transactionType, isActive: true }]);
    setCategoryId(result.id);
    setNewCategoryName("");
    setShowQuickCreate(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!transactionDate) {
      setError(t.ledger.dateRequired);
      return;
    }
    if (!categoryId) {
      setError(t.ledger.categoryRequired);
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setError(t.ledger.amountInvalid);
      return;
    }

    setIsSubmitting(true);
    const payload = {
      transactionDate,
      transactionType,
      categoryId,
      amount,
      paymentMethod: paymentMethod || null,
      referenceNumber: referenceNumber || null,
      description: description || null,
    };
    const result = isEditing
      ? await updateManualEntryAction(entry!.id, payload)
      : await createManualEntryAction({ ...payload, idempotencyKey });
    setIsSubmitting(false);

    if (!result.success) {
      setError(t.ledger[(ERROR_KEY[result.error] ?? "genericError") as keyof typeof t.ledger]);
      return;
    }
    onSuccess();
  };

  return (
    <Modal title={title} onClose={onClose} width="md">
      <form onSubmit={handleSubmit} className="form-stack">
        <FormField label={t.ledger.date}>
          <Input type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} required />
        </FormField>

        <FormField label={t.ledger.category}>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            <option value="">{t.ledger.selectCategory}</option>
            {availableCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <button
            type="button"
            onClick={() => setShowQuickCreate((v) => !v)}
            className="mt-1.5 inline-flex items-center gap-1 self-start text-sm font-medium text-emerald-700 hover:underline"
          >
            <Plus size={14} />
            {t.ledger.createCategory}
          </button>
        </FormField>

        {showQuickCreate && (
          <div className="flex items-center gap-2 rounded-control border border-zinc-200 bg-zinc-50 p-3">
            <Input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder={t.ledger.categoryName}
              className="flex-1"
            />
            <Button type="button" onClick={handleQuickCreate} disabled={isCreatingCategory}>
              {t.common.create}
            </Button>
          </div>
        )}
        {quickCreateError && <p className="text-sm text-red-600">{quickCreateError}</p>}

        <FormField label={t.ledger.amount}>
          <MoneyInput value={amount} onChange={setAmount} required />
        </FormField>

        <FormField label={t.ledger.paymentMethodOptional}>
          <Input value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} />
        </FormField>

        <FormField label={t.ledger.referenceNumberOptional}>
          <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
        </FormField>

        <FormField label={t.ledger.descriptionOptional}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </FormField>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {t.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
