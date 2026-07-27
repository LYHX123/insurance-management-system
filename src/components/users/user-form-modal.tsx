"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { useLocale } from "@/i18n/locale-provider";
import { createUserAction, updateUserAction } from "@/app/(app)/users/actions";
import {
  PERMISSION_GROUPS,
  isAdminRole,
  type PermissionKey,
} from "@/lib/permissions";
import type { UserRow } from "@/components/users/types";

const languages = ["en", "zh"] as const;
const KENYAN_PHONE_REGEX = /^(?:\+254\d{9}|0\d{9})$/;
const MIN_PASSWORD_LENGTH = 8;

const SELECT_ALL_LABEL_KEY: Record<string, "selectAllPolicy" | "selectAllLedger" | "selectAllTaskClaim"> = {
  policy: "selectAllPolicy",
  ledger: "selectAllLedger",
  task: "selectAllTaskClaim",
};

function IndeterminateCheckbox({
  checked,
  indeterminate,
  onChange,
  className,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={className}
      checked={checked}
      onChange={onChange}
    />
  );
}

export function UserFormModal({
  user,
  onClose,
  onSuccess,
}: {
  user: UserRow | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const { t } = useLocale();
  const isEdit = !!user;

  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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

  const roleIsAdmin = isAdminRole(role);

  const togglePermission = (key: PermissionKey) => {
    setPermissions((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  };

  const toggleGroup = (children: readonly PermissionKey[], nextChecked: boolean) => {
    setPermissions((prev) => {
      const withoutGroup = prev.filter((p) => !children.includes(p as PermissionKey));
      return nextChecked ? [...withoutGroup, ...children] : withoutGroup;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedFullName = fullName.trim();
    const trimmedRole = role.trim();

    if (!trimmedFullName || !trimmedRole || (!isEdit && !password)) {
      setError(t.users.requiredField);
      return;
    }

    if (!isEdit) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(t.users.passwordTooShort);
        return;
      }
      if (password !== confirmPassword) {
        setError(t.users.passwordMismatch);
        return;
      }
    }

    if (phoneNumber.trim() && !KENYAN_PHONE_REGEX.test(phoneNumber.trim())) {
      setError(t.users.invalidPhone);
      return;
    }

    setIsSubmitting(true);

    const result = isEdit
      ? await updateUserAction(user.id, {
          fullName: trimmedFullName,
          role: trimmedRole,
          phoneNumber: phoneNumber.trim() || null,
          permissions,
          preferredLanguage,
        })
      : await createUserAction({
          fullName: trimmedFullName,
          password,
          role: trimmedRole,
          phoneNumber: phoneNumber.trim() || null,
          permissions,
          preferredLanguage,
        });

    setIsSubmitting(false);

    if (!result.success) {
      const errorMessage =
        result.error === "FULLNAME_TAKEN"
          ? t.users.fullNameTaken
          : result.error === "INVALID_PHONE"
          ? t.users.invalidPhone
          : result.error === "ROLE_REQUIRED" || result.error === "FULLNAME_REQUIRED"
          ? t.users.requiredField
          : result.error === "PASSWORD_TOO_SHORT"
          ? t.users.passwordTooShort
          : result.error === "LAST_ADMIN_ROLE_CHANGE_BLOCKED"
          ? t.users.lastAdminRoleChangeBlocked
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
        <FormField label={t.users.fullName}>
          <Input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </FormField>

        {!isEdit && (
          <>
            <FormField label={t.users.password}>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </FormField>
            <FormField label={t.users.confirmPassword}>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </FormField>
          </>
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
          {roleIsAdmin ? (
            <p className="rounded-control border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {t.users.adminFullAccessNotice}
            </p>
          ) : (
            <div className="flex flex-col gap-3 rounded-control border border-zinc-200 p-3">
              {PERMISSION_GROUPS.map((group) => {
                if (group.standalone) {
                  const key = group.children[0];
                  return (
                    <label
                      key={key}
                      className="flex items-center gap-2 text-sm text-zinc-700"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
                        checked={permissions.includes(key)}
                        onChange={() => togglePermission(key)}
                      />
                      {t.sidebar[group.menuKey]}
                    </label>
                  );
                }

                const allChecked = group.children.every((c) =>
                  permissions.includes(c)
                );
                const someChecked = group.children.some((c) =>
                  permissions.includes(c)
                );

                return (
                  <div key={group.menuKey} className="flex flex-col gap-1.5">
                    <p className="text-sm font-medium text-zinc-800">
                      {t.sidebar[group.menuKey]}
                    </p>
                    <label className="flex items-center gap-2 text-sm text-zinc-700">
                      <IndeterminateCheckbox
                        className="h-4 w-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
                        checked={allChecked}
                        indeterminate={!allChecked && someChecked}
                        onChange={() => toggleGroup(group.children, !allChecked)}
                      />
                      {t.users[SELECT_ALL_LABEL_KEY[group.menuKey]]}
                    </label>
                    <div className="flex flex-col gap-1.5 pl-6">
                      {group.children.map((child) => (
                        <label
                          key={child}
                          className="flex items-center gap-2 text-sm text-zinc-700"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
                            checked={permissions.includes(child)}
                            onChange={() => togglePermission(child)}
                          />
                          {t.users.permissionChildLabels[
                            child as keyof typeof t.users.permissionChildLabels
                          ]}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
