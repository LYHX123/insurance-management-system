import { auth } from "@/lib/auth";
import { hasPermission, type PermissionKey } from "@/lib/permissions";
import { subscribeUserTaskNotifications, type TaskActivityEvent, type TaskActivityScope } from "@/lib/task/liveNotifications";

// Phase 8 Task/Motor Claim/Non-Motor Claim real-time unread notification —
// SSE stream. One connection per browser tab (opened by
// src/components/task/task-realtime-notifications.tsx). Never cached, never
// statically optimized — every response is a live, per-user stream.
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

const SCOPE_PERMISSION: Record<TaskActivityScope, PermissionKey> = {
  TASK: "task.daily_task",
  MOTOR_CLAIM: "claim.motor",
  NON_MOTOR_CLAIM: "claim.non_motor",
};

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    // No stream body at all for an unauthenticated request (this phase's
    // spec, Part C2) — the client only ever opens this from inside
    // (app)/layout, which already redirects a signed-out visitor to
    // /login, so in practice this only fires on a since-expired session.
    return new Response(null, { status: 401 });
  }

  const userId = session.user.id;
  const authzUser = { role: session.user.role, status: session.user.status, permissions: session.user.permissions ?? [] };

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller already closed between the last successful write and
          // this one (client disconnected) — `cancel` below handles actual
          // cleanup; a write racing that teardown is just discarded.
        }
      };

      // A leading comment line — gets bytes flowing immediately so an
      // intermediate proxy considers the connection genuinely open, and
      // gives the client an immediate "yes, connected" signal.
      controller.enqueue(encoder.encode(": connected\n\n"));

      const listener = (event: TaskActivityEvent) => {
        // Defense in depth (this phase's spec, Part O) — even though
        // publishTaskActivityAfterMutation only ever targets a Task/Claim's
        // actual current participants, a user's module permission could
        // have been revoked after they were added as a participant. Never
        // forward an event for a scope this connection's user doesn't
        // currently hold VIEW access to, regardless of what the broker
        // published.
        if (!hasPermission(authzUser, SCOPE_PERMISSION[event.scope])) return;
        send("task-unread-changed", event);
      };
      unsubscribe = subscribeUserTaskNotifications(userId, listener);

      // Keeps intermediate proxies (Nginx included) from treating a quiet
      // connection as dead and closing it — see this phase's report for the
      // Nginx `proxy_read_timeout` note. `event: ping` with an empty body,
      // never anything the client needs to act on.
      heartbeat = setInterval(() => send("ping", {}), HEARTBEAT_MS);
    },
    cancel() {
      // Fires on every disconnect — tab closed, navigation away, or the
      // browser's own EventSource reconnect (which closes the old
      // connection before opening a new one). Must clear both the broker
      // subscription and the heartbeat timer every time, or a reconnecting
      // browser leaks one of each per reconnect (this phase's spec, Part
      // C6/C7 — "不允许一个浏览器重连后留下旧 timer / listener").
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Belt-and-suspenders alongside the Nginx-level `proxy_buffering off`
      // documented in this phase's report — this header alone is enough to
      // stop Nginx buffering the response even without a config change, but
      // both are recommended for production (see the report's Nginx
      // section).
      "X-Accel-Buffering": "no",
    },
  });
}
