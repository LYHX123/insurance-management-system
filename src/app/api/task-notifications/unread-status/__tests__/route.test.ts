import { describe, it, expect, vi, beforeEach } from "vitest";

// Real-time unread notification (this session) — T3.

let sessionUser: { id: string; role: string; status: string; permissions: string[] } | null = null;
vi.mock("@/lib/auth", () => ({
  auth: async () => (sessionUser ? { user: sessionUser } : null),
}));

const hasUnreadTaskSidebarActivityMock = vi.fn();
vi.mock("@/lib/task/sidebarUnread", () => ({
  hasUnreadTaskSidebarActivity: (...args: unknown[]) => hasUnreadTaskSidebarActivityMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  sessionUser = null;
});

describe("GET /api/task-notifications/unread-status", () => {
  it("an unauthenticated request gets 401 and hasUnread: false", async () => {
    const { GET } = await import("../route");
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ hasUnread: false });
  });

  it("T3: returns { hasUnread: true } when hasUnreadTaskSidebarActivity says so, using the exact same function the server-render uses", async () => {
    sessionUser = { id: "user-a", role: "Staff", status: "ACTIVE", permissions: ["task.daily_task"] };
    hasUnreadTaskSidebarActivityMock.mockResolvedValue(true);

    const { GET } = await import("../route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hasUnread: true });
    expect(hasUnreadTaskSidebarActivityMock).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({ role: "Staff", status: "ACTIVE", permissions: ["task.daily_task"] })
    );
  });

  it("returns { hasUnread: false } when hasUnreadTaskSidebarActivity says so", async () => {
    sessionUser = { id: "user-a", role: "Staff", status: "ACTIVE", permissions: ["task.daily_task"] };
    hasUnreadTaskSidebarActivityMock.mockResolvedValue(false);

    const { GET } = await import("../route");
    const response = await GET();
    expect(await response.json()).toEqual({ hasUnread: false });
  });
});
