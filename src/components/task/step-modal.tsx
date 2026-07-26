"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { addStepAction, updateStepAction } from "@/app/(app)/task/actions";
import type { TaskStepRow } from "@/components/task/types";

const ERROR_KEY: Record<string, string> = {
  FORBIDDEN: "forbidden",
  TASK_NOT_FOUND: "taskNotFound",
  TASK_NOT_ACTIVE: "taskNotActive",
  STEP_NOT_FOUND: "taskNotFound",
  CONTENT_REQUIRED: "contentRequired",
  CONTENT_TOO_LONG: "genericError",
  CREATE_FAILED: "createFailed",
  UPDATE_FAILED: "updateFailed",
};

export function StepModal({
  taskId,
  step,
  onClose,
  onSuccess,
}: {
  taskId: string;
  // Omit for "add next step"; pass the step being edited for "edit step".
  step?: TaskStepRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const isEditing = !!step;

  const [content, setContent] = useState(step?.content ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = content.trim();
    if (!trimmed) {
      setError(t.task.contentRequired);
      return;
    }

    setIsSubmitting(true);
    const result = isEditing ? await updateStepAction(step!.id, trimmed) : await addStepAction(taskId, trimmed);
    setIsSubmitting(false);

    if (!result.success) {
      setError(t.task[(ERROR_KEY[result.error] ?? "genericError") as keyof typeof t.task]);
      return;
    }
    router.refresh();
    onSuccess();
  };

  return (
    <Modal title={isEditing ? t.task.editStep : t.task.addNextStep} onClose={onClose} width="md">
      <form onSubmit={handleSubmit} className="form-stack">
        <FormField label={t.task.actionContent}>
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} maxLength={4000} required autoFocus />
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
