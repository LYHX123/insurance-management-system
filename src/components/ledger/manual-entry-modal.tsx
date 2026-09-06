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
import { categorySelectItems } from "@/lib/ledger/categoryView";
import { isManualLedgerPaymentMethod } from "@/lib/ledger/paymentMethods";
import { manualLedgerPaymentMethodOptions } from "@/components/ledger/paymentMethodLabels";
import type { ManualEntryRow, LedgerCategoryOption, LedgerTransactionType } from "@/components/ledger/types";

const COUNTERPARTY_DATALIST_ID = "ledger-counterparty-options";

const ERROR_KEY: Record<string, string> = {
  DATE_REQUIRED: "dateRequired",
  TYPE_REQUIRED: "typeRequired",
  CATEGORY_REQUIRED: "categoryRequired",
  CATEGORY_NOT_FOUND: "categoryNotFound",
  CATEGORY_TYPE_MISMATCH: "categoryTypeMismatch",
  CATEGORY_INACTIVE: "categoryInactive",
  CATEGORY_NOT_LEAF: "categoryLeafRequired",
  AMOUNT_INVALID: "amountInvalid",
  PAYMENT_METHOD_INVALID: "paymentMethodInvalid",
  ENTRY_NOT_FOUND: "entryNotFound",
  CREATE_FAILED: "createFailed",
  UPDATE_FAILED: "updateFailed",
  FORBIDDEN: "forbidden",
  IDEMPOTENCY_KEY_REQUIRED: "createFailed",
};

const today = () => new Date().toISOString().slice(0, 10);

export function ManualEntryModal({
  categories,
  counterpartyOptions,
  entry,
  fixedType,
  onClose,
  onSuccess,
}: {
  categories: LedgerCategoryOption[];
  counterpartyOptions: string[];
  entry: ManualEntryRow | null;
  fixedType: LedgerTransactionType;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useLocale();
  const isEditing = !!entry;
  const transactionType: LedgerTransactionType = entry?.transactionType ?? fixedType;

  const [localCategories, setLocalCategories] = useState(categories);
  const [transactionDate, setTransactionDate] = useState(entry ? entry.transactionDate.slice(0, 10) : today());
  const [categoryId, setCategoryId] = useState(entry?.categoryId ?? "");
  const [amount, setAmount] = useState(entry?.amount ?? "");
  const [paymentMethod, setPaymentMethod] = useState(entry?.paymentMethod ?? "");
  const [counterpartyName, setCounterpartyName] = useState(entry?.counterpartyName ?? "");
  const [referenceNumber, setReferenceNumber] = useState(entry?.referenceNumber ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");

  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [quickCreateError, setQuickCreateError] = useState<string | null>(null);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  // Tree-ordered category options. The entry's current category stays
  // selectable on edit even if it is now a branch / inactive.
  const categoryItems = useMemo(
    () => categorySelectItems(localCategories, transactionType, entry?.categoryId ?? null),
    [localCategories, transactionType, entry]
  );
  const selectedCategoryPath = useMemo(
    () => localCategories.find((c) => c.id === categoryId)?.path ?? "",
    [localCategories, categoryId]
  );

  const paymentMethodOptions = useMemo(() => manualLedgerPaymentMethodOptions(t.ledger), [t]);
  // A pre-12E entry may carry a value outside the four standard tokens. Keep
  // it selectable/visible so the row stays editable; it is only replaced if
  // the user actively picks a standard option.
  const legacyPaymentMethod =
    entry && entry.paymentMethod && !isManualLedgerPaymentMethod(entry.paymentMethod) ? entry.paymentMethod : null;

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
    // Quick-create always adds a ROOT leaf of the current type — deeper tree
    // editing lives in Manage Categories.
    const result = await createLedgerCategoryAction({ name, transactionType, parentId: null });
    setIsCreatingCategory(false);
    if (!result.success) {
      setQuickCreateError(t.ledger[(ERROR_KEY[result.error] ?? "genericError") as keyof typeof t.ledger]);
      return;
    }
    setLocalCategories((prev) => [
      ...prev,
      {
        id: result.id,
        name: result.name,
        transactionType: result.transactionType,
        isActive: true,
        parentId: result.parentId,
        sortOrder: result.sortOrder,
        depth: 1,
        path: result.name,
        isLeaf: true,
        effectivelyInactive: false,
      },
    ]);
    setCategoryId(result.id);
    setNewCategoryName("");
    setShowQuickCreate(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!transactionDate) return setError(t.ledger.dateRequired);
    if (!categoryId) return setError(t.ledger.categoryRequired);
    if (!amount || Number(amount) <= 0) return setError(t.ledger.amountInvalid);

    setIsSubmitting(true);
    const payload = {
      transactionDate,
      transactionType,
      categoryId,
      amount,
      paymentMethod: paymentMethod || null,
      counterpartyName: counterpartyName.trim() || null,
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
            {categoryItems.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.selectable}>
                {c.label}
              </option>
            ))}
          </Select>
          {selectedCategoryPath && <p className="mt-1 text-xs text-secondary">{selectedCategoryPath}</p>}
          <p className="mt-1 text-xs text-zinc-400">{t.ledger.categoryLeafRequired}</p>
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

        <FormField label={t.ledger.counterparty}>
          <Input
            value={counterpartyName}
            onChange={(e) => setCounterpartyName(e.target.value)}
            list={COUNTERPARTY_DATALIST_ID}
            placeholder={t.ledger.counterpartyPlaceholder}
          />
          <datalist id={COUNTERPARTY_DATALIST_ID}>
            {counterpartyOptions.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </FormField>

        <FormField label={t.ledger.amount}>
          <MoneyInput value={amount} onChange={setAmount} required />
        </FormField>

        <FormField label={t.ledger.paymentMethod}>
          <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
            <option value="">{t.ledger.selectPaymentMethod}</option>
            {paymentMethodOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {legacyPaymentMethod && (
              <option value={legacyPaymentMethod}>
                {t.ledger.legacyPaymentMethod}: {legacyPaymentMethod}
              </option>
            )}
          </Select>
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
