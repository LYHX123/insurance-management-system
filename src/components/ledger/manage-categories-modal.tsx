"use client";

import { useState } from "react";
import { Plus, Check, X as XIcon } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { createLedgerCategoryAction, updateLedgerCategoryAction } from "@/app/(app)/ledger/actions";
import type { LedgerCategoryOption, LedgerTransactionType } from "@/components/ledger/types";

const ERROR_KEY: Record<string, string> = {
  CATEGORY_NAME_REQUIRED: "categoryNameRequired",
  CATEGORY_DUPLICATE: "categoryDuplicate",
  CATEGORY_NOT_FOUND: "categoryNotFound",
  TYPE_REQUIRED: "genericError",
  FORBIDDEN: "forbidden",
};

function CategoryColumn({
  title,
  type,
  categories,
  onCreate,
  onRename,
  onToggleActive,
  busyId,
}: {
  title: string;
  type: LedgerTransactionType;
  categories: LedgerCategoryOption[];
  onCreate: (type: LedgerTransactionType, name: string) => Promise<string | null>;
  onRename: (id: string, name: string) => Promise<string | null>;
  onToggleActive: (category: LedgerCategoryOption) => Promise<string | null>;
  busyId: string | null;
}) {
  const { t } = useLocale();
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreateError(null);
    const err = await onCreate(type, newName);
    if (err) {
      setCreateError(err);
      return;
    }
    setNewName("");
  };

  const startRename = (c: LedgerCategoryOption) => {
    setRenamingId(c.id);
    setRenameValue(c.name);
    setRenameError(null);
  };

  const confirmRename = async (id: string) => {
    const err = await onRename(id, renameValue);
    if (err) {
      setRenameError(err);
      return;
    }
    setRenamingId(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-zinc-700">{title}</h3>
      <div className="flex items-center gap-2">
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t.ledger.categoryName} className="flex-1" />
        <Button type="button" variant="secondary" onClick={handleCreate} disabled={busyId !== null}>
          <Plus size={16} />
        </Button>
      </div>
      {createError && <p className="text-xs text-red-600">{createError}</p>}

      <ul className="flex flex-col divide-y divide-zinc-100 rounded-control border border-zinc-200">
        {categories.length === 0 && <li className="p-3 text-sm text-secondary">{t.ledger.noCategoriesYet}</li>}
        {categories.map((c) => (
          <li key={c.id} className="flex min-h-[52px] flex-wrap items-center justify-between gap-2 p-3">
            {renamingId === c.id ? (
              <>
                <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="min-w-0 flex-1" />
                <div className="flex flex-shrink-0 items-center gap-1">
                  <IconButton title={t.common.save} onClick={() => confirmRename(c.id)} disabled={busyId === c.id}>
                    <Check size={16} />
                  </IconButton>
                  <IconButton title={t.common.cancel} onClick={() => setRenamingId(null)}>
                    <XIcon size={16} />
                  </IconButton>
                </div>
              </>
            ) : (
              <>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="min-w-0 truncate text-sm text-zinc-800" title={c.name}>
                    {c.name}
                  </span>
                  <Badge tone={c.isActive ? "success" : "neutral"}>{c.isActive ? t.ledger.active : t.ledger.inactive}</Badge>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <Button type="button" variant="secondary" onClick={() => startRename(c)} disabled={busyId !== null}>
                    {t.ledger.rename}
                  </Button>
                  <Button
                    type="button"
                    variant={c.isActive ? "destructive" : "secondary"}
                    onClick={() => onToggleActive(c)}
                    disabled={busyId !== null}
                  >
                    {c.isActive ? t.ledger.deactivate : t.ledger.reactivate}
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {renameError && <p className="text-xs text-red-600">{renameError}</p>}
    </div>
  );
}

export function ManageCategoriesModal({
  categories,
  onClose,
  onChanged,
}: {
  categories: LedgerCategoryOption[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const [localCategories, setLocalCategories] = useState(categories);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const translateError = (code: string) => t.ledger[(ERROR_KEY[code] ?? "genericError") as keyof typeof t.ledger];

  const handleCreate = async (type: LedgerTransactionType, name: string): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) return t.ledger.categoryNameRequired;
    setBusyId("__creating__");
    const result = await createLedgerCategoryAction({ name: trimmed, transactionType: type });
    setBusyId(null);
    if (!result.success) return translateError(result.error);
    setLocalCategories((prev) => [...prev, { id: result.id, name: result.name, transactionType: result.transactionType, isActive: true }]);
    setHasChanges(true);
    return null;
  };

  const handleRename = async (id: string, name: string): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) return t.ledger.categoryNameRequired;
    setBusyId(id);
    const result = await updateLedgerCategoryAction(id, { name: trimmed });
    setBusyId(null);
    if (!result.success) return translateError(result.error);
    setLocalCategories((prev) => prev.map((c) => (c.id === id ? { ...c, name: trimmed } : c)));
    setHasChanges(true);
    return null;
  };

  const handleToggleActive = async (category: LedgerCategoryOption): Promise<string | null> => {
    setBusyId(category.id);
    const result = await updateLedgerCategoryAction(category.id, { isActive: !category.isActive });
    setBusyId(null);
    if (!result.success) return translateError(result.error);
    setLocalCategories((prev) => prev.map((c) => (c.id === category.id ? { ...c, isActive: !c.isActive } : c)));
    setHasChanges(true);
    return null;
  };

  const handleClose = () => {
    if (hasChanges) onChanged();
    onClose();
  };

  const incomeCategories = localCategories.filter((c) => c.transactionType === "INCOME");
  const expenseCategories = localCategories.filter((c) => c.transactionType === "EXPENSE");

  return (
    <Modal title={t.ledger.manageCategories} onClose={handleClose} width="lg">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <CategoryColumn
          title={t.ledger.incomeCategory}
          type="INCOME"
          categories={incomeCategories}
          onCreate={handleCreate}
          onRename={handleRename}
          onToggleActive={handleToggleActive}
          busyId={busyId}
        />
        <CategoryColumn
          title={t.ledger.expenseCategory}
          type="EXPENSE"
          categories={expenseCategories}
          onCreate={handleCreate}
          onRename={handleRename}
          onToggleActive={handleToggleActive}
          busyId={busyId}
        />
      </div>
      <div className="mt-6 flex justify-end">
        <Button type="button" variant="secondary" onClick={handleClose}>
          {t.common.close}
        </Button>
      </div>
    </Modal>
  );
}
