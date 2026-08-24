import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { TaskDetailPanel } from "@/components/task/task-detail-panel";
import { dispatchTaskActivity } from "@/lib/task/liveNotificationsClient";
import type { TaskDetail } from "@/components/task/types";

// This test exists because the previous round shipped Server Action /
// checkTaskAccess coverage (src/lib/task/__tests__/access.test.ts,
// src/app/(app)/task/__tests__/collaboratorActions.test.ts) that all passed
// while production still hid Manage Participants/Complete for a plain
// Participant — nothing actually rendered TaskDetailPanel and asserted on
// button visibility, so a prop wired to the wrong variable (e.g. isCreator
// instead of the canEdit prop) would never have failed a test. This file
// closes that gap by rendering the real component.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/task/daily/task-1",
}));

vi.mock("@/app/(app)/task/actions", () => ({
  completeTaskAction: vi.fn(),
  reopenTaskAction: vi.fn(),
  deleteTaskAction: vi.fn(),
  deleteStepAction: vi.fn(),
  updateParticipantsAction: vi.fn(),
  addStepAction: vi.fn(),
  updateStepAction: vi.fn(),
  updateTaskTitleAction: vi.fn(),
}));

function renderPanel(props: Partial<Parameters<typeof TaskDetailPanel>[0]>) {
  const task: TaskDetail = {
    id: "task-1",
    title: "Follow up with customer",
    status: "ACTIVE",
    createdById: "creator-1",
    createdByName: "LI YONG",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    completedByName: null,
    participants: [
      { userId: "creator-1", fullName: "LI YONG", role: "Staff", isActiveAccount: true },
      { userId: "participant-1", fullName: "TEST", role: "Staff", isActiveAccount: true },
    ],
    steps: [
      { id: "step-1", content: "Called the customer", createdById: "creator-1", createdByName: "LI YONG", createdAt: new Date().toISOString(), editedAt: null },
    ],
  };

  return render(
    <LocaleProvider initialLocale="en">
      <TaskDetailPanel
        categorySlug="daily"
        task={task}
        currentUserId="participant-1"
        canEdit={true}
        canDelete={false}
        isAdmin={false}
        activeUsers={[]}
        {...props}
      />
    </LocaleProvider>
  );
}

