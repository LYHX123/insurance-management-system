"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Plus } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ClaimTimelineRow } from "@/components/claims/types";

type ActionResult = { success: true } | { success: false; error: string };

const ERROR_KEY: Record<string, string> = {
  FORBIDDEN: "forbidden",
  CLAIM_NOT_FOUND: "claimNotFound",
  CLAIM_NOT_OPEN: "claimNotOpen",
  UPDATE_NOT_FOUND: "claimNotFound",
  CONTENT_REQUIRED: "contentRequired",
  CONTENT_TOO_LONG: "genericError",
  MIN_TIMELINE_REQUIRED: "atLeastOneTimelineRequired",
  CREATE_FAILED: "createFailed",
  UPDATE_FAILED: "updateFailed",
};

// Shared between the Motor Claim and Non-Motor Claim detail views (see this
// phase's spec, Part K.40) — never imported by Daily Task, which keeps its
// own separate TaskStep timeline UI untouched (Part A). The three action
// callbacks are the only category-specific piece, bound by the caller to
// the correct Motor/Non-Motor server actions.
export function ClaimTimelinePanel({
  claimId,
  timeline,
  isOpen,
  currentUserId,
  isCreator,
  canEdit: hasEditPermission,
  addAction,
  editAction,
  deleteAction,
}: {
  claimId: string;
  timeline: ClaimTimelineRow[];
  isOpen: boolean;
  currentUserId: string;
  isCreator: boolean;
  // Renamed on destructure — this component already has an unrelated local
  // `canEdit` (per-entry "is this specific update still editable" boolean);
  // this prop is the module-level VIEW/EDIT permission.
  canEdit: boolean;
  addAction: (claimId: string, content: string) => Promise<ActionResult & { id?: string }>;
  editAction: (updateId: string, content: string) => Promise<ActionResult>;
  deleteAction: (updateId: string) => Promise<ActionResult>;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  const [showAdd, setShowAdd] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ClaimTimelineRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const openAdd = () => {
    setContent("");
    setError(null);
    setShowAdd(true);
  };
  const openEdit = (entry: ClaimTimelineRow) => {
    setContent(entry.content);
    setError(null);
    setEditingEntry(entry);
  };
  const closeModal = () => {
    setShowAdd(false);
    setEditingEntry(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) {
      setError(t.claims.contentRequired);
      return;
    }
    setIsSubmitting(true);
    const result = editingEntry ? await editAction(editingEntry.id, trimmed) : await addAction(claimId, trimmed);
    setIsSubmitting(false);
    if (!result.success) {
      setError(t.claims[(ERROR_KEY[result.error] ?? "genericError") as keyof typeof t.claims]);
      return;
    }
    closeModal();
    router.refresh();
  };

  const confirmDelete = async () => {
    if (!deletingId) return;
    setIsSubmitting(true);
    await deleteAction(deletingId);
    setIsSubmitting(false);
    setDeletingId(null);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <h2 className="section-title">{t.claims.claimTimeline}</h2>

      {timeline.map((entry, index) => {
        const canEditEntry = hasEditPermission && isOpen && !entry.isInitial && (entry.createdById === currentUserId || isCreator);
        return (
          <Card key={entry.id}>
            <div className="flex gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800">
                {index + 1}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <p className="whitespace-pre-wrap break-words text-sm text-zinc-800">{entry.content}</p>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-400">
                  <span>
                    {t.task.createdBy} {entry.createdByName} · {dateFormatter.format(new Date(entry.createdAt))}
                  </span>
                  {entry.editedAt && (
                    <span>
                      {t.task.edited} {dateFormatter.format(new Date(entry.editedAt))}
                    </span>
                  )}
                </div>
                {canEditEntry && (
                  <div className="mt-1 flex items-center gap-1">
                    <IconButton title={t.claims.editClaimUpdate} onClick={() => openEdit(entry)}>
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton title={t.claims.deleteClaimUpdate} onClick={() => setDeletingId(entry.id)}>
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                )}
              </div>
            </div>
          </Card>
        );
      })}

      {hasEditPermission && isOpen && (
        <div>
          <Button variant="secondary" onClick={openAdd}>
            <Plus size={16} />
            {t.claims.addClaimUpdate}
          </Button>
        </div>
      )}

      {(showAdd || editingEntry) && (
        <Modal title={editingEntry ? t.claims.editClaimUpdate : t.claims.addClaimUpdate} onClose={closeModal} width="md">
          <form onSubmit={handleSubmit} className="form-stack">
            <FormField label={t.claims.updateContent}>
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} maxLength={4000} required autoFocus />
            </FormField>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={closeModal} disabled={isSubmitting}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {t.common.save}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {deletingId && (
        <ConfirmDialog
          title={t.claims.deleteClaimUpdate}
          message={t.claims.confirmDeleteUpdateMessage}
          isSubmitting={isSubmitting}
          onConfirm={confirmDelete}
          onClose={() => setDeletingId(null)}
        />
      )}
    </div>
  );
}
