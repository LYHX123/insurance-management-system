import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TaskRealtimeNotifications } from "../task-realtime-notifications";
import { subscribeToTaskActivity, type TaskActivitySignal } from "@/lib/task/liveNotificationsClient";

// Real-time unread notification (this session) — T15 (visibilitychange),
// plus EventSource lifecycle (open -> resync, message -> activity signal,
// unmount -> close). jsdom has no native EventSource, so a minimal fake
// stands in — it only needs to support what the component actually uses:
// addEventListener, close(), onopen, onerror.

type Listener = (event: MessageEvent) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener));
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    const message = { data: JSON.stringify(data) } as MessageEvent;
    for (const l of this.listeners.get(type) ?? []) l(message);
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  // @ts-expect-error — test-only global stand-in, jsdom has no real EventSource.
  global.EventSource = FakeEventSource;
});

afterEach(() => {
  cleanup();
  // @ts-expect-error — cleanup the test-only global.
  delete global.EventSource;
});

describe("TaskRealtimeNotifications", () => {
  it("opens exactly one EventSource against the stream endpoint on mount, and closes it on unmount", () => {
    const { unmount } = render(<TaskRealtimeNotifications />);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/task-notifications/stream");
    expect(FakeEventSource.instances[0].closed).toBe(false);

    unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("re-dispatches a task-unread-changed message onto the client bus as an activity signal", () => {
    render(<TaskRealtimeNotifications />);
    const es = FakeEventSource.instances[0];

    const received: TaskActivitySignal[] = [];
    const unsubscribe = subscribeToTaskActivity((s) => received.push(s));

    es.emit("task-unread-changed", { scope: "TASK", entityId: "task-1", actorUserId: "user-b", timestamp: "2026-01-01T00:00:00.000Z" });

    expect(received).toEqual([{ kind: "activity", scope: "TASK", entityId: "task-1", actorUserId: "user-b", timestamp: "2026-01-01T00:00:00.000Z" }]);
    unsubscribe();
  });

  it("a connection opening (including the browser's own reconnect) dispatches a resync signal", () => {
    render(<TaskRealtimeNotifications />);
    const es = FakeEventSource.instances[0];

    const received: TaskActivitySignal[] = [];
    const unsubscribe = subscribeToTaskActivity((s) => received.push(s));

    es.onopen?.();

    expect(received).toEqual([{ kind: "resync" }]);
    unsubscribe();
  });

  it("T15: the tab becoming visible again dispatches a resync signal", () => {
    render(<TaskRealtimeNotifications />);

    const received: TaskActivitySignal[] = [];
    const unsubscribe = subscribeToTaskActivity((s) => received.push(s));

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(received).toEqual([{ kind: "resync" }]);
    unsubscribe();
  });

  it("a hidden tab does NOT dispatch a resync signal", () => {
    render(<TaskRealtimeNotifications />);

    const received: TaskActivitySignal[] = [];
    const unsubscribe = subscribeToTaskActivity((s) => received.push(s));

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(received).toHaveLength(0);
    unsubscribe();
  });

  it("K: an onerror never throws and renders nothing (no global error UI)", () => {
    const { container } = render(<TaskRealtimeNotifications />);
    const es = FakeEventSource.instances[0];
    expect(() => es.onerror?.()).not.toThrow();
    expect(container).toBeEmptyDOMElement();
  });
});
