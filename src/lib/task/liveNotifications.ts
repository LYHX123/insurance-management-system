import { EventEmitter } from "node:events";

// Task / Motor Claim / Non-Motor Claim real-time unread notification
// (Phase 8) — process-in-memory pub/sub, isolated to this one module so no
// action file ever imports EventEmitter or touches broker internals
// directly (see this phase's spec, Part D: "不要把 EventEmitter 散落在
// action 文件里"). The SSE route (src/app/api/task-notifications/stream)
// subscribes; publishTaskActivityAfterMutation below is the only publish
// entry point, called by Server Actions after their own DB transaction
// commits.
//
// SSE is an invalidation signal, not the source of truth. TaskReadState /
// MotorClaimReadState / NonMotorClaimReadState in Postgres remain the only
// authoritative record of what is unread — a dropped, delayed, duplicated,
// or entirely-never-received event here can never produce a wrong unread
// state, because every recipient always re-derives unread by re-querying
// the database (getUnreadTaskIds and its Motor/Non-Motor equivalents) after
// being told "something may have changed." This module never carries the
// actual unread verdict, a Task's content, a Claim's content, or any other
// business field — only { scope, entityId, actorUserId, timestamp }.
//
// Single-instance only: this is a plain Node EventEmitter, scoped to this
// one process's memory. Production today runs exactly one `app` container
// (see DEPLOYMENT.md — Docker Compose, one `app` service). That makes this
// sufficient for now. If that ever changes — multiple Docker replicas,
// multiple Node instances behind a load balancer — this stops working
// across instances: a browser's SSE connection lands on whichever instance
// handled that particular request, and a mutation committed on a different
// instance would never reach it (each instance's EventEmitter is private to
// its own process). At that point this module needs to be replaced with an
// external broker every instance publishes to and subscribes from (e.g.
// Redis Pub/Sub) — not attempted in this phase.

export type TaskActivityScope = "TASK" | "MOTOR_CLAIM" | "NON_MOTOR_CLAIM";

export type TaskActivityEvent = {
  scope: TaskActivityScope;
  entityId: string;
  actorUserId: string;
  timestamp: string;
};

const emitter = new EventEmitter();
// Unbounded — one listener per open SSE connection for a given user, and a
// user may legitimately have several (multiple tabs, multiple devices).
// Node's default cap of 10 would otherwise print MaxListenersExceededWarning
// noise for a perfectly normal usage pattern.
emitter.setMaxListeners(0);

function channel(userId: string): string {
  return `task-activity:${userId}`;
}

// Called once per open SSE connection (see the stream route). Returns an
// unsubscribe function — the route's ReadableStream `cancel()` callback
// must call it on every disconnect/reconnect so a churning connection never
// leaks listeners (this phase's spec, Part C6/C7).
export function subscribeUserTaskNotifications(userId: string, listener: (event: TaskActivityEvent) => void): () => void {
  const ch = channel(userId);
  emitter.on(ch, listener);
  return () => {
    emitter.off(ch, listener);
  };
}

function publishToUsers(userIds: readonly string[], event: TaskActivityEvent): void {
  const seen = new Set<string>();
  for (const userId of userIds) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    emitter.emit(channel(userId), event);
  }
}

// The one entry point every Server Action mutation calls — never publishes
// directly. Filters out the acting user (this phase's spec, Part D3: "操作者
// 本人一般不需要触发自己的unread通知" — their own ReadState is already
// caught up by the same transaction, via touchOwnTaskReadState and its
// Motor/Non-Motor equivalents, so a self-notification would be a wasted
// round trip at best).
//
// MUST be called only after the mutation's own DB transaction has committed
// successfully — never before (this phase's spec, Part E: publishing ahead
// of a transaction that then fails would tell a client about a change that
// never actually happened).
export function publishTaskActivityAfterMutation(params: {
  scope: TaskActivityScope;
  entityId: string;
  actorUserId: string;
  participantUserIds: readonly string[];
}): void {
  const { scope, entityId, actorUserId, participantUserIds } = params;
  const recipients = participantUserIds.filter((id) => id !== actorUserId);
  if (recipients.length === 0) return;
  publishToUsers(recipients, { scope, entityId, actorUserId, timestamp: new Date().toISOString() });
}

// Test-only escape hatch — lets a test assert "does this userId currently
// have an active subscription" without reaching into the module-private
// EventEmitter. Never used by production code.
export function __getSubscriberCountForTests(userId: string): number {
  return emitter.listenerCount(channel(userId));
}
