"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { createTaskAction } from "@/app/(app)/task/actions";
import type { TaskCategorySlug, ActiveUserOption } from "@/components/task/types";

const ERROR_KEY: Record<string, string> = {
  FORBIDDEN: "forbidden",
  INVALID_CATEGORY: "genericError",
  TITLE_REQUIRED: "titleRequired",
  TITLE_TOO_LONG: "genericError",
  CONTENT_REQUIRED: "startActionRequired",
  CONTENT_TOO_LONG: "genericError",
  USER_INACTIVE: "userInactive",
  CREATE_FAILED: "createFailed",
};

export function NewTaskModal({
  categorySlug,
  currentUserId,
  activeUsers,
  onClose,
}: {
  categorySlug: TaskCategorySlug;
  currentUserId: string;
  activeUsers: ActiveUserOption[];
  onClose: () => void;
}) {
  const { t } = useLocale();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [startAction, setStartAction] = useState("");
  // The creator is always preselected and locked — see this phase's spec,
  // Part E.15 ("Task creator cannot be deselected").
  const [selected, setSelected] = useState<Set<string>>(() => new Set([currentUserId]));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggle = (id: string) => {
    if (id === currentUserId) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError(t.task.titleRequired);
      return;
    }
    if (!startAction.trim()) {
      setError(t.task.startActionRequired);
      return;
    }

    setIsSubmitting(true);
    const result = await createTaskAction({
      categorySlug,
      title,
      startAction,
      participantIds: [...selected],
    });
    setIsSubmitting(false);

    if (!result.success) {
      setError(t.task[(ERROR_KEY[result.error] ?? "genericError") as keyof typeof t.task]);
      return;
    }
    router.push(`/task/${result.categorySlug}/${result.id}`);
    router.refresh();
  };

  return (
    <Modal title={t.task.newTask} onClose={onClose} width="md">
      <form onSubmit={handleSubmit} className="form-stack">
        <FormField label={t.task.taskTitle}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus />
        </FormField>

        <FormField label={t.task.taskStartAction}>
          <Textarea value={startAction} onChange={(e) => setStartAction(e.target.value)} rows={4} maxLength={4000} required />
        </FormField>

        <FormField label={t.task.participants}>
          <div className="max-h-56 overflow-y-auto rounded-control border border-zinc-200 divide-y divide-zinc-100">
            {activeUsers.map((u) => {
              const locked = u.id === currentUserId;
              return (
                <label key={u.id} className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${locked ? "bg-zinc-50" : ""}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(u.id)}
                    disabled={locked}
                    onChange={() => toggle(u.id)}
                    className="h-4 w-4 rounded border-zinc-300 disabled:opacity-60"
                  />
                  <span className="flex-1 text-zinc-800">
                    {u.name}
                    {u.role ? <span className="text-zinc-400"> · {u.role}</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
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
