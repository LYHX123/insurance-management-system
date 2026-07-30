import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomBytes } from "crypto";

const TEST_KEY = randomBytes(32);
const TEST_ENV = {
  appKey: "test-app-key",
  appSecret: "test-app-secret",
  redirectUri: "http://localhost:3001/api/integrations/dropbox/callback",
  tokenEncryptionKey: TEST_KEY,
};

const DROPBOX_NAMESPACE_CONFIG_ID = "singleton";
function defaultConfigRow() {
  return {
    id: DROPBOX_NAMESPACE_CONFIG_ID,
    activeNamespaceMode: "HOME" as string,
    activeRootFolder: "/Insurance Management System",
    encryptedDestinationNamespaceId: null as string | null,
    destinationNamespaceDisplayName: null as string | null,
    destinationRootFolder: "/Insurance Management System",
    destinationResolvedAt: null as Date | null,
    migrationLocked: false,
    migrationLockedAt: null as Date | null,
    lastErrorCode: null as string | null,
    lastErrorMessage: null as string | null,
    activatedAt: null as Date | null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
let store = defaultConfigRow();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dropboxNamespaceConfig: {
      upsert: vi.fn(async () => store),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        store = { ...store, ...data } as typeof store;
        return store;
      }),
    },
  },
}));

const constructedConfigs: Array<Record<string, unknown>> = [];
vi.mock("dropbox", () => ({
  Dropbox: vi.fn().mockImplementation(function (config: Record<string, unknown>) {
    constructedConfigs.push(config);
    return {};
  }),
}));

describe("getActiveClient (Migration Part 13.A/13.E — namespace routing + lock)", () => {
  beforeEach(() => {
    store = defaultConfigRow();
    vi.clearAllMocks();
    constructedConfigs.length = 0;
  });

  it("returns MIGRATION_LOCKED and builds no client at all while the lock is held", async () => {
    store.migrationLocked = true;
    const { getActiveClient } = await import("../config");

    const result = await getActiveClient(TEST_ENV, "refresh-token", "/Insurance Management System");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("MIGRATION_LOCKED");
    expect(constructedConfigs).toHaveLength(0);
  });

  it("HOME mode (default, pre-migration) returns the unchanged Home-namespace client and the caller's own root folder", async () => {
    const { getActiveClient } = await import("../config");

    const result = await getActiveClient(TEST_ENV, "refresh-token", "/Insurance Management System");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effectiveRootFolder).toBe("/Insurance Management System");
    }
    expect(constructedConfigs).toHaveLength(1);
    expect(constructedConfigs[0].pathRoot).toBeUndefined();
  });

  it("TEAM_FOLDER_NAMESPACE mode with no destination configured yet returns NAMESPACE_NOT_RESOLVED", async () => {
    store.activeNamespaceMode = "TEAM_FOLDER_NAMESPACE";
    const { getActiveClient } = await import("../config");

    const result = await getActiveClient(TEST_ENV, "refresh-token", "/Insurance Management System");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NAMESPACE_NOT_RESOLVED");
  });

  it("TEAM_FOLDER_NAMESPACE mode with a resolved destination returns the destination namespace client and destination root", async () => {
    const { encryptToken } = await import("../../encryption");
    store.activeNamespaceMode = "TEAM_FOLDER_NAMESPACE";
    store.encryptedDestinationNamespaceId = encryptToken("ns-teamfolder", TEST_KEY);
    store.activeRootFolder = "/Insurance Management System";

    const { getActiveClient } = await import("../config");
    const result = await getActiveClient(TEST_ENV, "refresh-token", "/Insurance Management System");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effectiveRootFolder).toBe("/Insurance Management System");
    }
    expect(constructedConfigs).toHaveLength(1);
    expect(JSON.parse(constructedConfigs[0].pathRoot as string)).toEqual({ ".tag": "namespace_id", namespace_id: "ns-teamfolder" });
  });

  it("never falls back to a Home-namespace client when TEAM_FOLDER_NAMESPACE is active (no silent write-back to LI YONG)", async () => {
    const { encryptToken } = await import("../../encryption");
    store.activeNamespaceMode = "TEAM_FOLDER_NAMESPACE";
    store.encryptedDestinationNamespaceId = encryptToken("ns-teamfolder", TEST_KEY);

    const { getActiveClient } = await import("../config");
    await getActiveClient(TEST_ENV, "refresh-token", "/Insurance Management System");

    expect(constructedConfigs).toHaveLength(1);
    expect(constructedConfigs[0].pathRoot).not.toBeUndefined();
  });
});
