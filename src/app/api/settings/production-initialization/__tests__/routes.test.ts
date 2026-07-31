import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const isEnabledMock = vi.fn();
vi.mock("@/lib/productionInit/constants", () => ({
  isProductionInitializationEnabled: () => isEnabledMock(),
  CONFIRMATION_TEXT: "INITIALIZE SYSTEM",
}));

const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

const isAdminMock = vi.fn();
vi.mock("@/lib/permissions", () => ({ isAdmin: (user: unknown) => isAdminMock(user) }));

const previewMock = vi.fn();
vi.mock("@/lib/productionInit/preview", () => ({ getProductionInitializationPreview: () => previewMock() }));

const statusMock = vi.fn();
vi.mock("@/lib/productionInit/status", () => ({ getProductionInitializationStatus: () => statusMock() }));

const executeMock = vi.fn();
vi.mock("@/lib/productionInit/execute", () => ({ runProductionInitialization: (input: unknown) => executeMock(input) }));

const ADMIN_USER = { id: "admin-1", role: "ADMIN", status: "ACTIVE", permissions: [] };
const STAFF_USER = { id: "staff-1", role: "Staff", status: "ACTIVE", permissions: [] };

describe("GET /api/settings/production-initialization/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewMock.mockResolvedValue({ toDelete: {}, toPreserve: {} });
    statusMock.mockResolvedValue({ lastRun: null, cooldownUntil: null, currentlyRunning: false });
  });

  it("scenario 2: returns 404 when the feature flag is disabled, without checking auth", async () => {
    isEnabledMock.mockReturnValue(false);
    const { GET } = await import("../preview/route");
    const res = await GET();
    expect(res.status).toBe(404);
    expect(authMock).not.toHaveBeenCalled();
  });

  it("scenario 4: returns 401 when not logged in", async () => {
    isEnabledMock.mockReturnValue(true);
    authMock.mockResolvedValue(null);
    const { GET } = await import("../preview/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("scenario 5: returns 403 for a logged-in non-admin", async () => {
    isEnabledMock.mockReturnValue(true);
    authMock.mockResolvedValue({ user: STAFF_USER });
    isAdminMock.mockReturnValue(false);
    const { GET } = await import("../preview/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("scenario 6/7: returns 200 with preview+status for an admin, and calls only the read-only preview function", async () => {
    isEnabledMock.mockReturnValue(true);
    authMock.mockResolvedValue({ user: ADMIN_USER });
    isAdminMock.mockReturnValue(true);
    const { GET } = await import("../preview/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("preview");
    expect(body).toHaveProperty("status");
    expect(previewMock).toHaveBeenCalledTimes(1);
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/settings/production-initialization/execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeRequest(body: unknown) {
    return new NextRequest("http://localhost/api/settings/production-initialization/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("scenario 3: returns 404 when disabled, without checking auth", async () => {
    isEnabledMock.mockReturnValue(false);
    const { POST } = await import("../execute/route");
    const res = await POST(makeRequest({ confirmationText: "INITIALIZE SYSTEM", backupConfirmed: true }));
    expect(res.status).toBe(404);
    expect(authMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("returns 401 when not logged in", async () => {
    isEnabledMock.mockReturnValue(true);
    authMock.mockResolvedValue(null);
    const { POST } = await import("../execute/route");
    const res = await POST(makeRequest({ confirmationText: "INITIALIZE SYSTEM", backupConfirmed: true }));
    expect(res.status).toBe(401);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-admin", async () => {
    isEnabledMock.mockReturnValue(true);
    authMock.mockResolvedValue({ user: STAFF_USER });
    isAdminMock.mockReturnValue(false);
    const { POST } = await import("../execute/route");
    const res = await POST(makeRequest({ confirmationText: "INITIALIZE SYSTEM", backupConfirmed: true }));
    expect(res.status).toBe(403);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("passes confirmationText/backupConfirmed/reason/ip/userAgent through to the lib function for an admin", async () => {
    isEnabledMock.mockReturnValue(true);
    authMock.mockResolvedValue({ user: ADMIN_USER });
    isAdminMock.mockReturnValue(true);
    executeMock.mockResolvedValue({
      success: true,
      deletedCounts: {},
      preservedCountsAfter: {},
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      nextAvailableAt: "2026-01-02T00:00:01.000Z",
      dropboxConnectionStatus: "CONNECTED",
    });
    const req = new NextRequest("http://localhost/api/settings/production-initialization/execute", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5", "user-agent": "vitest-agent" },
      body: JSON.stringify({ confirmationText: "INITIALIZE SYSTEM", backupConfirmed: true, reason: "PRODUCTION_GO_LIVE" }),
    });
    const { POST } = await import("../execute/route");
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(executeMock).toHaveBeenCalledWith({
      confirmationText: "INITIALIZE SYSTEM",
      backupConfirmed: true,
      reason: "PRODUCTION_GO_LIVE",
      ipAddress: "203.0.113.5",
      userAgent: "vitest-agent",
    });
  });

  it("passes reason through as-is (undefined when omitted) — the route never validates it itself, only forwards to the lib function's whitelist check", async () => {
    isEnabledMock.mockReturnValue(true);
    authMock.mockResolvedValue({ user: ADMIN_USER });
    isAdminMock.mockReturnValue(true);
    executeMock.mockResolvedValue({ success: false, error: "INVALID_REASON", message: "bad" });
    const { POST } = await import("../execute/route");
    const res = await POST(makeRequest({ confirmationText: "INITIALIZE SYSTEM", backupConfirmed: true }));
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({ reason: undefined }));
    expect(res.status).toBe(400);
  });

  it.each([
    ["ALREADY_RUNNING", 409],
    ["COOLDOWN_ACTIVE", 409],
    ["INVALID_CONFIRMATION", 400],
    ["BACKUP_NOT_CONFIRMED", 400],
    ["INVALID_REASON", 400],
    ["TRANSACTION_FAILED", 500],
  ])("maps lib error %s to HTTP %i", async (error, expectedStatus) => {
    isEnabledMock.mockReturnValue(true);
    authMock.mockResolvedValue({ user: ADMIN_USER });
    isAdminMock.mockReturnValue(true);
    executeMock.mockResolvedValue({ success: false, error, message: "test message" });
    const { POST } = await import("../execute/route");
    const res = await POST(makeRequest({ confirmationText: "INITIALIZE SYSTEM", backupConfirmed: true, reason: "PRODUCTION_GO_LIVE" }));
    expect(res.status).toBe(expectedStatus);
  });

  it("rejects a malformed JSON body with 400 before ever calling the lib function", async () => {
    isEnabledMock.mockReturnValue(true);
    authMock.mockResolvedValue({ user: ADMIN_USER });
    isAdminMock.mockReturnValue(true);
    const req = new NextRequest("http://localhost/api/settings/production-initialization/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const { POST } = await import("../execute/route");
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(executeMock).not.toHaveBeenCalled();
  });
});
