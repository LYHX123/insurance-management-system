"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { updateParticipantsAction } from "@/app/(app)/task/actions";
import type { TaskDetail, TaskParticipantRow, ActiveUserOption } from "@/components/task/types";

const ERROR_KEY: Record<string, string> = {
  FORBIDDEN: "forbidden",
  TASK_NOT_FOUND: "taskNotFound",
  TASK_NOT_ACTIVE: "taskNotActive",
  USER_INACTIVE: "userInactive",
  UPDATE_FAILED: "updateFailed",
};

export function ManageParticipantsModal({
  task,
  activeUsers,
  onClose,
  onChanged,
}: {
  task: TaskDetail;
  activeUsers: ActiveUserOption[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const router = useRouter();

  const [participants, setParticipants] = useState<TaskParticipantRow[]>(task.participants);
  const [addUserId, setAddUserId] = useState("");
  // In-place confirmation step (rather than a second stacked Modal — see
  // this phase's spec, Part H.27: "Use a confirmation modal before ...
  // Remove participant"): selecting a participant to remove swaps this same
  // Modal's body to a confirm view instead of opening another overlay.
  const [pendingRemoval, setPendingRemoval] = useState<TaskParticipantRow | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const participantIds = new Set(participants.map((p) => p.userId));
  const addableUsers = activeUsers.filter((u) => !participantIds.has(u.id));

  const submitParticipantIds = async (ids: string[]) => {
    setIsBusy(true);
    setError(null);
    const result = await updateParticipantsAction(task.id, ids);
    setIsBusy(false);
    if (!result.success) {
      setError(t.task[(ERROR_KEY[result.error] ?? "genericError") as keyof typeof t.task]);
      return false;
    }
    setHasChanges(true);
    return true;
  };

  const handleAdd = async () => {
    const user = activeUsers.find((u) => u.id === addUserId);
    if (!user) return;
    const ok = await submitParticipantIds([...participantIds, user.id]);
    if (ok) {
      setParticipants((prev) => [...prev, { userId: user.id, fullName: user.name, role: user.role, isActiveAccount: true }]);
      setAddUserId("");
    }
  };

  const confirmRemove = async () => {
    if (!pendingRemoval) return;
    const ok = await submitParticipantIds([...participantIds].filter((id) => id !== pendingRemoval.userId));
    if (ok) setParticipants((prev) => prev.filter((p) => p.userId !== pendingRemoval.userId));
    setPendingRemoval(null);
  };

  const handleClose = () => {
    if (hasChanges) {
      router.refresh();
      onChanged();
    }
    onClose();
  };

  if (pendingRemoval) {
    return (
      <Modal title={t.task.confirmRemoveParticipantTitle} onClose={() => setPendingRemoval(null)} width="md">
        <p className="text-body">{t.task.confirmRemoveParticipantMessage}</p>
        <p className="mt-2 text-sm font-medium text-zinc-800">{pendingRemoval.fullName}</p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setPendingRemoval(null)} disabled={isBusy}>
            {t.common.cancel}
          </Button>
          <Button type="button" variant="destructive" onClick={confirmRemove} disabled={isBusy}>
            {t.common.confirm}
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t.task.manageParticipants} onClose={handleClose} width="md">
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col divide-y divide-zinc-100 rounded-control border border-zinc-200">
          {participants.map((p) => {
            const isCreator = p.userId === task.createdById;
            return (
              <li key={p.userId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-zinc-800">
                  {p.fullName}
                  {p.role ? <span className="text-zinc-400"> · {p.role}</span> : null}
                  {!p.isActiveAccount && <span className="ml-1 text-xs text-zinc-400">({t.task.inactiveAccount})</span>}
                </span>
                {isCreator ? (
                  <span className="text-xs text-zinc-400">{t.task.createdBy}</span>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => setPendingRemoval(p)} disabled={isBusy}>
                    {t.common.delete}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>

        {addableUsers.length > 0 && (
          <div className="flex items-center gap-2">
            <Select value={addUserId} onChange={(e) => setAddUserId(e.target.value)} className="flex-1">
              <option value="">{t.task.participants}</option>
              {addableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.role ? ` · ${u.role}` : ""}
                </option>
              ))}
            </Select>
            <Button type="button" variant="secondary" onClick={handleAdd} disabled={!addUserId || isBusy}>
              {t.common.create}
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={handleClose}>
            {t.common.close}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
