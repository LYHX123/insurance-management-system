"use client";

import { useState } from "react";
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
  isEditCapableResource,
  levelForStoredPermissions,
  levelToStoredKeys,
  type PermissionKey,
  type PermissionLevel,
  type ViewEditResourceKey,
} from "@/lib/permissions";
import type { UserRow } from "@/components/users/types";

const languages = ["en", "zh"] as const;
const KENYAN_PHONE_REGEX = /^(?:\+254\d{9}|0\d{9})$/;
const MIN_PASSWORD_LENGTH = 8;

const LEVELS: readonly PermissionLevel[] = ["NONE", "VIEW", "EDIT"];

// One None/View/Edit segmented control for a single resource — Edit is
// visually styled to make clear it already includes View (Part 7/Part 4:
// "Edit视觉上表示已经包含View"), never a separate combination to pick.
function LevelSelector({
  level,
  onChange,
  editCapable,
  levelLabel,
  notEditableHint,
}: {
  level: PermissionLevel;
  onChange: (level: PermissionLevel) => void;
  editCapable: boolean;
  levelLabel: Record<PermissionLevel, string>;
  notEditableHint?: string;
}) {
  const options = editCapable ? LEVELS : (["NONE", "VIEW"] as const);
  return (
    <div className="inline-flex overflow-hidden rounded-control border border-zinc-300" role="radiogroup">
      {options.map((opt) => {
        const active = level === opt;
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt === "EDIT" ? undefined : opt === "VIEW" && !editCapable ? notEditableHint : undefined}
            onClick={() => onChange(opt)}
            className={`px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? opt === "EDIT"
                  ? "bg-emerald-700 text-white"
                  : opt === "VIEW"
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-zinc-200 text-zinc-700"
                : "bg-white text-zinc-500 hover:bg-zinc-50"
            }`}
          >
            {levelLabel[opt]}
          </button>
        );
      })}
    </div>
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

  const toggleBooleanPermission = (key: PermissionKey) => {
    setPermissions((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  };

  // Replaces whatever this resource currently holds (bare legacy key, or
  // .view/.edit) with the keys for the newly selected level — each resource
  // can only ever be at exactly one level at a time (Part 7: "每项只能选择
  // 一个等级"), never an accumulation of checkboxes.
  const setResourceLevel = (resource: ViewEditResourceKey, level: PermissionLevel) => {
    setPermissions((prev) => {
      const withoutResource = prev.filter((p) => p !== resource && p !== `${resource}.view` && p !== `${resource}.edit`);
      return [...withoutResource, ...levelToStoredKeys(resource, level)];
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
            <div className="flex flex-col gap-4 rounded-control border border-zinc-200 p-3">
              {PERMISSION_GROUPS.map((group) => {
                if (group.kind === "boolean") {
                  return (
                    <label
                      key={group.menuKey}
                      className="flex items-center gap-2 text-sm text-zinc-700"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
                        checked={permissions.includes(group.booleanKey)}
                        onChange={() => toggleBooleanPermission(group.booleanKey)}
                      />
                      {t.sidebar[group.menuKey]}
                    </label>
                  );
                }

                // Single-resource module (Customer/Quotation/Invoice): module
                // name and selector on one row, no separate sub-module list.
                if (group.standalone) {
                  const resource = group.children[0];
                  return (
                    <div key={group.menuKey} className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-zinc-800">{t.sidebar[group.menuKey]}</p>
                      <LevelSelector
                        level={levelForStoredPermissions(permissions, resource)}
                        onChange={(level) => setResourceLevel(resource, level)}
                        editCapable={isEditCapableResource(resource)}
                        levelLabel={{
                          NONE: t.users.permissionLevelNone,
                          VIEW: t.users.permissionLevelView,
                          EDIT: t.users.permissionLevelEdit,
                        }}
                        notEditableHint={t.users.permissionLevelViewNotEditable}
                      />
                    </div>
                  );
                }

                // Multi-resource module (Policy/Ledger/Task & Claim): module
                // name as a section header, one row + selector per sub-module.
                return (
                  <div key={group.menuKey} className="flex flex-col gap-2">
                    <p className="text-sm font-medium text-zinc-800">{t.sidebar[group.menuKey]}</p>
                    <div className="flex flex-col gap-2 pl-4">
                      {group.children.map((child) => (
                        <div key={child} className="flex items-center justify-between gap-3">
                          <p className="text-sm text-zinc-700">
                            {t.users.permissionChildLabels[child as keyof typeof t.users.permissionChildLabels]}
                          </p>
                          <LevelSelector
                            level={levelForStoredPermissions(permissions, child)}
                            onChange={(level) => setResourceLevel(child, level)}
                            editCapable={isEditCapableResource(child)}
                            levelLabel={{
                              NONE: t.users.permissionLevelNone,
                              VIEW: t.users.permissionLevelView,
                              EDIT: t.users.permissionLevelEdit,
                            }}
                            notEditableHint={t.users.permissionLevelViewNotEditable}
                          />
                        </div>
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
