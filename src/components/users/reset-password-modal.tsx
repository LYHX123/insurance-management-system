"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { useLocale } from "@/i18n/locale-provider";
import { resetPasswordAction } from "@/app/(app)/users/actions";

export function ResetPasswordModal({
  userId,
  onClose,
  onSuccess,
}: {
  userId: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const { t } = useLocale();
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!newPassword) {
      setError(t.users.requiredField);
      return;
    }

    setIsSubmitting(true);
    const result = await resetPasswordAction(userId, newPassword);
    setIsSubmitting(false);

    if (!result.success) {
      setError(t.login.genericError);
      return;
    }

    onSuccess(t.users.resetPasswordSuccess);
  };

  return (
    <Modal title={t.users.resetPasswordTitle} onClose={onClose}>
      <form onSubmit={handleSubmit} className="form-stack">
        <FormField label={t.users.newPassword}>
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </FormField>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
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
