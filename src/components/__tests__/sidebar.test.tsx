import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "@/i18n/locale-provider";
import { Sidebar } from "@/components/sidebar";
import { dispatchResync, dispatchTaskActivity } from "@/lib/task/liveNotificationsClient";

// Real-time unread notification (this session) — T16: Sidebar Task red-dot
// client update.

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const ADMIN_USER = { role: "Admin", status: "ACTIVE" as const, permissions: [] };

function renderSidebar(hasUnreadTask: boolean) {
  return render(
    <LocaleProvider initialLocale="en">
      <Sidebar user={ADMIN_USER} hasUnreadTask={hasUnreadTask} />
    </LocaleProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Sidebar — real-time Task red dot", () => {
  it("renders the server-provided initial value with no signal yet", () => {
    renderSidebar(true);
    expect(screen.getByLabelText("Unread")).toBeInTheDocument();
  });

  it("T16: a resync signal re-fetches unread-status and updates the dot from false -> true", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ hasUnread: true }) } as Response);
    renderSidebar(false);
    expect(screen.queryByLabelText("Unread")).not.toBeInTheDocument();

    dispatchResync();

    await waitFor(() => expect(screen.getByLabelText("Unread")).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith("/api/task-notifications/unread-status", { cache: "no-store" });
  });

  it("an activity signal (not just resync) also triggers a re-fetch, and can clear the dot", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ hasUnread: false }) } as Response);
    renderSidebar(true);
    expect(screen.getByLabelText("Unread")).toBeInTheDocument();

    dispatchTaskActivity({ scope: "TASK", entityId: "task-1", actorUserId: "user-b", timestamp: "2026-01-01T00:00:00.000Z" });

    await waitFor(() => expect(screen.queryByLabelText("Unread")).not.toBeInTheDocument());
  });

  it("a failed fetch leaves the dot at its last known value instead of throwing", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    renderSidebar(true);

    dispatchResync();

    // Give the rejected promise's .catch a tick; the dot must not change or crash.
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByLabelText("Unread")).toBeInTheDocument();
  });
});
