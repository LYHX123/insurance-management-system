// Browser-side fan-out for Phase 8's real-time unread notification. Exactly
// ONE EventSource connection is opened per tab (owned by
// src/components/task/task-realtime-notifications.tsx, mounted once in
// (app)/layout.tsx) — every other component that cares (Sidebar,
// TaskWorkspace, the Motor/Non-Motor Claim tables, the currently-open
// detail views) subscribes to this in-page bus instead of opening its own
// connection. A plain `EventTarget` is enough; this is strictly
// same-tab/same-document fan-out, never cross-tab and never the network
// transport itself.
//
// SSE is an invalidation signal, not the source of truth — nothing in this
// module (or the events it carries) is ever treated as the actual unread
// verdict. Every subscriber re-derives its own unread state from the server
// (a Server Action or the unread-status endpoint) after receiving a signal.

export type TaskActivityScope = "TASK" | "MOTOR_CLAIM" | "NON_MOTOR_CLAIM";

export type TaskActivitySignal =
  | { kind: "activity"; scope: TaskActivityScope; entityId: string; actorUserId: string; timestamp: string }
  // No specific entity — "the connection just (re)opened" or "the tab just
  // became visible again after being backgrounded/suspended" (this phase's
  // spec, Part J/K6). Any events missed while disconnected are covered by
  // this: every subscriber treats it as "go re-check your own unread state,
  // just in case."
  | { kind: "resync" };

const SIGNAL_EVENT = "task-activity-signal";

// Guarded for SSR/build (this module can be imported by a "use client"
// component's build graph before `window` exists) — every export below is a
// safe no-op in that environment.
const bus: EventTarget | null = typeof window !== "undefined" ? new EventTarget() : null;

export function dispatchTaskActivity(event: { scope: TaskActivityScope; entityId: string; actorUserId: string; timestamp: string }): void {
  bus?.dispatchEvent(new CustomEvent<TaskActivitySignal>(SIGNAL_EVENT, { detail: { kind: "activity", ...event } }));
}

export function dispatchResync(): void {
  bus?.dispatchEvent(new CustomEvent<TaskActivitySignal>(SIGNAL_EVENT, { detail: { kind: "resync" } }));
}

// Returns an unsubscribe function. Safe to call from a component's
// useEffect on every mount — a no-op during SSR.
export function subscribeToTaskActivity(handler: (signal: TaskActivitySignal) => void): () => void {
  if (!bus) return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<TaskActivitySignal>).detail);
  bus.addEventListener(SIGNAL_EVENT, listener);
  return () => bus.removeEventListener(SIGNAL_EVENT, listener);
}
