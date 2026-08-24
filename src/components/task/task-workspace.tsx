"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SearchBar } from "@/components/ui/search-bar";
import { Badge } from "@/components/ui/badge";
import { UnreadDot } from "@/components/ui/unread-dot";
import { NewTaskModal } from "@/components/task/new-task-modal";
import { TaskDetailPanel } from "@/components/task/task-detail-panel";
import { useUrlListState } from "@/lib/navigation/useUrlListState";
import { getTaskListScroll, saveTaskListScroll, clearTaskListScroll } from "@/components/task/taskListScroll";
import { subscribeToTaskActivity } from "@/lib/task/liveNotificationsClient";
import { refreshTaskUnreadStatusAction } from "@/app/(app)/task/actions";
import type { TaskCategorySlug, TaskListItem, TaskDetail, ActiveUserOption, TaskStatusValue } from "@/components/task/types";

// Phase 7 Part B audit — only Daily Task renders this component (Motor
// Claim/Non-Motor Claim use MotorClaimTable/NonMotorClaimTable instead, a
// full-width table + modal editor + separate single-record detail page with
// no persistent sibling list at all — see src/app/(app)/task/[categorySlug]/
// page.tsx; there is no shared List/Detail split-pane structure to unify a
// fix across, so this fix is scoped to TaskWorkspace only).
//
// Root cause of the reported "left list scrolls back to top after selecting
// a Task" bug: clicking a Task list row is a plain <Link> to
// /task/{categorySlug}/{taskId} — a real route navigation to the SAME
// [taskId]/page.tsx template (just a different taskId param), re-executing
// that Server Component and re-rendering TaskWorkspace with fresh
// tasks/selectedTask props. Two contributing effects, independent of
// whether TaskWorkspace itself remounts:
//  1. Next.js's <Link> scrolls to the top of the page by default on
//     navigation — the sibling useUrlListState hook already opts OUT of
//     this for search/status changes via router.replace(url, { scroll:
//     false }); the task-selection <Link> below had no such opt-out, so
//     ordinary task-to-task navigation was still subject to Next's default
//     scroll-reset behavior. Fixed by scroll={false} below.
//  2. Even with scroll={false}, a remount cannot be ruled out for every
//     Next.js version/navigation path — so scroll position is ALSO
//     captured continuously (onScroll) into a module-level store
//     (taskListScroll.ts, deliberately outside React state so it survives
//     a real remount) and explicitly restored via useLayoutEffect (runs
//     before paint, so there is no visible jump) whenever the selected Task
//     changes. This is Plan B from this phase's spec, layered on top of
//     Plan A's scroll={false} fix rather than replacing it.
// A separate effect resets (never restores) scroll when the list's own
// content changes because of search/status filtering — restoring a scroll
// offset computed against a different set of rows would land on an
// unrelated row (Part B, Case 3).

const STATUS_TONE: Record<TaskStatusValue, "brand" | "success"> = {
  ACTIVE: "brand",
  COMPLETED: "success",
};

// Daily Task's entire filter surface is just these two — no date filter, no
// pagination (it's a scrollable list, not a paginated table), no
// customer/participant control. Do not add fields here to "match" the Claim
// tables' shape; those controls don't exist in this UI (Phase 8.1 Part 4).
const TASK_LIST_DEFAULTS = { search: "", status: "ALL" };