// CASE A (this phase's spec, Part VII): a plain Participant whose module
// permission on task.daily_task is only VIEW is still, per
// checkTaskAccess, a full collaborator on THIS Task — access.canEdit is
// true. The page passes that through as the `canEdit` prop below
// (task-workspace.tsx: canEdit={taskCanEdit}, itself access.canEdit from
// checkTaskAccess) — module-level VIEW/EDIT never reaches this component at
// all, so there is nothing here for a stale moduleCanEdit reference to leak
// in from.
describe("TaskDetailPanel — Participant collaborator (CASE A)", () => {
  it("shows Manage Participants, Complete, and Add Next Step for a non-creator, non-admin Participant with canEdit=true", () => {
    renderPanel({ canEdit: true, canDelete: false, isAdmin: false });

    expect(screen.getByText("Manage Participants")).toBeInTheDocument();
    expect(screen.getByText("Mark as Completed")).toBeInTheDocument();
    expect(screen.getByText("Add Next Step")).toBeInTheDocument();
  });

  it("hides Edit Task (Creator/Admin-only) and Delete Task (canDelete-only) for a plain Participant", () => {
    renderPanel({ canEdit: true, canDelete: false, isAdmin: false });

    expect(screen.queryByText("Edit Task")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete Task")).not.toBeInTheDocument();
  });

  it("shows Reopen (not Complete) once the Task is COMPLETED, still gated on canEdit alone", () => {
    renderPanel({
      canEdit: true,
      canDelete: false,
      isAdmin: false,
      task: {
        id: "task-1",
        title: "Follow up with customer",
        status: "COMPLETED",
        createdById: "creator-1",
        createdByName: "LI YONG",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        completedByName: "TEST",
        participants: [
          { userId: "creator-1", fullName: "LI YONG", role: "Staff", isActiveAccount: true },
          { userId: "participant-1", fullName: "TEST", role: "Staff", isActiveAccount: true },
        ],
        steps: [
          { id: "step-1", content: "Called the customer", createdById: "creator-1", createdByName: "LI YONG", createdAt: new Date().toISOString(), editedAt: null },
        ],
      },
    });

    expect(screen.getByText("Reopen Task")).toBeInTheDocument();
    expect(screen.queryByText("Mark as Completed")).not.toBeInTheDocument();
  });
});

// A view-only render (canEdit=false, as checkTaskAccess would only ever
// produce for a Task the current user isn't a participant of — practically
// unreachable via the real page since that case 404s before this component
// ever renders, but this pins the prop's own contract in isolation).
describe("TaskDetailPanel — non-collaborator (canEdit=false)", () => {
  it("hides every execution action, including Add Next Step", () => {
    renderPanel({ canEdit: false, canDelete: false, isAdmin: false });

    expect(screen.queryByText("Manage Participants")).not.toBeInTheDocument();
    expect(screen.queryByText("Mark as Completed")).not.toBeInTheDocument();
    expect(screen.queryByText("Add Next Step")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete Task")).not.toBeInTheDocument();
  });
});

describe("TaskDetailPanel — Creator", () => {
  it("shows Edit Task in addition to the collaborator actions", () => {
    renderPanel({ canEdit: true, canDelete: true, isAdmin: false, currentUserId: "creator-1" });

    expect(screen.getByText("Edit Task")).toBeInTheDocument();
    expect(screen.getByText("Manage Participants")).toBeInTheDocument();
    expect(screen.getByText("Mark as Completed")).toBeInTheDocument();
    expect(screen.getByText("Delete Task")).toBeInTheDocument();
  });
});

// Real-time unread notification (this session) — T18/T19.
describe("TaskDetailPanel — real-time external-update notice", () => {
  it("T18: shows the notice when another participant's activity signal names this exact Task", async () => {
    renderPanel({ currentUserId: "participant-1" });
    expect(screen.queryByText("This task has been updated by another participant.")).not.toBeInTheDocument();

    dispatchTaskActivity({ scope: "TASK", entityId: "task-1", actorUserId: "creator-1", timestamp: "2026-01-01T00:00:00.000Z" });

    // The listener updates state from outside any React event handler, so
    // React doesn't necessarily flush it synchronously — wait for it.
    await waitFor(() => expect(screen.getByText("This task has been updated by another participant.")).toBeInTheDocument());
  });

  it("never shows the notice for the current user's OWN activity signal", async () => {
    renderPanel({ currentUserId: "participant-1" });

    dispatchTaskActivity({ scope: "TASK", entityId: "task-1", actorUserId: "participant-1", timestamp: "2026-01-01T00:00:00.000Z" });

    await Promise.resolve();
    expect(screen.queryByText("This task has been updated by another participant.")).not.toBeInTheDocument();
  });

  it("never shows the notice for a signal about a DIFFERENT Task", async () => {
    renderPanel({ currentUserId: "participant-1" });

    dispatchTaskActivity({ scope: "TASK", entityId: "task-999", actorUserId: "creator-1", timestamp: "2026-01-01T00:00:00.000Z" });

    await Promise.resolve();
    expect(screen.queryByText("This task has been updated by another participant.")).not.toBeInTheDocument();
  });

  it("never shows the notice for a different scope (e.g. MOTOR_CLAIM), even with a matching id", async () => {
    renderPanel({ currentUserId: "participant-1" });

    dispatchTaskActivity({ scope: "MOTOR_CLAIM", entityId: "task-1", actorUserId: "creator-1", timestamp: "2026-01-01T00:00:00.000Z" });

    await Promise.resolve();
    expect(screen.queryByText("This task has been updated by another participant.")).not.toBeInTheDocument();
  });

  it("T19: clicking Refresh dismisses the notice without touching an open modal (e.g. Add Next Step stays open)", async () => {
    renderPanel({ currentUserId: "participant-1", canEdit: true });

    fireEvent.click(screen.getByRole("button", { name: /Add Next Step/ }));
    // StepModal opened: its own "Action Content" field is now present.
    expect(screen.getByText("Action Content")).toBeInTheDocument();

    dispatchTaskActivity({ scope: "TASK", entityId: "task-1", actorUserId: "creator-1", timestamp: "2026-01-01T00:00:00.000Z" });
    await waitFor(() => expect(screen.getByText("This task has been updated by another participant.")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Refresh"));

    await waitFor(() => expect(screen.queryByText("This task has been updated by another participant.")).not.toBeInTheDocument());
    // The modal the user had open is untouched by the notice or its dismissal.
    expect(screen.getByText("Action Content")).toBeInTheDocument();
  });
});
