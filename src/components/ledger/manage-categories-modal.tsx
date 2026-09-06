"use client";

import { useMemo, useState } from "react";
import { Plus, Check, X as XIcon, ChevronUp, ChevronDown, Pencil, Trash2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  createLedgerCategoryAction,
  updateLedgerCategoryAction,
  reorderLedgerCategoryAction,
  deleteLedgerCategoryAction,
} from "@/app/(app)/ledger/actions";
import { MAX_LEDGER_CATEGORY_DEPTH } from "@/lib/ledger/categoryTree";
import type { LedgerCategoryOption, LedgerTransactionType } from "@/components/ledger/types";

const ERROR_KEY: Record<string, string> = {
  CATEGORY_NAME_REQUIRED: "categoryNameRequired",
  CATEGORY_DUPLICATE: "categoryDuplicate",
  CATEGORY_NOT_FOUND: "categoryNotFound",
  PARENT_NOT_FOUND: "categoryNotFound",
  MAX_DEPTH_REACHED: "categoryMaxDepth",
  CATEGORY_SELF_PARENT: "categoryCycle",
  CATEGORY_CYCLE: "categoryCycle",
  CATEGORY_TYPE_MISMATCH: "categoryTypeMismatch",
  CATEGORY_HAS_CHILDREN: "categoryHasChildren",
  CATEGORY_IN_USE: "categoryInUse",
  TYPE_REQUIRED: "genericError",
  FORBIDDEN: "forbidden",
};

