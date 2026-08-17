import { describe, it, expect, beforeEach } from "vitest";
import { saveTaskListScroll, getTaskListScroll, clearTaskListScroll } from "../taskListScroll";

// Phase 7 Part B — unit coverage for the module-level scroll-position store
// (see taskListScroll.ts's own doc comment for why this is deliberately
// module state rather than React state/context).

describe("taskListScroll store", () => {
  beforeEach(() => {
    clearTaskListScroll("daily");
    clearTaskListScroll("motor-claim");
  });

  it("returns undefined for a category that was never saved", () => {
    expect(getTaskListScroll("daily")).toBeUndefined();
  });

  it("saves and retrieves a scroll position for a category", () => {
    saveTaskListScroll("daily", 240);
    expect(getTaskListScroll("daily")).toBe(240);
  });

  it("Case 2: two categories never share or overwrite each other's stored position", () => {
    saveTaskListScroll("daily", 240);
    saveTaskListScroll("motor-claim", 80);

    expect(getTaskListScroll("daily")).toBe(240);
    expect(getTaskListScroll("motor-claim")).toBe(80);
  });

  it("overwrites the previous value for the same category on repeated saves", () => {
    saveTaskListScroll("daily", 100);
    saveTaskListScroll("daily", 500);
    expect(getTaskListScroll("daily")).toBe(500);
  });

  it("clearTaskListScroll removes only the targeted category's entry", () => {
    saveTaskListScroll("daily", 240);
    saveTaskListScroll("motor-claim", 80);

    clearTaskListScroll("daily");

    expect(getTaskListScroll("daily")).toBeUndefined();
    expect(getTaskListScroll("motor-claim")).toBe(80);
  });
});
