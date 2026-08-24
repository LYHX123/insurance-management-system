import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { TaskWorkspace } from "@/components/task/task-workspace";
import { dispatchTaskActivity, dispatchResync } from "@/lib/task/liveNotificationsClient";
import type { TaskListItem, TaskDetail } from "@/components/task/types";

// Real-time unread notification (this session) — T17: Task list row red-dot
// real-time update, driven by a targeted refreshTaskUnreadStatusAction call
// rather than a full navigation/reload (see task-workspace.tsx).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/task/daily",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/task/new-task-modal", () => ({ NewTaskModal: () => null }));
vi.mock("@/components/task/task-detail-panel", () => ({ TaskDetailPanel: () => <div data-testid="detail-panel" /> }));

const refreshTaskUnreadStatusActionMock = vi.fn();
vi.mock("@/app/(app)/task/actions", () => ({
  refreshTaskUnreadStatusAction: (...args: unknown[]) => refreshTaskUnreadStatusActionMock(...args),
}));

function makeTasks(): TaskListItem[] {
  return [
    { id: "task-1", title: "Task One", status: "ACTIVE", createdByName: "Tester", createdAt: new Date(2026, 0, 1).toISOString(), participantNames: [], isUnread: false },
    { id: "task-2", title: "Task Two", status: "ACTIVE", createdByName: "Tester", createdAt: new Date(2026, 0, 2).toISOString(), participantNames: [], isUnread: false },
  ];
}

function renderWorkspace(tasks: TaskListItem[], selectedTask: TaskDetail | null = null) {
  return render(
    <LocaleProvider initialLocale="en">
      <TaskWorkspace
        categorySlug="daily"
        tasks={tasks}
        selectedTask={selectedTask}
        currentUserId="u1"
        canEdit={true}
        taskCanEdit={true}
        taskCanDelete={false}
        isAdmin={false}
        activeUsers={[]}
      />
    </LocaleProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TaskWorkspace — real-time row-level unread refresh", () => {
  it("T17: a TASK-scope activity signal fetches fresh unread status for the visible rows and patches isUnread in place, without a full re-fetch of Task content", async () => {
    refreshTaskUnreadStatusActionMock.mockResolvedValue({ "task-1": true, "task-2": false });
    renderWorkspace(makeTasks());

    expect(screen.queryByLabelText("Unread")).not.toBeInTheDocument();

    dispatchTaskActivity({ scope: "TASK", entityId: "task-1", actorUserId: "user-b", timestamp: "2026-01-01T00:00:00.000Z" });

    await waitFor(() => expect(screen.getAllByLabelText("Unread")).toHaveLength(1));
    expect(refreshTaskUnreadStatusActionMock).toHaveBeenCalledWith(["task-1", "task-2"]);
  });

  it("a resync signal also triggers the same targeted refresh", async () => {
    refreshTaskUnreadStatusActionMock.mockResolvedValue({ "task-1": true, "task-2": true });
    renderWorkspace(makeTasks());

    dispatchResync();

    await waitFor(() => expect(screen.getAllByLabelText("Unread")).toHaveLength(2));
  });

  it("an activity signal for a different scope (MOTOR_CLAIM) never triggers a Daily Task refresh", async () => {
    renderWorkspace(makeTasks());

    dispatchTaskActivity({ scope: "MOTOR_CLAIM", entityId: "claim-1", actorUserId: "user-b", timestamp: "2026-01-01T00:00:00.000Z" });

    // Give any (incorrect) async call a chance to fire before asserting it didn't.
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshTaskUnreadStatusActionMock).not.toHaveBeenCalled();
  });

  it("a failed refresh leaves existing rows' isUnread unchanged instead of throwing", async () => {
    refreshTaskUnreadStatusActionMock.mockRejectedValue(new Error("network down"));
    renderWorkspace(makeTasks());

    dispatchResync();

    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByLabelText("Unread")).not.toBeInTheDocument();
  });
});
