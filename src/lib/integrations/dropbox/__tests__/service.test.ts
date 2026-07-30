import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomBytes } from "crypto";

// --- Dummy test-only env config (never real credentials) ------------------
const TEST_ENV = {
  DROPBOX_APP_KEY: "test-app-key",
  DROPBOX_APP_SECRET: "test-app-secret",
  DROPBOX_REDIRECT_URI: "http://localhost:3001/api/integrations/dropbox/callback",
  DROPBOX_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

// --- In-memory fake for the DropboxIntegration singleton row --------------
const DROPBOX_INTEGRATION_ID = "singleton";
function defaultRow() {
  return {
    id: DROPBOX_INTEGRATION_ID,
    status: "DISCONNECTED" as string,
    encryptedRefreshToken: null as string | null,
    dropboxAccountId: null as string | null,
    accountEmail: null as string | null,
    accountDisplayName: null as string | null,
    rootFolder: "/Insurance Management System",
    rootFolderVerifiedAt: null as Date | null,
    connectedAt: null as Date | null,
    disconnectedAt: null as Date | null,
    lastTestedAt: null as Date | null,
    lastSuccessfulAt: null as Date | null,
    lastErrorCode: null as string | null,
    lastErrorMessage: null as string | null,
    connectedById: null as string | null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
let store = defaultRow();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dropboxIntegration: {
      upsert: vi.fn(async () => store),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        store = { ...store, ...data } as typeof store;
        return store;
      }),
    },
    // Migration namespace config — defaults to unlocked HOME mode, i.e. the
    // unchanged pre-migration behavior these tests all assume.
    dropboxNamespaceConfig: {
      upsert: vi.fn(async () => ({
        id: "singleton",
        activeNamespaceMode: "HOME",
        activeRootFolder: "/Insurance Management System",
        encryptedDestinationNamespaceId: null,
        destinationNamespaceDisplayName: null,
        destinationRootFolder: "/Insurance Management System",
        destinationResolvedAt: null,
        migrationLocked: false,
        migrationLockedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        activatedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      update: vi.fn(async () => ({})),
    },
  },
}));

// --- Fake Dropbox SDK -------------------------------------------------------
const usersGetCurrentAccount = vi.fn();
const filesGetMetadata = vi.fn();
const filesCreateFolderV2 = vi.fn();
const authTokenRevoke = vi.fn();
const getAccessTokenFromCode = vi.fn();
const getAuthenticationUrl = vi.fn(async () => "https://www.dropbox.com/oauth2/authorize?mock=1");

vi.mock("dropbox", () => ({
  // Regular `function` (not an arrow function) so it's usable with `new` —
  // client.ts/auth.ts construct `new Dropbox(...)`/`new DropboxAuth(...)`.
  Dropbox: vi.fn().mockImplementation(function () {
    return { usersGetCurrentAccount, filesGetMetadata, filesCreateFolderV2, authTokenRevoke };
  }),
  DropboxAuth: vi.fn().mockImplementation(function () {
    return { getAccessTokenFromCode, getAuthenticationUrl };
  }),
}));

function notFoundError() {
  return { status: 409, error: { error_summary: "path/not_found/.." } };
}
function expiredTokenError() {
  return { status: 401, error: { error_summary: "expired_access_token/.." } };
}

