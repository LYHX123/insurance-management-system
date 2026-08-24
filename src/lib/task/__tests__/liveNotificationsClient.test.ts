import { describe, it, expect, vi } from "vitest";
import { dispatchTaskActivity, dispatchResync, subscribeToTaskActivity, type TaskActivitySignal } from "../liveNotificationsClient";

describe("liveNotificationsClient (browser in-page bus)", () => {
  it("delivers an activity signal to a subscriber", () => {
    const received: TaskActivitySignal[] = [];
    const unsubscribe = subscribeToTaskActivity((s) => received.push(s));

    dispatchTaskActivity({ scope: "TASK", entityId: "task-1", actorUserId: "user-b", timestamp: "2026-01-01T00:00:00.000Z" });

    expect(received).toEqual([{ kind: "activity", scope: "TASK", entityId: "task-1", actorUserId: "user-b", timestamp: "2026-01-01T00:00:00.000Z" }]);
    unsubscribe();
  });

  it("delivers a resync signal (no entity) to a subscriber", () => {
    const received: TaskActivitySignal[] = [];
    const unsubscribe = subscribeToTaskActivity((s) => received.push(s));

    dispatchResync();

    expect(received).toEqual([{ kind: "resync" }]);
    unsubscribe();
  });

  it("unsubscribe stops further delivery", () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToTaskActivity(handler);
    unsubscribe();

    dispatchTaskActivity({ scope: "TASK", entityId: "task-1", actorUserId: "user-b", timestamp: "2026-01-01T00:00:00.000Z" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("fans out one dispatch to every current subscriber (multiple mounted components)", () => {
    const receivedA: TaskActivitySignal[] = [];
    const receivedB: TaskActivitySignal[] = [];
    const unsubA = subscribeToTaskActivity((s) => receivedA.push(s));
    const unsubB = subscribeToTaskActivity((s) => receivedB.push(s));

    dispatchResync();

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);
    unsubA();
    unsubB();
  });
});
