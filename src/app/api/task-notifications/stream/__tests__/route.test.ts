import { describe, it, expect, vi, beforeEach } from "vitest";

// Real-time unread notification (this session) — SSE endpoint tests.
// checkTaskAccess-style module mocking convention (mock @/lib/auth, hit the
// real route handler and real liveNotifications broker underneath).

let sessionUser: { id: string; role: string; status: string; permissions: string[] } | null = null;
vi.mock("@/lib/auth", () => ({
  auth: async () => (sessionUser ? { user: sessionUser } : null),
}));

beforeEach(() => {
  vi.clearAllMocks();
  sessionUser = null;
});

async function readOneChunk(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(value);
}

describe("GET /api/task-notifications/stream", () => {
  it("T2: an unauthenticated request gets 401 and no stream body", async () => {
    const { GET } = await import("../route");
    const response = await GET();
    expect(response.status).toBe(401);
    expect(response.body).toBeNull();
  });

  it("an authenticated request gets a 200 text/event-stream response with the right headers", async () => {
    sessionUser = { id: "user-a", role: "Staff", status: "ACTIVE", permissions: ["task.daily_task", "claim.motor", "claim.non_motor"] };
    const { GET } = await import("../route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toContain("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");

    const first = await readOneChunk(response);
    expect(first).toContain(": connected");
  });

  it("T4: a published event for a scope this user is subscribed to arrives on the stream, carrying no business content", async () => {
    sessionUser = { id: "user-a", role: "Staff", status: "ACTIVE", permissions: ["task.daily_task"] };
    const { GET } = await import("../route");
    const { publishTaskActivityAfterMutation } = await import("@/lib/task/liveNotifications");

    const response = await GET();
    const reader = response.body!.getReader();
    await reader.read(); // ": connected"

    publishTaskActivityAfterMutation({ scope: "TASK", entityId: "task-1", actorUserId: "user-b", participantUserIds: ["user-a", "user-b"] });

    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: task-unread-changed");
    expect(text).toContain('"scope":"TASK"');
    expect(text).toContain('"entityId":"task-1"');
    expect(text).toContain('"actorUserId":"user-b"');
    // T14 — never anything beyond the four fields (no title, content,
    // participant list, customer/policy data, etc.).
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "))!;
    const payload = JSON.parse(dataLine.slice("data: ".length));
    expect(Object.keys(payload).sort()).toEqual(["actorUserId", "entityId", "scope", "timestamp"]);

    await reader.cancel();
  });

  it("O: an event for a scope this user has no permission for is never forwarded, even though the broker published it (defense in depth)", async () => {
    // No claim.motor permission.
    sessionUser = { id: "user-a", role: "Staff", status: "ACTIVE", permissions: ["task.daily_task"] };
    const { GET } = await import("../route");
    const { publishTaskActivityAfterMutation } = await import("@/lib/task/liveNotifications");

    const response = await GET();
    const reader = response.body!.getReader();
    await reader.read(); // ": connected"

    publishTaskActivityAfterMutation({ scope: "MOTOR_CLAIM", entityId: "claim-1", actorUserId: "user-b", participantUserIds: ["user-a", "user-b"] });
    // Also publish a scope this user DOES have permission for, so the read
    // below has something to resolve — if the MOTOR_CLAIM event had been
    // forwarded, it would have arrived first.
    publishTaskActivityAfterMutation({ scope: "TASK", entityId: "task-1", actorUserId: "user-b", participantUserIds: ["user-a", "user-b"] });

    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('"scope":"TASK"');
    expect(text).not.toContain("MOTOR_CLAIM");

    await reader.cancel();
  });

  it("C7: cancelling the stream (client disconnect) unsubscribes from the broker — no further delivery, and no duplicate on a fresh connection", async () => {
    sessionUser = { id: "user-a", role: "Staff", status: "ACTIVE", permissions: ["task.daily_task"] };
    const { GET } = await import("../route");
    const { publishTaskActivityAfterMutation, __getSubscriberCountForTests } = await import("@/lib/task/liveNotifications");

    const response = await GET();
    const reader = response.body!.getReader();
    await reader.read(); // ": connected"
    expect(__getSubscriberCountForTests("user-a")).toBe(1);

    await reader.cancel(); // simulates the browser disconnecting
    // Cancellation is asynchronous — give the microtask queue a tick.
    await Promise.resolve();
    await Promise.resolve();
    expect(__getSubscriberCountForTests("user-a")).toBe(0);

    // A fresh "reconnect" must not accumulate a second listener on top of a
    // leaked one.
    const response2 = await GET();
    const reader2 = response2.body!.getReader();
    await reader2.read();
    expect(__getSubscriberCountForTests("user-a")).toBe(1);

    const received: string[] = [];
    publishTaskActivityAfterMutation({ scope: "TASK", entityId: "task-1", actorUserId: "user-b", participantUserIds: ["user-a", "user-b"] });
    const { value } = await reader2.read();
    received.push(new TextDecoder().decode(value));
    expect(received).toHaveLength(1); // exactly one delivery, not two

    await reader2.cancel();
  });
});
