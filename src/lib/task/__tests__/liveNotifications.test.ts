import { describe, it, expect, vi } from "vitest";
import {
  subscribeUserTaskNotifications,
  publishTaskActivityAfterMutation,
  __getSubscriberCountForTests,
  type TaskActivityEvent,
} from "../liveNotifications";

// Real-time unread notification (this session) — the process-in-memory
// broker is the one piece of Phase 8 with no framework/DB dependency at
// all, so these are plain unit tests against the real module (no mocking).

describe("liveNotifications broker", () => {
  it("T1a: subscribe delivers events published to that exact user", async () => {
    const received: TaskActivityEvent[] = [];
    const unsubscribe = subscribeUserTaskNotifications("user-a", (e) => received.push(e));

    publishTaskActivityAfterMutation({ scope: "TASK", entityId: "task-1", actorUserId: "user-b", participantUserIds: ["user-a", "user-b"] });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ scope: "TASK", entityId: "task-1", actorUserId: "user-b" });
    expect(typeof received[0].timestamp).toBe("string");
    unsubscribe();
  });

  it("T1b: unsubscribe stops further delivery to that listener", async () => {
    const received: TaskActivityEvent[] = [];
    const unsubscribe = subscribeUserTaskNotifications("user-a", (e) => received.push(e));
    unsubscribe();

    publishTaskActivityAfterMutation({ scope: "TASK", entityId: "task-1", actorUserId: "user-b", participantUserIds: ["user-a", "user-b"] });

    expect(received).toHaveLength(0);
  });

  it("T1c / T5 / T10: only target users are notified — an unrelated user (not a participant) receives nothing", async () => {
    const receivedA: TaskActivityEvent[] = [];
    const receivedB: TaskActivityEvent[] = [];
    const receivedC: TaskActivityEvent[] = [];
    const unsubA = subscribeUserTaskNotifications("user-a", (e) => receivedA.push(e));
    const unsubB = subscribeUserTaskNotifications("user-b", (e) => receivedB.push(e));
    const unsubC = subscribeUserTaskNotifications("user-c", (e) => receivedC.push(e));

    // C is deliberately excluded from participantUserIds (not a participant
    // of this Task).
    publishTaskActivityAfterMutation({ scope: "TASK", entityId: "task-1", actorUserId: "user-b", participantUserIds: ["user-a", "user-b"] });

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(0); // actor excluded (T5)
    expect(receivedC).toHaveLength(0); // unrelated user (T10)
    unsubA();
    unsubB();
    unsubC();
  });

  it("T5: the acting user is always excluded, even if listed twice in participantUserIds", async () => {
    const received: TaskActivityEvent[] = [];
    const unsubscribe = subscribeUserTaskNotifications("user-b", (e) => received.push(e));

    publishTaskActivityAfterMutation({
      scope: "TASK",
      entityId: "task-1",
      actorUserId: "user-b",
      participantUserIds: ["user-b", "user-b", "user-a"],
    });

    expect(received).toHaveLength(0);
    unsubscribe();
  });

  it("T6: new-participant notification — a user added to participantUserIds after subscribing still receives the next publish", async () => {
    const received: TaskActivityEvent[] = [];
    const unsubscribe = subscribeUserTaskNotifications("user-c", (e) => received.push(e));

    // First publish: C is not yet a participant.
    publishTaskActivityAfterMutation({ scope: "TASK", entityId: "task-1", actorUserId: "user-a", participantUserIds: ["user-a", "user-b"] });
    expect(received).toHaveLength(0);

    // C is added as a participant (e.g. updateParticipantsAction); the next
    // mutation includes C.
    publishTaskActivityAfterMutation({ scope: "TASK", entityId: "task-1", actorUserId: "user-b", participantUserIds: ["user-a", "user-b", "user-c"] });
    expect(received).toHaveLength(1);
    unsubscribe();
  });

  it("T7 / T8 / T9: Daily Task, Motor Claim, and Non-Motor Claim events all carry the correct scope", async () => {
    const received: TaskActivityEvent[] = [];
    const unsubscribe = subscribeUserTaskNotifications("user-a", (e) => received.push(e));

    publishTaskActivityAfterMutation({ scope: "TASK", entityId: "t-1", actorUserId: "user-b", participantUserIds: ["user-a", "user-b"] });
    publishTaskActivityAfterMutation({ scope: "MOTOR_CLAIM", entityId: "m-1", actorUserId: "user-b", participantUserIds: ["user-a", "user-b"] });
    publishTaskActivityAfterMutation({ scope: "NON_MOTOR_CLAIM", entityId: "n-1", actorUserId: "user-b", participantUserIds: ["user-a", "user-b"] });

    expect(received.map((e) => e.scope)).toEqual(["TASK", "MOTOR_CLAIM", "NON_MOTOR_CLAIM"]);
    unsubscribe();
  });

  it("T14: an event never carries anything beyond scope/entityId/actorUserId/timestamp — no business content", async () => {
    const received: TaskActivityEvent[] = [];
    const unsubscribe = subscribeUserTaskNotifications("user-a", (e) => received.push(e));

    publishTaskActivityAfterMutation({ scope: "TASK", entityId: "task-1", actorUserId: "user-b", participantUserIds: ["user-a", "user-b"] });

    expect(received).toHaveLength(1);
    expect(Object.keys(received[0]).sort()).toEqual(["actorUserId", "entityId", "scope", "timestamp"]);
    unsubscribe();
  });

  it("T11: multiple subscribers for the same user (e.g. two open tabs) all receive the same publish", async () => {
    const receivedTab1: TaskActivityEvent[] = [];
    const receivedTab2: TaskActivityEvent[] = [];
    const unsub1 = subscribeUserTaskNotifications("user-a", (e) => receivedTab1.push(e));
    const unsub2 = subscribeUserTaskNotifications("user-a", (e) => receivedTab2.push(e));
    expect(__getSubscriberCountForTests("user-a")).toBe(2);

    publishTaskActivityAfterMutation({ scope: "TASK", entityId: "task-1", actorUserId: "user-b", participantUserIds: ["user-a", "user-b"] });

    expect(receivedTab1).toHaveLength(1);
    expect(receivedTab2).toHaveLength(1);
    unsub1();
    unsub2();
  });

  it("T12: disconnect cleanup — unsubscribing one of several listeners for a user leaves the others intact and removes only that one", async () => {
    const receivedTab1: TaskActivityEvent[] = [];
    const receivedTab2: TaskActivityEvent[] = [];
    const unsub1 = subscribeUserTaskNotifications("user-a", (e) => receivedTab1.push(e));
    const unsub2 = subscribeUserTaskNotifications("user-a", (e) => receivedTab2.push(e));

    unsub1(); // tab 1 disconnects
    expect(__getSubscriberCountForTests("user-a")).toBe(1);

    publishTaskActivityAfterMutation({ scope: "TASK", entityId: "task-1", actorUserId: "user-b", participantUserIds: ["user-a", "user-b"] });

    expect(receivedTab1).toHaveLength(0);
    expect(receivedTab2).toHaveLength(1);
    unsub2();
    expect(__getSubscriberCountForTests("user-a")).toBe(0);
  });

  it("T13: reconnect behavior — unsubscribe then subscribe again (simulating EventSource's own reconnect) never leaves a stale listener counted twice", async () => {
    const unsub1 = subscribeUserTaskNotifications("user-a", vi.fn());
    unsub1();
    const received: TaskActivityEvent[] = [];
    const unsub2 = subscribeUserTaskNotifications("user-a", (e) => received.push(e));

    expect(__getSubscriberCountForTests("user-a")).toBe(1);
    publishTaskActivityAfterMutation({ scope: "TASK", entityId: "task-1", actorUserId: "user-b", participantUserIds: ["user-a", "user-b"] });
    expect(received).toHaveLength(1); // exactly one delivery, not a leaked duplicate
    unsub2();
  });

  it("publishing with no eligible recipients (empty participant list, or only the actor) is a no-op that never throws", () => {
    expect(() => publishTaskActivityAfterMutation({ scope: "TASK", entityId: "task-1", actorUserId: "user-a", participantUserIds: [] })).not.toThrow();
    expect(() => publishTaskActivityAfterMutation({ scope: "TASK", entityId: "task-1", actorUserId: "user-a", participantUserIds: ["user-a"] })).not.toThrow();
  });
});
