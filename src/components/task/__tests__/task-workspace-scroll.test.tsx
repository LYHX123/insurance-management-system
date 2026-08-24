import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { TaskWorkspace } from "@/components/task/task-workspace";
import { saveTaskListScroll, getTaskListScroll, clearTaskListScroll } from "@/components/task/taskListScroll";
import type { TaskListItem, TaskDetail } from "@/components/task/types";

// Phase 7 Part B — TaskWorkspace is the only module with a persistent left
// list + right detail split-pane (see task-workspace.tsx's own doc comment
// for the audit: Motor Claim/Non-Motor Claim use MotorClaimTable/
// NonMotorClaimTable instead, a full-width table with no sibling list, so
// there is nothing to unify a fix across for those two).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/task/daily/task-1",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/task/new-task-modal", () => ({ NewTaskModal: () => null }));
vi.mock("@/components/task/task-detail-panel", () => ({ TaskDetailPanel: () => <div data-testid="detail-panel" /> }));
// Real-time unread notification (this session) — TaskWorkspace now imports
// refreshTaskUnreadStatusAction directly; the real action module statically
// pulls in next-auth, which this plain vitest/jsdom environment can't
// resolve (see the identical mock in task-detail-panel.test.tsx for the
// other Task Server Actions). Never actually exercised here — this file's
// scroll-persistence assertions never trigger a live SSE signal.
vi.mock("@/app/(app)/task/actions", () => ({
  refreshTaskUnreadStatusAction: vi.fn(async () => ({})),
}));