describe("Dropbox service (Part 20.D/E/F)", () => {
  beforeEach(() => {
    store = defaultRow();
    for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;
    vi.clearAllMocks();
    getAuthenticationUrl.mockResolvedValue("https://www.dropbox.com/oauth2/authorize?mock=1");
  });

  it("D: a successful OAuth callback stores account metadata and marks CONNECTED", async () => {
    const { completeOAuthConnection } = await import("../service");

    getAccessTokenFromCode.mockResolvedValue({
      result: { refresh_token: "dummy-refresh-token", access_token: "dummy-access-token", account_id: "dbid:dummy" },
    });
    usersGetCurrentAccount.mockResolvedValue({
      result: { account_id: "dbid:dummy", email: "tester@example.com", name: { display_name: "Test User" } },
    });
    filesGetMetadata.mockRejectedValue(notFoundError());
    filesCreateFolderV2.mockResolvedValue({ result: { metadata: { id: "id:folder123" } } });

    const row = await completeOAuthConnection({ code: "dummy-code", adminUserId: "admin-1" });

    expect(row.status).toBe("CONNECTED");
    expect(row.accountEmail).toBe("tester@example.com");
    expect(row.accountDisplayName).toBe("Test User");
    expect(row.connectedById).toBe("admin-1");
    // The plaintext refresh token must never be stored — only an encrypted payload.
    expect(row.encryptedRefreshToken).not.toBe("dummy-refresh-token");
    expect(row.encryptedRefreshToken?.startsWith("v1:")).toBe(true);
    expect(filesCreateFolderV2).toHaveBeenCalledWith({ path: "/Insurance Management System", autorename: false });
  });

  it("D: a callback without a refresh token fails safely and never marks CONNECTED", async () => {
    const { completeOAuthConnection } = await import("../service");
    getAccessTokenFromCode.mockResolvedValue({ result: { access_token: "dummy-access-token" } });

    await expect(completeOAuthConnection({ code: "dummy-code", adminUserId: "admin-1" })).rejects.toThrow(
      /refresh token/i
    );
    expect(store.status).toBe("DISCONNECTED");
    expect(store.encryptedRefreshToken).toBeNull();
  });

  it("D: an existing root folder is reused, not recreated", async () => {
    const { completeOAuthConnection } = await import("../service");
    getAccessTokenFromCode.mockResolvedValue({
      result: { refresh_token: "dummy-refresh-token", access_token: "dummy-access-token" },
    });
    usersGetCurrentAccount.mockResolvedValue({
      result: { account_id: "dbid:dummy", email: "tester@example.com", name: { display_name: "Test User" } },
    });
    filesGetMetadata.mockResolvedValue({ result: { ".tag": "folder", id: "id:existing" } });

    await completeOAuthConnection({ code: "dummy-code", adminUserId: "admin-1" });

    expect(filesCreateFolderV2).not.toHaveBeenCalled();
  });

  it("D: a file already at the root path blocks connection safely (ROOT_PATH_IS_FILE)", async () => {
    const { completeOAuthConnection } = await import("../service");
    getAccessTokenFromCode.mockResolvedValue({
      result: { refresh_token: "dummy-refresh-token", access_token: "dummy-access-token" },
    });
    usersGetCurrentAccount.mockResolvedValue({
      result: { account_id: "dbid:dummy", email: "tester@example.com", name: { display_name: "Test User" } },
    });
    filesGetMetadata.mockResolvedValue({ result: { ".tag": "file", id: "id:aFile" } });

    await expect(completeOAuthConnection({ code: "dummy-code", adminUserId: "admin-1" })).rejects.toMatchObject({
      code: "ROOT_PATH_IS_FILE",
    });
    expect(store.status).toBe("DISCONNECTED");
  });

  it("D: a successful test updates lastTestedAt/lastSuccessfulAt", async () => {
    const { completeOAuthConnection, testDropboxConnection } = await import("../service");
    getAccessTokenFromCode.mockResolvedValue({
      result: { refresh_token: "dummy-refresh-token", access_token: "dummy-access-token" },
    });
    usersGetCurrentAccount.mockResolvedValue({
      result: { account_id: "dbid:dummy", email: "tester@example.com", name: { display_name: "Test User" } },
    });
    filesGetMetadata.mockRejectedValue(notFoundError());
    filesCreateFolderV2.mockResolvedValue({ result: { metadata: { id: "id:folder123" } } });
    await completeOAuthConnection({ code: "dummy-code", adminUserId: "admin-1" });

    filesGetMetadata.mockResolvedValue({ result: { ".tag": "folder", id: "id:folder123" } });
    const result = await testDropboxConnection();

    expect(result.success).toBe(true);
    expect(store.lastTestedAt).not.toBeNull();
    expect(store.lastSuccessfulAt).not.toBeNull();
  });

  it("D: a revoked token changes status/error safely on test, without throwing", async () => {
    const { completeOAuthConnection, testDropboxConnection } = await import("../service");
    getAccessTokenFromCode.mockResolvedValue({
      result: { refresh_token: "dummy-refresh-token", access_token: "dummy-access-token" },
    });
    usersGetCurrentAccount.mockResolvedValue({
      result: { account_id: "dbid:dummy", email: "tester@example.com", name: { display_name: "Test User" } },
    });
    filesGetMetadata.mockRejectedValue(notFoundError());
    filesCreateFolderV2.mockResolvedValue({ result: { metadata: { id: "id:folder123" } } });
    await completeOAuthConnection({ code: "dummy-code", adminUserId: "admin-1" });

    usersGetCurrentAccount.mockRejectedValue(expiredTokenError());
    const result = await testDropboxConnection();

    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("TOKEN_REVOKED");
    expect(store.status).toBe("ERROR");
    expect(store.lastErrorCode).toBe("TOKEN_REVOKED");
  });

  it("F: disconnect calls token revoke, clears local token, and preserves rootFolder", async () => {
    const { completeOAuthConnection, disconnectDropbox } = await import("../service");
    getAccessTokenFromCode.mockResolvedValue({
      result: { refresh_token: "dummy-refresh-token", access_token: "dummy-access-token" },
    });
    usersGetCurrentAccount.mockResolvedValue({
      result: { account_id: "dbid:dummy", email: "tester@example.com", name: { display_name: "Test User" } },
    });
    filesGetMetadata.mockRejectedValue(notFoundError());
    filesCreateFolderV2.mockResolvedValue({ result: { metadata: { id: "id:folder123" } } });
    await completeOAuthConnection({ code: "dummy-code", adminUserId: "admin-1" });

    authTokenRevoke.mockResolvedValue({ result: undefined });
    const result = await disconnectDropbox();

    expect(result.success).toBe(true);
    expect(authTokenRevoke).toHaveBeenCalledOnce();
    expect(store.status).toBe("DISCONNECTED");
    expect(store.encryptedRefreshToken).toBeNull();
    expect(store.dropboxAccountId).toBeNull();
    // Root folder configuration is explicitly preserved across disconnect.
    expect(store.rootFolder).toBe("/Insurance Management System");
  });

  it("F: an already-revoked token still allows local disconnect (non-fatal warning)", async () => {
    const { completeOAuthConnection, disconnectDropbox } = await import("../service");
    getAccessTokenFromCode.mockResolvedValue({
      result: { refresh_token: "dummy-refresh-token", access_token: "dummy-access-token" },
    });
    usersGetCurrentAccount.mockResolvedValue({
      result: { account_id: "dbid:dummy", email: "tester@example.com", name: { display_name: "Test User" } },
    });
    filesGetMetadata.mockRejectedValue(notFoundError());
    filesCreateFolderV2.mockResolvedValue({ result: { metadata: { id: "id:folder123" } } });
    await completeOAuthConnection({ code: "dummy-code", adminUserId: "admin-1" });

    authTokenRevoke.mockRejectedValue(expiredTokenError());
    const result = await disconnectDropbox();

    expect(result.success).toBe(true);
    expect(result.warning).toBeDefined();
    expect(store.status).toBe("DISCONNECTED");
    expect(store.encryptedRefreshToken).toBeNull();
  });

  it("Non-admin/unconfigured: CONFIGURATION_MISSING is returned instead of throwing when env vars are absent", async () => {
    delete process.env.DROPBOX_APP_KEY;
    const { testDropboxConnection } = await import("../service");
    const result = await testDropboxConnection();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("CONFIGURATION_MISSING");
  });

  it("C: saveDropboxRootFolder rejects an invalid path without touching the stored value", async () => {
    const { saveDropboxRootFolder } = await import("../service");
    const before = store.rootFolder;
    const result = await saveDropboxRootFolder("/");
    expect(result.success).toBe(false);
    expect(store.rootFolder).toBe(before);
  });

  it("Network error during test does not destroy a valid connection's stored account fields", async () => {
    const { completeOAuthConnection, testDropboxConnection } = await import("../service");
    getAccessTokenFromCode.mockResolvedValue({
      result: { refresh_token: "dummy-refresh-token", access_token: "dummy-access-token" },
    });
    usersGetCurrentAccount.mockResolvedValue({
      result: { account_id: "dbid:dummy", email: "tester@example.com", name: { display_name: "Test User" } },
    });
    filesGetMetadata.mockRejectedValue(notFoundError());
    filesCreateFolderV2.mockResolvedValue({ result: { metadata: { id: "id:folder123" } } });
    await completeOAuthConnection({ code: "dummy-code", adminUserId: "admin-1" });

    usersGetCurrentAccount.mockRejectedValue(new TypeError("fetch failed"));
    const result = await testDropboxConnection();

    expect(result.success).toBe(false);
    // Account identity fields must survive a transient network failure.
    expect(store.dropboxAccountId).toBe("dbid:dummy");
    expect(store.encryptedRefreshToken).not.toBeNull();
  });
});
