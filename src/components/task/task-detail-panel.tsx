"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil, Trash2, UserCog, CheckCircle2, RotateCcw, Plus } from "lucide-react";
import { SmartBackLink } from "@/components/ui/smart-back-link";
import { useLocale } from "@/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { completeTaskAction, reopenTaskAction, deleteTaskAction, deleteStepAction } from "@/app/(app)/task/actions";
import { EditTaskTitleModal } from "@/components/task/edit-task-title-modal";
import { ManageParticipantsModal } from "@/components/task/manage-participants-modal";
import { StepModal } from "@/components/task/step-modal";
import type { TaskCategorySlug, TaskDetail, TaskStepRow, ActiveUserOption } from "@/components/task/types";

type ConfirmKind = "complete" | "reopen" | "delete";

export function TaskDetailPanel({
  categorySlug,
  task,
  currentUserId,
  activeUsers,
}: {
  categorySlug: TaskCategorySlug;
  task: TaskDetail;
  currentUserId: string;
  activeUsers: ActiveUserOption[];
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  const isCreator = task.createdById === currentUserId;
  const isActive = task.status === "ACTIVE";

  const [showEditTitle, setShowEditTitle] = useState(false);
  const [showManageParticipants, setShowManageParticipants] = useState(false);
  const [showAddStep, setShowAddStep] = useState(false);
  const [editingStep, setEditingStep] = useState<TaskStepRow | null>(null);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [isConfirmBusy, setIsConfirmBusy] = useState(false);
  const [deletingStepId, setDeletingStepId] = useState<string | null>(null);
  const [isDeletingStep, setIsDeletingStep] = useState(false);

  const confirmTaskAction = async () => {
    if (!confirmKind) return;
    setIsConfirmBusy(true);
    const result =
      confirmKind === "complete" ? await completeTaskAction(task.id) : confirmKind === "reopen" ? await reopenTaskAction(task.id) : await deleteTaskAction(task.id);
    setIsConfirmBusy(false);
    setConfirmKind(null);
    if (result.success && confirmKind === "delete") {
      // replace, not push — a deleted task must not be reachable again via
      // the browser back button (Phase 8 Part 11). Preserve the current
      // search/status query string (Phase 8.1 Part 4) — those live in the
      // URL now (useUrlListState), so a bare category URL here would
      // silently reset the list's filters after a delete.
      const qs = searchParams.toString();
      router.replace(`/task/${categorySlug}${qs ? `?${qs}` : ""}`);
      return;
    }
    router.refresh();
  };

  const confirmDeleteStep = async () => {
    if (!deletingStepId) return;
    setIsDeletingStep(true);
    await deleteStepAction(deletingStepId);
    setIsDeletingStep(false);
    setDeletingStepId(null);
    router.refresh();
  };

  const confirmTitle: Record<ConfirmKind, string> = {
    complete: t.task.confirmCompleteTitle,
    reopen: t.task.confirmReopenTitle,
    delete: t.task.confirmDeleteTaskTitle,
  };
  const confirmMessage: Record<ConfirmKind, string> = {
    complete: t.task.confirmCompleteMessage,
    reopen: t.task.confirmReopenMessage,
    delete: t.task.confirmDeleteTaskMessage,
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto rounded-surface border border-zinc-200 bg-white p-card shadow-sm">
      <SmartBackLink fallbackHref={`/task/${categorySlug}`} label={t.task.backToTasks} className="md:hidden" />

      {/* Header */}
      <div className="flex flex-col gap-2 border-b border-zinc-100 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold break-words text-zinc-900">{task.title}</h1>
          <Badge tone={isActive ? "brand" : "success"}>{isActive ? t.task.active : t.task.completed}</Badge>
        </div>
        <p className="text-sm text-secondary">
          {t.task.createdBy} {task.createdByName} · {dateFormatter.format(new Date(task.createdAt))}
        </p>
        <p className="text-sm text-secondary break-words">
          {t.task.participants}: {task.participants.map((p) => p.fullName).join(", ")}
        </p>

        <div className="mt-1 flex flex-wrap gap-2">
          {isCreator && isActive && (
            <>
              <Button variant="secondary" onClick={() => setShowEditTitle(true)}>
                <Pencil size={16} />
                {t.task.editTask}
              </Button>
              <Button variant="secondary" onClick={() => setShowManageParticipants(true)}>
                <UserCog size={16} />
                {t.task.manageParticipants}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmKind("complete")}>
                <CheckCircle2 size={16} />
                {t.task.markAsCompleted}
              </Button>
              <Button variant="secondary" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setConfirmKind("delete")}>
                <Trash2 size={16} />
                {t.task.deleteTask}
              </Button>
            </>
          )}
          {isCreator && !isActive && (
            <>
              <Button variant="secondary" onClick={() => setConfirmKind("reopen")}>
                <RotateCcw size={16} />
                {t.task.reopenTask}
              </Button>
              <Button variant="secondary" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setConfirmKind("delete")}>
                <Trash2 size={16} />
                {t.task.deleteTask}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Step timeline */}
      <div className="flex flex-col gap-3">
        {task.steps.map((step, index) => {
          const canEdit = isActive && (step.createdById === currentUserId || isCreator);
          const isLastVisible = task.steps.length <= 1;
          return (
            <Card key={step.id}>
              <div className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800">
                  {index + 1}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <p className="whitespace-pre-wrap break-words text-sm text-zinc-800">{step.content}</p>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-400">
                    <span>
                      {t.task.createdBy} {step.createdByName} · {dateFormatter.format(new Date(step.createdAt))}
                    </span>
                    {step.editedAt && (
                      <span>
                        {t.task.edited} {dateFormatter.format(new Date(step.editedAt))}
                      </span>
                    )}
                  </div>
                  {canEdit && (
                    <div className="mt-1 flex items-center gap-1">
                      <IconButton title={t.common.edit} onClick={() => setEditingStep(step)}>
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton
                        title={isLastVisible ? t.task.atLeastOneStepRequired : t.common.delete}
                        onClick={() => setDeletingStepId(step.id)}
                        disabled={isLastVisible}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {isActive && (
        <div>
          <Button variant="secondary" onClick={() => setShowAddStep(true)}>
            <Plus size={16} />
            {t.task.addNextStep}
          </Button>
        </div>
      )}

      {showEditTitle && <EditTaskTitleModal task={task} onClose={() => setShowEditTitle(false)} onSuccess={() => setShowEditTitle(false)} />}

      {showManageParticipants && (
        <ManageParticipantsModal
          task={task}
          activeUsers={activeUsers}
          onClose={() => setShowManageParticipants(false)}
          onChanged={() => setShowManageParticipants(false)}
        />
      )}

      {showAddStep && <StepModal taskId={task.id} onClose={() => setShowAddStep(false)} onSuccess={() => setShowAddStep(false)} />}

      {editingStep && (
        <StepModal taskId={task.id} step={editingStep} onClose={() => setEditingStep(null)} onSuccess={() => setEditingStep(null)} />
      )}

      {confirmKind && (
        <ConfirmDialog
          title={confirmTitle[confirmKind]}
          message={confirmMessage[confirmKind]}
          isSubmitting={isConfirmBusy}
          onConfirm={confirmTaskAction}
          onClose={() => setConfirmKind(null)}
        />
      )}

      {deletingStepId && (
        <ConfirmDialog
          title={t.task.confirmDeleteStepTitle}
          message={t.task.confirmDeleteStepMessage}
          isSubmitting={isDeletingStep}
          onConfirm={confirmDeleteStep}
          onClose={() => setDeletingStepId(null)}
        />
      )}
    </div>
  );
}
