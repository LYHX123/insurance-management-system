import { describe, it, expect } from "vitest";
import { buildDropboxPathView, safeJoinPlannedPath } from "../pathDisplay";

describe("buildDropboxPathView (Phase 5 Part 2)", () => {
  it("returns not_connected with the planned path when Dropbox isn't connected", () => {
    const view = buildDropboxPathView({ dropboxConnected: false, syncStatus: "SYNCED", actualPath: "/actual", plannedPath: "/planned" });
    expect(view.state).toBe("not_connected");
    expect(view.path).toBe("/planned");
    expect(view.isPlanned).toBe(true);
  });

  it("returns synced with the actual path when SYNCED and an actual path exists", () => {
    const view = buildDropboxPathView({ dropboxConnected: true, syncStatus: "SYNCED", actualPath: "/actual", plannedPath: "/planned" });
    expect(view.state).toBe("synced");
    expect(view.path).toBe("/actual");
    expect(view.isPlanned).toBe(false);
  });

  it("falls back to planned even if SYNCED but actualPath is somehow null", () => {
    const view = buildDropboxPathView({ dropboxConnected: true, syncStatus: "SYNCED", actualPath: null, plannedPath: "/planned" });
    expect(view.state).toBe("planned");
    expect(view.path).toBe("/planned");
  });

  it("returns conflict with the planned path and error message", () => {
    const view = buildDropboxPathView({ dropboxConnected: true, syncStatus: "CONFLICT", actualPath: null, plannedPath: "/planned", errorMessage: "conflict!" });
    expect(view.state).toBe("conflict");
    expect(view.path).toBe("/planned");
    expect(view.errorMessage).toBe("conflict!");
  });

  it("returns error with the planned path and error message", () => {
    const view = buildDropboxPathView({ dropboxConnected: true, syncStatus: "ERROR", actualPath: null, plannedPath: "/planned", errorMessage: "boom" });
    expect(view.state).toBe("error");
    expect(view.errorMessage).toBe("boom");
  });

  it("returns syncing while a sync is in progress", () => {
    const view = buildDropboxPathView({ dropboxConnected: true, syncStatus: "SYNCING", actualPath: null, plannedPath: "/planned" });
    expect(view.state).toBe("syncing");
  });

  it("returns planned (pending badge) before any sync attempt", () => {
    const view = buildDropboxPathView({ dropboxConnected: true, syncStatus: "PENDING", actualPath: null, plannedPath: "/planned" });
    expect(view.state).toBe("planned");
    expect(view.isPlanned).toBe(true);
  });

  it("returns planned for a null syncStatus (no sync row yet) when a planned path is computable", () => {
    const view = buildDropboxPathView({ dropboxConnected: true, syncStatus: null, actualPath: null, plannedPath: "/planned" });
    expect(view.state).toBe("planned");
  });

  it("returns unavailable when no planned path could be computed at all", () => {
    const view = buildDropboxPathView({ dropboxConnected: true, syncStatus: null, actualPath: null, plannedPath: null });
    expect(view.state).toBe("unavailable");
    expect(view.path).toBeNull();
  });
});

describe("safeJoinPlannedPath (defense in depth)", () => {
  it("joins a valid parent path and segment", () => {
    expect(safeJoinPlannedPath("/Insurance Management System/Customers/CUST-0001", "Policy")).toBe(
      "/Insurance Management System/Customers/CUST-0001/Policy"
    );
  });

  it("returns null (never throws) for a malformed parent path", () => {
    expect(safeJoinPlannedPath("not-a-root-path", "Policy")).toBeNull();
  });

  it("rejects a traversal segment", () => {
    expect(safeJoinPlannedPath("/Insurance Management System/Customers/CUST-0001", "../../etc")).toBeNull();
  });
});
