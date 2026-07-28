import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { randomBytes } from "crypto";

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth }));

const buildAuthorizationUrl = vi.fn(async (): Promise<string> => "https://www.dropbox.com/oauth2/authorize?mock=1");
vi.mock("@/lib/integrations/dropbox/auth", () => ({ buildAuthorizationUrl }));

const completeOAuthConnection = vi.fn();
const recordDropboxError = vi.fn(async (...args: [string, string]): Promise<void> => void args);
vi.mock("@/lib/integrations/dropbox/service", () => ({ completeOAuthConnection, recordDropboxError }));

const TEST_ENV = {
  DROPBOX_APP_KEY: "test-app-key",
  DROPBOX_APP_SECRET: "test-app-secret",
  DROPBOX_REDIRECT_URI: "http://localhost:3001/api/integrations/dropbox/callback",
  DROPBOX_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

const ADMIN_SESSION = { user: { id: "admin-1", role: "ADMIN", status: "ACTIVE", permissions: [] } };
const STAFF_SESSION = { user: { id: "staff-1", role: "Staff", status: "ACTIVE", permissions: [] } };

describe("GET /api/integrations/dropbox/connect (Part 20.A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;
  });

  it("denies a non-admin session (redirects to /access-denied, never sets a state cookie)", async () => {
    auth.mockResolvedValue(STAFF_SESSION);
    const { GET } = await import("../../../../app/api/integrations/dropbox/connect/route");

    const req = new NextRequest("http://localhost:3001/api/integrations/dropbox/connect");
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/access-denied");
    expect(res.cookies.get("dropbox_oauth_state")).toBeUndefined();
  });

  it("redirects an admin to Dropbox and sets a short-lived, httpOnly, sameSite=lax state cookie", async () => {
    auth.mockResolvedValue(ADMIN_SESSION);
    const { GET } = await import("../../../../app/api/integrations/dropbox/connect/route");

    const req = new NextRequest("http://localhost:3001/api/integrations/dropbox/connect");
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("dropbox.com");

    const cookie = res.cookies.get("dropbox_oauth_state");
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.maxAge).toBeLessThanOrEqual(600);
    // Bound to the initiating admin's id, not just an opaque value.
    expect(cookie?.value.endsWith(".admin-1")).toBe(true);
  });

  it("shows a safe CONFIGURATION_MISSING redirect when env vars are absent, never calling Dropbox", async () => {
    delete process.env.DROPBOX_APP_KEY;
    auth.mockResolvedValue(ADMIN_SESSION);
    const { GET } = await import("../../../../app/api/integrations/dropbox/connect/route");

    const req = new NextRequest("http://localhost:3001/api/integrations/dropbox/connect");
    const res = await GET(req);

    expect(res.headers.get("location")).toContain("code=CONFIGURATION_MISSING");
    expect(buildAuthorizationUrl).not.toHaveBeenCalled();
  });
});

describe("GET /api/integrations/dropbox/callback (Part 20.A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;
  });

  it("denies a non-admin session", async () => {
    auth.mockResolvedValue(STAFF_SESSION);
    const { GET } = await import("../../../../app/api/integrations/dropbox/callback/route");

    const req = new NextRequest("http://localhost:3001/api/integrations/dropbox/callback?code=abc&state=xyz");
    const res = await GET(req);

    expect(res.headers.get("location")).toContain("/access-denied");
  });

  it("handles Dropbox OAuth denial safely (no crash, safe redirect, records a safe error)", async () => {
    auth.mockResolvedValue(ADMIN_SESSION);
    const { GET } = await import("../../../../app/api/integrations/dropbox/callback/route");

    const req = new NextRequest("http://localhost:3001/api/integrations/dropbox/callback?error=access_denied");
    const res = await GET(req);

    expect(res.headers.get("location")).toContain("dropbox=error");
    expect(res.headers.get("location")).toContain("code=OAUTH_DENIED");
    expect(recordDropboxError).toHaveBeenCalledWith("OAUTH_DENIED", expect.any(String));
    expect(completeOAuthConnection).not.toHaveBeenCalled();
  });

  it("rejects a callback with a missing state cookie", async () => {
    auth.mockResolvedValue(ADMIN_SESSION);
    const { GET } = await import("../../../../app/api/integrations/dropbox/callback/route");

    const req = new NextRequest("http://localhost:3001/api/integrations/dropbox/callback?code=abc&state=xyz");
    const res = await GET(req);

    expect(res.headers.get("location")).toContain("code=OAUTH_STATE_INVALID");
    expect(completeOAuthConnection).not.toHaveBeenCalled();
  });

  it("rejects a callback whose state does not match the stored cookie", async () => {
    auth.mockResolvedValue(ADMIN_SESSION);
    const { GET } = await import("../../../../app/api/integrations/dropbox/callback/route");

    const req = new NextRequest("http://localhost:3001/api/integrations/dropbox/callback?code=abc&state=WRONG_STATE");
    req.cookies.set("dropbox_oauth_state", "REAL_STATE.admin-1");
    const res = await GET(req);

    expect(res.headers.get("location")).toContain("code=OAUTH_STATE_INVALID");
    expect(completeOAuthConnection).not.toHaveBeenCalled();
  });

  it("rejects a callback whose state was bound to a different admin", async () => {
    auth.mockResolvedValue(ADMIN_SESSION); // session is admin-1
    const { GET } = await import("../../../../app/api/integrations/dropbox/callback/route");

    const req = new NextRequest("http://localhost:3001/api/integrations/dropbox/callback?code=abc&state=REAL_STATE");
    req.cookies.set("dropbox_oauth_state", "REAL_STATE.some-other-admin");
    const res = await GET(req);

    expect(res.headers.get("location")).toContain("code=OAUTH_STATE_INVALID");
    expect(completeOAuthConnection).not.toHaveBeenCalled();
  });

  it("clears the state cookie after a successful callback and redirects to the connected success URL", async () => {
    auth.mockResolvedValue(ADMIN_SESSION);
    completeOAuthConnection.mockResolvedValue({ id: "singleton", status: "CONNECTED" });
    const { GET } = await import("../../../../app/api/integrations/dropbox/callback/route");

    const req = new NextRequest("http://localhost:3001/api/integrations/dropbox/callback?code=abc&state=REAL_STATE");
    req.cookies.set("dropbox_oauth_state", "REAL_STATE.admin-1");
    const res = await GET(req);

    expect(res.headers.get("location")).toContain("dropbox=connected");
    const cookie = res.cookies.get("dropbox_oauth_state");
    expect(cookie?.value === "" || cookie === undefined).toBe(true);
  });
});
