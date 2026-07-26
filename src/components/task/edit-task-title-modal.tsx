"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { updateTaskTitleAction } from "@/app/(app)/task/actions";
import type { TaskDetail } from "@/components/task/types";

const ERROR_KEY: Record<string, string> = {
  FORBIDDEN: "forbidden",
  TASK_NOT_FOUND: "taskNotFound",
  TASK_NOT_ACTIVE: "taskNotActive",
  TITLE_REQUIRED: "titleRequired",
  TITLE_TOO_LONG: "genericError",
  UPDATE_FAILED: "updateFailed",
};

export function EditTaskTitleModal({ task, onClose, onSuccess }: { task: TaskDetail; onClose: () => void; onSuccess: () => void }) {
  const { t } = useLocale();
  const router = useRouter();

  const [title, setTitle] = useState(task.title);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError(t.task.titleRequired);
      return;
    }

    setIsSubmitting(true);
    const result = await updateTaskTitleAction(task.id, title);
    setIsSubmitting(false);

    if (!result.success) {
      setError(t.task[(ERROR_KEY[result.error] ?? "genericError") as keyof typeof t.task]);
      return;
    }
    router.refresh();
    onSuccess();
  };

  return (
    <Modal title={t.task.editTask} onClose={onClose} width="md">
      <form onSubmit={handleSubmit} className="form-stack">
        <FormField label={t.task.taskTitle}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus />
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
