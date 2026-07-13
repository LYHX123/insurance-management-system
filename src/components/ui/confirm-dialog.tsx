"use client";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/i18n/locale-provider";

export function ConfirmDialog({
  title,
  message,
  isSubmitting,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  isSubmitting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useLocale();

  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-body">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
          {t.common.cancel}
        </Button>
        <Button variant="destructive" onClick={onConfirm} disabled={isSubmitting}>
          {t.common.confirm}
        </Button>
      </div>
    </Modal>
  );
}