export function TaskWorkspace({
  categorySlug,
  tasks,
  selectedTask,
  currentUserId,
  canEdit,
  taskCanEdit,
  taskCanDelete,
  isAdmin,
  activeUsers,
}: {
  categorySlug: TaskCategorySlug;
  tasks: TaskListItem[];
  selectedTask: TaskDetail | null;
  currentUserId: string;
  // Module-level task.daily_task EDIT permission — gates the "New Task"
  // button only, independent of any specific Task. Not the same thing as
  // taskCanEdit below (see TaskDetailPanel's props for why these two must
  // stay separate).
  canEdit: boolean;
  // Collaborator capability (Admin/Creator/Participant) for `selectedTask`
  // specifically — meaningless when selectedTask is null, since
  // TaskDetailPanel isn't rendered in that case.
  taskCanEdit: boolean;
  taskCanDelete: boolean;
  isAdmin: boolean;
  activeUsers: ActiveUserOption[];
}) {
  const { t, locale } = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  const [listState, setListState] = useUrlListState(TASK_LIST_DEFAULTS);
  const { search, status: statusFilter } = listState;
  const [showNewTask, setShowNewTask] = useState(false);

  // Phase 8 — local copy of the server-rendered `tasks` prop so a real-time
  // unread refresh can patch just the isUnread field of specific rows
  // without waiting for (or forcing) a full navigation/reload. Re-synced
  // from a genuinely new `tasks` array by adjusting state during render
  // (React's own recommended pattern for this — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  // — rather than a setState-in-effect, which the project's lint config
  // treats as an error).
  const [taskItems, setTaskItems] = useState(tasks);
  const [prevTasks, setPrevTasks] = useState(tasks);
  if (tasks !== prevTasks) {
    setPrevTasks(tasks);
    setTaskItems(tasks);
  }

  useEffect(() => {
    const unsubscribe = subscribeToTaskActivity((signal) => {
      if (signal.kind === "activity" && signal.scope !== "TASK") return;
      const ids = taskItems.map((t) => t.id);
      if (ids.length === 0) return;
      refreshTaskUnreadStatusAction(ids)
        .then((statusMap) => {
          setTaskItems((prev) => prev.map((t) => (t.id in statusMap ? { ...t, isUnread: statusMap[t.id] } : t)));
        })
        .catch(() => {
          // Best-effort — a failed refresh just leaves rows at their last
          // known isUnread; the next real navigation re-derives from the
          // server regardless.
        });
    });
    return unsubscribe;
    // Re-subscribes whenever taskItems changes (cheap — an EventTarget
    // listener add/remove, not a network reconnect) so the closure above
    // never reads a stale row list.
  }, [taskItems]);
  // Selecting a task navigates to its own route (/task/{slug}/{id}) — carry
  // the current search/status query string along so the left panel's
  // filters aren't reset just from picking a task to view (Phase 8.1 Part
  // 7, requirement 6).
  const searchParams = useSearchParams();
  const listQueryString = searchParams.toString();

  // Phase 7 Part B — see this file's top-of-module doc comment for the full
  // audit/design rationale.
  const listScrollRef = useRef<HTMLDivElement>(null);
  const skipNextFilterReset = useRef(true);

  // Restore on mount AND whenever the selected Task changes — a no-op if
  // the browser never actually lost the scroll position (restoring to the
  // value it's already at), and the fix if it did.
  useLayoutEffect(() => {
    const el = listScrollRef.current;
    if (!el) return;
    const saved = getTaskListScroll(categorySlug);
    if (saved !== undefined) el.scrollTop = saved;
  }, [categorySlug, selectedTask?.id]);

  // Reset (never restore) when search/status actually change the list's own
  // content — skips the very first run so it never fights the mount-time
  // restore effect above (Part B, Case 3).
  useLayoutEffect(() => {
    if (skipNextFilterReset.current) {
      skipNextFilterReset.current = false;
      return;
    }
    const el = listScrollRef.current;
    if (el) el.scrollTop = 0;
    clearTaskListScroll(categorySlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  const categoryLabel: Record<TaskCategorySlug, string> = {
    daily: t.task.tabDaily,
    "motor-claim": t.task.tabMotorClaim,
    "non-motor-claim": t.task.tabNonMotorClaim,
  };

  const statusLabel: Record<TaskStatusValue, string> = {
    ACTIVE: t.task.active,
    COMPLETED: t.task.completed,
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return taskItems.filter((task) => {
      const matchesStatus = statusFilter === "ALL" || task.status === statusFilter;
      const matchesTerm =
        !term ||
        task.title.toLowerCase().includes(term) ||
        task.participantNames.some((n) => n.toLowerCase().includes(term));
      return matchesStatus && matchesTerm;
    });
  }, [taskItems, search, statusFilter]);

  const hasSelection = !!selectedTask;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 md:flex-row">
      {/* Left panel — task list. Hidden on mobile once a Task is selected
          (see this phase's spec, Part F.19: "Do not force a narrow
          side-by-side layout" on small screens). */}
      <div className={`min-h-0 flex-col gap-3 md:flex md:w-[38%] md:shrink-0 ${hasSelection ? "hidden" : "flex"}`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title">{categoryLabel[categorySlug]}</h2>
          {canEdit && (
            <Button onClick={() => setShowNewTask(true)}>
              <Plus size={16} />
              {t.task.newTask}
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchBar value={search} onChange={(value) => setListState({ search: value })} placeholder={t.task.searchPlaceholder} className="w-full" />
          <Select value={statusFilter} onChange={(e) => setListState({ status: e.target.value }, { immediate: true })} className="w-auto sm:max-w-[160px]">
            <option value="ALL">{t.task.allStatuses}</option>
            <option value="ACTIVE">{t.task.active}</option>
            <option value="COMPLETED">{t.task.completed}</option>
          </Select>
        </div>

        <div
          ref={listScrollRef}
          onScroll={(e) => saveTaskListScroll(categorySlug, e.currentTarget.scrollTop)}
          className="min-h-0 flex-1 overflow-y-auto rounded-surface border border-zinc-200 bg-white shadow-sm"
        >
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-secondary">{t.task.noTasksFound}</div>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-100">
              {filtered.map((task) => {
                const isSelected = task.id === selectedTask?.id;
                return (
                  <li key={task.id}>
                    <Link
                      href={`/task/${categorySlug}/${task.id}${listQueryString ? `?${listQueryString}` : ""}`}
                      // Part B fix #1 — Next's default scroll-to-top-of-page
                      // behavior on <Link> navigation must not apply to a
                      // same-workspace task-to-task selection (mirrors
                      // useUrlListState's own { scroll: false } for
                      // search/status changes, see this file's top-of-module
                      // doc comment).
                      scroll={false}
                      className={`flex flex-col gap-1 px-4 py-3 transition-colors ${
                        isSelected
                          ? "bg-emerald-50 border-l-2 border-emerald-700"
                          : task.status === "COMPLETED"
                            ? "border-l-2 border-transparent bg-zinc-50/60 opacity-70 hover:opacity-100"
                            : "border-l-2 border-transparent hover:bg-zinc-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={`flex min-w-0 items-center gap-1.5 text-sm font-medium break-words ${task.status === "COMPLETED" ? "text-zinc-600" : "text-zinc-800"}`}>
                          <UnreadDot show={task.isUnread} />
                          {task.title}
                        </span>
                        <Badge tone={STATUS_TONE[task.status]} className="shrink-0">
                          {statusLabel[task.status]}
                        </Badge>
                      </div>
                      <span className="text-xs text-zinc-400">
                        {t.task.createdAt}: {dateFormatter.format(new Date(task.createdAt))}
                      </span>
                      <span className="text-xs text-zinc-400">
                        {t.task.createdBy}: {task.createdByName}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Right panel — selected Task detail, or an empty prompt on desktop
          when nothing is selected yet. */}
      <div className={`min-h-0 flex-1 flex-col md:flex ${hasSelection ? "flex" : "hidden"}`}>
        {selectedTask ? (
          <TaskDetailPanel
            categorySlug={categorySlug}
            task={selectedTask}
            currentUserId={currentUserId}
            canEdit={taskCanEdit}
            canDelete={taskCanDelete}
            isAdmin={isAdmin}
            activeUsers={activeUsers}
          />
        ) : (
          <div className="flex h-full min-h-[240px] items-center justify-center rounded-surface border border-dashed border-zinc-300 bg-white text-sm text-secondary">
            {t.task.selectTaskPrompt}
          </div>
        )}
      </div>

      {showNewTask && (
        <NewTaskModal categorySlug={categorySlug} currentUserId={currentUserId} activeUsers={activeUsers} onClose={() => setShowNewTask(false)} />
      )}
    </div>
  );
}
