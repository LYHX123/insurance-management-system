"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, KeyRound, Trash2, Plus, Ban, CheckCircle2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { UserFormModal } from "@/components/users/user-form-modal";
import { ResetPasswordModal } from "@/components/users/reset-password-modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { TableWrap, Table, TableEmpty } from "@/components/ui/table";
import { deleteUserAction, toggleUserStatusAction } from "@/app/(app)/users/actions";
import { Badge } from "@/components/ui/badge";
import { isAdminRole } from "@/lib/permissions";
import { permissionLabel } from "@/components/users/permissionLabel";
import type { UserRow } from "@/components/users/types";

type ModalState =
  | { type: "create" }
  | { type: "edit"; user: UserRow }
  | { type: "reset-password"; userId: string }
  | { type: "delete"; user: UserRow }
  | null;

const PERMISSIONS_PREVIEW_COUNT = 2;

export function UsersTable({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isTogglingId, setIsTogglingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const activeAdminCount = users.filter(
    (u) => u.status === "ACTIVE" && isAdminRole(u.role)
  ).length;

  const dateFormatter = new Intl.DateTimeFormat(
    locale === "zh" ? "zh-CN" : "en-US",
    { dateStyle: "medium", timeStyle: "short" }
  );

  const handleSuccess = (successMessage: string) => {
    setModal(null);
    setMessage(successMessage);
    router.refresh();
  };

  const handleToggleStatus = async (user: UserRow) => {
    setIsTogglingId(user.id);
    const result = await toggleUserStatusAction(
      user.id,
      user.status === "ACTIVE" ? "DISABLED" : "ACTIVE"
    );
    setIsTogglingId(null);
    if (result.success) {
      setMessage(t.users.statusChangeSuccess);
      router.refresh();
    } else if (result.error === "LAST_ADMIN_DISABLE_BLOCKED") {
      setMessage(t.users.lastAdminDisableBlocked);
    }
  };

  const handleDelete = async () => {
    if (modal?.type !== "delete") return;
    setIsDeleting(true);
    const result = await deleteUserAction(modal.user.id);
    setIsDeleting(false);
    if (result.success) {
      handleSuccess(t.users.deleteSuccess);
    } else if (result.error === "LAST_ADMIN_DELETE_BLOCKED") {
      setModal(null);
      setMessage(t.users.lastAdminDeleteBlocked);
    }
  };

  return (
    <div className="flex flex-col gap-section">
      <PageHeader
        title={t.users.title}
        actions={
          <Button onClick={() => setModal({ type: "create" })}>
            <Plus size={16} />
            {t.users.addUser}
          </Button>
        }
      />

      {message && (
        <div className="flex items-center justify-between rounded-control border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {message}
          <button type="button" onClick={() => setMessage(null)}>
            ×
          </button>
        </div>
      )}

      <TableWrap scroll>
        <Table className="min-w-[1040px]">
          <thead>
            <tr>
              <th>{t.users.fullName}</th>
              <th>{t.users.role}</th>
              <th>{t.users.phoneNumber}</th>
              <th>{t.users.permissions}</th>
              <th>{t.common.status}</th>
              <th>{t.users.createdDate}</th>
              <th>{t.users.lastLogin}</th>
              <th className="text-right">{t.common.actions}</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <TableEmpty colSpan={8}>{t.users.noUsers}</TableEmpty>
            )}
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              const isAdmin = isAdminRole(user.role);
              const isLastActiveAdmin =
                isAdmin && user.status === "ACTIVE" && activeAdminCount <= 1;
              const shownPermissions = user.permissions.slice(
                0,
                PERMISSIONS_PREVIEW_COUNT
              );
              const remainingCount =
                user.permissions.length - shownPermissions.length;
              return (
                <tr key={user.id}>
                  <td className="font-medium text-zinc-800">
                    {user.fullName}
                  </td>
                  <td>{user.role}</td>
                  <td className="text-zinc-500">
                    {user.phoneNumber || "—"}
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1">
                      {isAdmin ? (
                        <Badge tone="brand">{t.users.fullAccess}</Badge>
                      ) : (
                        <>
                          {user.permissions.length === 0 && (
                            <span className="text-zinc-400">—</span>
                          )}
                          {shownPermissions.map((key) => (
                            <Badge key={key} tone="brand">
                              {permissionLabel(t, key)}
                            </Badge>
                          ))}
                          {remainingCount > 0 && (
                            <Badge
                              tone="neutral"
                              title={user.permissions
                                .slice(PERMISSIONS_PREVIEW_COUNT)
                                .map((key) => permissionLabel(t, key))
                                .join(", ")}
                            >
                              +{remainingCount}
                            </Badge>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                  <td>
                    <StatusBadge
                      active={user.status === "ACTIVE"}
                      activeLabel={t.users.active}
                      inactiveLabel={t.users.disabled}
                    />
                  </td>
                  <td className="text-zinc-500">
                    {dateFormatter.format(new Date(user.createdAt))}
                  </td>
                  <td className="text-zinc-500">
                    {user.lastLoginAt
                      ? dateFormatter.format(new Date(user.lastLoginAt))
                      : t.users.never}
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <IconButton
                        title={t.common.edit}
                        onClick={() => setModal({ type: "edit", user })}
                      >
                        <Pencil size={16} />
                      </IconButton>
                      <IconButton
                        title={t.users.resetPassword}
                        onClick={() =>
                          setModal({ type: "reset-password", userId: user.id })
                        }
                      >
                        <KeyRound size={16} />
                      </IconButton>
                      <IconButton
                        title={
                          user.status === "ACTIVE"
                            ? t.users.disable
                            : t.users.enable
                        }
                        disabled={
                          isSelf ||
                          isTogglingId === user.id ||
                          (user.status === "ACTIVE" && isLastActiveAdmin)
                        }
                        onClick={() => handleToggleStatus(user)}
                      >
                        {user.status === "ACTIVE" ? (
                          <Ban size={16} />
                        ) : (
                          <CheckCircle2 size={16} />
                        )}
                      </IconButton>
                      <IconButton
                        tone="danger"
                        title={t.common.delete}
                        disabled={isSelf || isLastActiveAdmin}
                        onClick={() => setModal({ type: "delete", user })}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </TableWrap>

      {(modal?.type === "create" || modal?.type === "edit") && (
        <UserFormModal
          user={modal.type === "edit" ? modal.user : null}
          onClose={() => setModal(null)}
          onSuccess={handleSuccess}
        />
      )}

      {modal?.type === "reset-password" && (
        <ResetPasswordModal
          userId={modal.userId}
          onClose={() => setModal(null)}
          onSuccess={handleSuccess}
        />
      )}

      {modal?.type === "delete" && (
        <ConfirmDialog
          title={t.users.confirmDelete}
          message={t.users.confirmDeleteMessage}
          isSubmitting={isDeleting}
          onConfirm={handleDelete}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