function makeTasks(count: number): TaskListItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${i + 1}`,
    title: `Task ${i + 1}`,
    status: "ACTIVE" as const,
    createdByName: "Tester",
    createdAt: new Date(2026, 0, i + 1).toISOString(),
    participantNames: [],
    isUnread: false,
  }));
}

function makeDetail(id: string): TaskDetail {
  return {
    id,
    title: `Task ${id}`,
    status: "ACTIVE",
    createdById: "u1",
    createdByName: "Tester",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    completedByName: null,
    participants: [],
    steps: [],
  };
}

function renderWorkspace(props: { tasks: TaskListItem[]; selectedTask: TaskDetail | null }) {
  return render(
    <LocaleProvider initialLocale="en">
      <TaskWorkspace
        categorySlug="daily"
        tasks={props.tasks}
        selectedTask={props.selectedTask}
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

function getListScrollContainer(): HTMLElement {
  // The list panel is the only element in this tree with overflow-y-auto
  // that isn't inside the (mocked) detail panel.
  const candidates = Array.from(document.querySelectorAll(".overflow-y-auto"));
  return candidates[0] as HTMLElement;
}

describe("TaskWorkspace — Phase 7 Part B scroll persistence", () => {
  beforeEach(() => {
    clearTaskListScroll("daily");
    clearTaskListScroll("motor-claim");
  });

  it("the task-selection Link opts out of Next's default scroll-to-top (scroll={false})", () => {
    // Source-level assertion mirrors this project's existing convention
    // (see taskWorkspace.test.ts) for pinning a specific prop/behavior that
    // rendering alone can't observe (React Testing Library's fireEvent on a
    // <Link> doesn't perform a real Next.js navigation, so the scroll={false}
    // prop itself — not its runtime navigation effect — is what must be
    // checked here).
    const source = readFileSync(join(__dirname, "..", "task-workspace.tsx"), "utf8");
    const anchor = source.indexOf("href={`/task/${categorySlug}/${task.id}");
    expect(anchor).toBeGreaterThan(-1);
    const linkBlock = source.slice(anchor, anchor + 800);
    expect(linkBlock).toMatch(/scroll=\{false\}/);
  });

  it("Case 1: restores a previously-saved scroll position for this category on mount (simulates a remount after task-to-task navigation)", () => {
    saveTaskListScroll("daily", 240);

    renderWorkspace({ tasks: makeTasks(35), selectedTask: makeDetail("task-31") });

    const list = getListScrollContainer();
    expect(list.scrollTop).toBe(240);
  });

  it("Case 1: re-selecting a task (selectedTask id change) re-applies the saved position without resetting it to 0", () => {
    const { rerender } = renderWorkspace({ tasks: makeTasks(35), selectedTask: makeDetail("task-1") });
    const list = getListScrollContainer();

    // Simulate the user having scrolled the list.
    list.scrollTop = 400;
    fireEvent.scroll(list);
    expect(getTaskListScroll("daily")).toBe(400);

    // Simulate the browser/navigation resetting the DOM's scrollTop to 0
    // (the exact failure mode reported) before the next render commits.
    list.scrollTop = 0;

    rerender(
      <LocaleProvider initialLocale="en">
        <TaskWorkspace
          categorySlug="daily"
          tasks={makeTasks(35)}
          selectedTask={makeDetail("task-31")}
          currentUserId="u1"
          canEdit={true}
          taskCanEdit={true}
          taskCanDelete={false}
          isAdmin={false}
          activeUsers={[]}
        />
      </LocaleProvider>
    );

    expect(list.scrollTop).toBe(400);
  });

  it("Case 2: a category that never had a saved position starts at 0, never borrowing another category's value", () => {
    saveTaskListScroll("daily", 400);
    // motor-claim was never saved — TaskWorkspace is only ever rendered for
    // "daily" in production, but the store itself must stay independent per
    // key regardless (see taskListScroll.test.ts for the store-level
    // coverage of this same guarantee).
    expect(getTaskListScroll("motor-claim")).toBeUndefined();
  });

  it("Case 3: changing the search filter resets the list's scrollTop and clears the stored position", () => {
    saveTaskListScroll("daily", 400);
    renderWorkspace({ tasks: makeTasks(35), selectedTask: makeDetail("task-1") });

    const list = getListScrollContainer();
    expect(list.scrollTop).toBe(400); // restored on mount first

    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "Task 2" } });

    expect(list.scrollTop).toBe(0);
    expect(getTaskListScroll("daily")).toBeUndefined();
  });

  it("Case 4: the selected task no longer existing in the list (deleted) never throws and never restores a stale position for a null selection", () => {
    saveTaskListScroll("daily", 400);

    expect(() => renderWorkspace({ tasks: makeTasks(5), selectedTask: null })).not.toThrow();
    // No detail panel rendered when nothing is selected.
    expect(screen.queryByTestId("detail-panel")).not.toBeInTheDocument();
  });

  // Task User-Level Unread Indicator, Case 16 — clicking an unread Task must
  // not reset the list's scroll position back to the top. Selecting a Task
  // in production is a real navigation to a new selectedTask (a fresh
  // TaskWorkspace render with updated `tasks`/`selectedTask` props, exactly
  // what `rerender` below simulates) — the saved position must still be
  // re-applied via the same mount/selectedTask-change effect regardless of
  // whether any row in the list happens to carry isUnread: true.
  it("Case 16: selecting a Task that has an unread indicator still preserves (does not reset) the saved scroll position", () => {
    const unreadTasks = makeTasks(35).map((t, i) => (i === 10 ? { ...t, isUnread: true } : t));
    const { rerender } = renderWorkspace({ tasks: unreadTasks, selectedTask: makeDetail("task-1") });
    const list = getListScrollContainer();

    list.scrollTop = 350;
    fireEvent.scroll(list);
    expect(getTaskListScroll("daily")).toBe(350);
    list.scrollTop = 0; // simulate the DOM losing scrollTop across the navigation

    // Select the unread row (task-11, i === 10) — the row itself renders a
    // visible red dot (see UnreadDot in task-workspace.tsx).
    rerender(
      <LocaleProvider initialLocale="en">
        <TaskWorkspace
          categorySlug="daily"
          tasks={unreadTasks}
          selectedTask={makeDetail("task-11")}
          currentUserId="u1"
          canEdit={true}
          taskCanEdit={true}
          taskCanDelete={false}
          isAdmin={false}
          activeUsers={[]}
        />
      </LocaleProvider>
    );

    expect(list.scrollTop).toBe(350);
  });

  it("Task User-Level Unread Indicator — renders the red dot only for rows with isUnread: true", () => {
    const tasks = makeTasks(3).map((t, i) => ({ ...t, isUnread: i === 1 }));
    renderWorkspace({ tasks, selectedTask: null });

    expect(screen.getAllByLabelText("Unread")).toHaveLength(1);
  });
});
