"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { useLocale } from "@/i18n/locale-provider";
import { createUserAction, updateUserAction } from "@/app/(app)/users/actions";
import { MODULE_KEYS } from "@/lib/permissions";
import type { UserRow } from "@/components/users/types";

const languages = ["en", "zh"] as const;
const KENYAN_PHONE_REGEX = /^(?:\+254\d{9}|0\d{9})$/;

export function UserFormModal({
  user,
  isSelf,
  onClose,
  onSuccess,
}: {
  user: UserRow | null;
  isSelf: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const { t } = useLocale();
  const isEdit = !!user;

  const [username, setUsername] = useState(user?.username ?? "");
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(user?.role ?? "");
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber ?? "");
  const [permissions, setPermissions] = useState<string[]>(
    user?.permissions ?? []
  );
  const [preferredLanguage, setPreferredLanguage] = useState<
    (typeof languages)[number]
  >(user?.preferredLanguage ?? "en");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const languageLabel = {
    en: t.settings.english,
    zh: t.settings.chinese,
  };

  const togglePermission = (key: string) => {
    setPermissions((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedRole = role.trim();

    if (
      !username.trim() ||
      !fullName.trim() ||
      !trimmedRole ||
      (!isEdit && !password)
    ) {
      setError(t.users.requiredField);
      return;
    }

    if (phoneNumber.trim() && !KENYAN_PHONE_REGEX.test(phoneNumber.trim())) {
      setError(t.users.invalidPhone);
      return;
    }

    if (isSelf && !permissions.includes("users")) {
      setError(t.users.cannotRemoveOwnUsersPermission);
      return;
    }

    setIsSubmitting(true);

    const result = isEdit
      ? await updateUserAction(user.id, {
          username: username.trim(),
          fullName: fullName.trim(),
          role: trimmedRole,
          phoneNumber: phoneNumber.trim() || null,
          permissions,
          preferredLanguage,
        })
      : await createUserAction({
          username: username.trim(),
          fullName: fullName.trim(),
          password,
          role: trimmedRole,
          phoneNumber: phoneNumber.trim() || null,
          permissions,
          preferredLanguage,
        });

    setIsSubmitting(false);

    if (!result.success) {
      const errorMessage =
        result.error === "USERNAME_TAKEN"
          ? t.users.usernameTaken
          : result.error === "INVALID_PHONE"
          ? t.users.invalidPhone
          : result.error === "ROLE_REQUIRED"
          ? t.users.requiredField
          : result.error === "CANNOT_REMOVE_OWN_USERS_PERMISSION"
          ? t.users.cannotRemoveOwnUsersPermission
          : t.login.genericError;
      setError(errorMessage);
      return;
    }

    onSuccess(isEdit ? t.users.updateSuccess : t.users.createSuccess);
  };

  return (
    <Modal
      title={isEdit ? t.users.editUserTitle : t.users.createUserTitle}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="form-stack">
        <FormField label={t.users.username}>
          <Input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </FormField>

        <FormField label={t.users.fullName}>
          <Input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </FormField>

        {!isEdit && (
          <FormField label={t.users.password}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </FormField>
        )}

        <FormField label={t.users.role}>
          <Input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            required
          />
        </FormField>

        <FormField label={t.users.phoneNumber}>
          <Input
            type="tel"
            value={phoneNumber}
            placeholder="0712345678"
            onChange={(e) => setPhoneNumber(e.target.value)}
          />
        </FormField>

        <FormField label={t.users.preferredLanguage}>
          <Select
            value={preferredLanguage}
            onChange={(e) =>
              setPreferredLanguage(e.target.value as (typeof languages)[number])
            }
          >
            {languages.map((l) => (
              <option key={l} value={l}>
                {languageLabel[l]}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField label={t.users.permissions}>
          <div className="flex flex-col gap-2 rounded-control border border-zinc-200 p-3">
            <div className="mb-1 flex justify-end gap-3 text-xs font-medium">
              <button
                type="button"
                className="text-emerald-700 hover:underline"
                onClick={() => setPermissions([...MODULE_KEYS])}
              >
                {t.users.selectAll}
              </button>
              <button
                type="button"
                className="text-zinc-500 hover:underline"
                onClick={() =>
                  setPermissions(isSelf ? ["users"] : [])
                }
              >
                {t.users.clearAll}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {MODULE_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex items-center gap-2 text-sm text-zinc-700"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
                    checked={permissions.includes(key)}
                    disabled={isSelf && key === "users"}
                    onChange={() => togglePermission(key)}
                  />
                  {t.sidebar[key]}
                </label>
              ))}
            </div>
          </div>
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
