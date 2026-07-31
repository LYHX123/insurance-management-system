"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SearchBar } from "@/components/ui/search-bar";
import { Badge } from "@/components/ui/badge";
import { NewTaskModal } from "@/components/task/new-task-modal";
import { TaskDetailPanel } from "@/components/task/task-detail-panel";
import { useUrlListState } from "@/lib/navigation/useUrlListState";
import type { TaskCategorySlug, TaskListItem, TaskDetail, ActiveUserOption, TaskStatusValue } from "@/components/task/types";

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
  activeUsers,
}: {
  categorySlug: TaskCategorySlug;
  tasks: TaskListItem[];
  selectedTask: TaskDetail | null;
  currentUserId: string;
  activeUsers: ActiveUserOption[];
}) {
  const { t, locale } = useLocale();
  const dateFormatter = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" });

  const [listState, setListState] = useUrlListState(TASK_LIST_DEFAULTS);
  const { search, status: statusFilter } = listState;
  const [showNewTask, setShowNewTask] = useState(false);
  // Selecting a task navigates to its own route (/task/{slug}/{id}) — carry
  // the current search/status query string along so the left panel's
  // filters aren't reset just from picking a task to view (Phase 8.1 Part
  // 7, requirement 6).
  const searchParams = useSearchParams();
  const listQueryString = searchParams.toString();

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
    return tasks.filter((task) => {
      const matchesStatus = statusFilter === "ALL" || task.status === statusFilter;
      const matchesTerm =
        !term ||
        task.title.toLowerCase().includes(term) ||
        task.participantNames.some((n) => n.toLowerCase().includes(term));
      return matchesStatus && matchesTerm;
    });
  }, [tasks, search, statusFilter]);

  const hasSelection = !!selectedTask;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 md:flex-row">
      {/* Left panel — task list. Hidden on mobile once a Task is selected
          (see this phase's spec, Part F.19: "Do not force a narrow
          side-by-side layout" on small screens). */}
      <div className={`min-h-0 flex-col gap-3 md:flex md:w-[38%] md:shrink-0 ${hasSelection ? "hidden" : "flex"}`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-title">{categoryLabel[categorySlug]}</h2>
          <Button onClick={() => setShowNewTask(true)}>
            <Plus size={16} />
            {t.task.newTask}
          </Button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchBar value={search} onChange={(value) => setListState({ search: value })} placeholder={t.task.searchPlaceholder} className="w-full" />
          <Select value={statusFilter} onChange={(e) => setListState({ status: e.target.value }, { immediate: true })} className="w-auto sm:max-w-[160px]">
            <option value="ALL">{t.task.allStatuses}</option>
            <option value="ACTIVE">{t.task.active}</option>
            <option value="COMPLETED">{t.task.completed}</option>
          </Select>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-surface border border-zinc-200 bg-white shadow-sm">
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
                      className={`flex flex-col gap-1 px-4 py-3 transition-colors ${
                        isSelected
                          ? "bg-emerald-50 border-l-2 border-emerald-700"
                          : task.status === "COMPLETED"
                            ? "border-l-2 border-transparent bg-zinc-50/60 opacity-70 hover:opacity-100"
                            : "border-l-2 border-transparent hover:bg-zinc-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={`text-sm font-medium break-words ${task.status === "COMPLETED" ? "text-zinc-600" : "text-zinc-800"}`}>
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
          <TaskDetailPanel categorySlug={categorySlug} task={selectedTask} currentUserId={currentUserId} activeUsers={activeUsers} />
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