function CategoryTree({
  type,
  title,
  categories,
  onChanged,
}: {
  type: LedgerTransactionType;
  title: string;
  categories: LedgerCategoryOption[];
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const translateError = (code: string) => t.ledger[(ERROR_KEY[code] ?? "genericError") as keyof typeof t.ledger] as string;

  const nodes = useMemo(() => categories.filter((c) => c.transactionType === type), [categories, type]);
  const roots = useMemo(() => nodes.filter((c) => c.parentId === null), [nodes]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [addChildFor, setAddChildFor] = useState<string | "ROOT" | null>(null);
  const [addChildName, setAddChildName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<LedgerCategoryOption | null>(null);

  const siblingsOf = (parentId: string | null) => nodes.filter((c) => c.parentId === parentId);

  const run = async (fn: () => Promise<{ success: boolean; error?: string }>, id: string) => {
    setError(null);
    setBusyId(id);
    const result = await fn();
    setBusyId(null);
    if (!result.success) {
      setError(translateError(result.error ?? "genericError"));
      return false;
    }
    onChanged();
    return true;
  };

  const handleAddChild = async (parentId: string | null) => {
    const name = addChildName.trim();
    if (!name) {
      setError(t.ledger.categoryNameRequired);
      return;
    }
    const ok = await run(
      () =>
        createLedgerCategoryAction(
          parentId === null ? { name, transactionType: type, parentId: null } : { name, parentId }
        ),
      parentId ?? "ROOT"
    );
    if (ok) {
      setAddChildName("");
      setAddChildFor(null);
    }
  };

  const handleRename = async (id: string) => {
    const name = renameValue.trim();
    if (!name) {
      setError(t.ledger.categoryNameRequired);
      return;
    }
    const ok = await run(() => updateLedgerCategoryAction(id, { name }), id);
    if (ok) setRenamingId(null);
  };

  const renderNode = (node: LedgerCategoryOption) => {
    const children = siblingsOf(node.id);
    const siblings = siblingsOf(node.parentId);
    const pos = siblings.findIndex((s) => s.id === node.id);
    const canAddChild = node.depth < MAX_LEDGER_CATEGORY_DEPTH;

    return (
      <div key={node.id}>
        <div
          className="flex min-h-[48px] flex-wrap items-center justify-between gap-2 border-b border-zinc-100 py-2"
          style={{ paddingLeft: `${(node.depth - 1) * 20}px` }}
        >
          {renamingId === node.id ? (
            <>
              <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="min-w-0 flex-1" />
              <div className="flex flex-shrink-0 items-center gap-1">
                <IconButton title={t.common.save} onClick={() => handleRename(node.id)} disabled={busyId === node.id}>
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
                <span className="min-w-0 truncate text-sm text-zinc-800" title={node.path}>
                  {node.name}
                </span>
                {!node.isActive && <Badge tone="neutral">{t.ledger.inactive}</Badge>}
              </div>
              <div className="flex flex-shrink-0 flex-wrap items-center gap-1">
                <IconButton
                  title={t.common.moveUp}
                  onClick={() => run(() => reorderLedgerCategoryAction(node.id, "UP"), node.id)}
                  disabled={busyId !== null || pos <= 0}
                >
                  <ChevronUp size={16} />
                </IconButton>
                <IconButton
                  title={t.common.moveDown}
                  onClick={() => run(() => reorderLedgerCategoryAction(node.id, "DOWN"), node.id)}
                  disabled={busyId !== null || pos === siblings.length - 1}
                >
                  <ChevronDown size={16} />
                </IconButton>
                {canAddChild && (
                  <IconButton
                    title={t.ledger.addChild}
                    onClick={() => {
                      setAddChildFor(node.id);
                      setAddChildName("");
                      setError(null);
                    }}
                    disabled={busyId !== null}
                  >
                    <Plus size={16} />
                  </IconButton>
                )}
                <IconButton
                  title={t.common.edit}
                  onClick={() => {
                    setRenamingId(node.id);
                    setRenameValue(node.name);
                    setError(null);
                  }}
                  disabled={busyId !== null}
                >
                  <Pencil size={16} />
                </IconButton>
                <Button
                  type="button"
                  variant={node.isActive ? "destructive" : "secondary"}
                  onClick={() => run(() => updateLedgerCategoryAction(node.id, { isActive: !node.isActive }), node.id)}
                  disabled={busyId !== null}
                >
                  {node.isActive ? t.ledger.deactivate : t.ledger.reactivate}
                </Button>
                <IconButton title={t.common.delete} onClick={() => setDeleting(node)} disabled={busyId !== null}>
                  <Trash2 size={16} />
                </IconButton>
              </div>
            </>
          )}
        </div>

        {addChildFor === node.id && (
          <div className="flex items-center gap-2 py-2" style={{ paddingLeft: `${node.depth * 20}px` }}>
            <Input
              value={addChildName}
              onChange={(e) => setAddChildName(e.target.value)}
              placeholder={t.ledger.categoryName}
              className="flex-1"
            />
            <Button type="button" onClick={() => handleAddChild(node.id)} disabled={busyId !== null}>
              {t.common.add}
            </Button>
            <IconButton title={t.common.cancel} onClick={() => setAddChildFor(null)}>
              <XIcon size={16} />
            </IconButton>
          </div>
        )}

        {children.map(renderNode)}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-700">{title}</h3>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setAddChildFor("ROOT");
            setAddChildName("");
            setError(null);
          }}
          disabled={busyId !== null}
        >
          <Plus size={16} />
          {t.ledger.addRootCategory}
        </Button>
      </div>

      {addChildFor === "ROOT" && (
        <div className="flex items-center gap-2">
          <Input
            value={addChildName}
            onChange={(e) => setAddChildName(e.target.value)}
            placeholder={t.ledger.categoryName}
            className="flex-1"
          />
          <Button type="button" onClick={() => handleAddChild(null)} disabled={busyId !== null}>
            {t.common.add}
          </Button>
          <IconButton title={t.common.cancel} onClick={() => setAddChildFor(null)}>
            <XIcon size={16} />
          </IconButton>
        </div>
      )}

      <div className="rounded-control border border-zinc-200 px-3">
        {roots.length === 0 && <p className="py-3 text-sm text-secondary">{t.ledger.noCategoriesYet}</p>}
        {roots.map(renderNode)}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {deleting && (
        <ConfirmDialog
          title={t.ledger.deleteCategoryConfirmTitle}
          message={t.ledger.deleteCategoryConfirmMessage}
          isSubmitting={busyId === deleting.id}
          onConfirm={async () => {
            const ok = await run(() => deleteLedgerCategoryAction(deleting.id), deleting.id);
            if (ok) setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        />
      )}
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
  const [touched, setTouched] = useState(false);

  const handleChanged = () => {
    setTouched(true);
    onChanged();
  };

  const handleClose = () => {
    if (touched) onChanged();
    onClose();
  };

  return (
    <Modal title={t.ledger.manageCategories} onClose={handleClose} width="lg">
      <p className="mb-4 text-xs text-secondary">{t.ledger.categoryHierarchyHint}</p>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <CategoryTree type="INCOME" title={t.ledger.incomeCategory} categories={categories} onChanged={handleChanged} />
        <CategoryTree type="EXPENSE" title={t.ledger.expenseCategory} categories={categories} onChanged={handleChanged} />
      </div>
      <div className="mt-6 flex justify-end">
        <Button type="button" variant="secondary" onClick={handleClose}>
          {t.common.close}
        </Button>
      </div>
    </Modal>
  );
}
