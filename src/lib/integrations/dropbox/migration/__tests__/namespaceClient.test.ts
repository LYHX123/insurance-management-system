import { describe, it, expect, vi, beforeEach } from "vitest";

const usersGetCurrentAccount = vi.fn();
const filesGetMetadata = vi.fn();
const filesListFolder = vi.fn();

// Every `new Dropbox(config)` call is captured here in order, so tests can
// assert exactly which pathRoot (if any) each successive client used —
// this is the safety-critical part: "root" vs "namespace_id" vs no pathRoot
// at all (Home namespace).
const constructedConfigs: Array<Record<string, unknown>> = [];

vi.mock("dropbox", () => ({
  Dropbox: vi.fn().mockImplementation(function (config: Record<string, unknown>) {
    constructedConfigs.push(config);
    return { usersGetCurrentAccount, filesGetMetadata, filesListFolder };
  }),
}));

const TEST_ENV = {
  appKey: "test-app-key",
  appSecret: "test-app-secret",
  redirectUri: "http://localhost:3001/api/integrations/dropbox/callback",
  tokenEncryptionKey: Buffer.alloc(32, 1),
};

describe("namespaceClient (Migration Part 1/13.A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constructedConfigs.length = 0;
  });

  it("createSourceClient builds a Dropbox client with no pathRoot (Home namespace, unchanged behavior)", async () => {
    const { createSourceClient } = await import("../namespaceClient");
    createSourceClient(TEST_ENV, "refresh-token-1");

    expect(constructedConfigs).toHaveLength(1);
    expect(constructedConfigs[0].pathRoot).toBeUndefined();
    expect(constructedConfigs[0].refreshToken).toBe("refresh-token-1");
  });

  it("createNamespaceClient sends the Dropbox-API-Path-Root 'namespace_id' tag, never 'root'", async () => {
    const { createNamespaceClient } = await import("../namespaceClient");
    createNamespaceClient(TEST_ENV, "refresh-token-1", "ns-12345");

    expect(constructedConfigs).toHaveLength(1);
    const pathRoot = JSON.parse(constructedConfigs[0].pathRoot as string);
    expect(pathRoot).toEqual({ ".tag": "namespace_id", namespace_id: "ns-12345" });
  });

  it("resolveTeamFolderNamespace throws NAMESPACE_NOT_TEAM_ELIGIBLE when root namespace equals home namespace", async () => {
    usersGetCurrentAccount.mockResolvedValue({
      result: { root_info: { ".tag": "user", root_namespace_id: "ns-same", home_namespace_id: "ns-same" } },
    });

    const { resolveTeamFolderNamespace } = await import("../namespaceClient");
    await expect(resolveTeamFolderNamespace(TEST_ENV, "refresh-token-1")).rejects.toMatchObject({
      code: "NAMESPACE_NOT_TEAM_ELIGIBLE",
    });
  });

  it("resolves the Team Folder's own distinct namespace id via sharing_info, using 'root' only transiently for the lookup", async () => {
    usersGetCurrentAccount.mockResolvedValue({
      result: { root_info: { ".tag": "user", root_namespace_id: "ns-root", home_namespace_id: "ns-home" } },
    });
    filesGetMetadata.mockResolvedValue({
      result: { ".tag": "folder", sharing_info: { shared_folder_id: "ns-teamfolder" } },
    });
    filesListFolder.mockResolvedValue({ result: { entries: [] } });

    const { resolveTeamFolderNamespace } = await import("../namespaceClient");
    const resolved = await resolveTeamFolderNamespace(TEST_ENV, "refresh-token-1");

    expect(resolved.namespaceId).toBe("ns-teamfolder");

    // Constructor call order: [0] home (no pathRoot), [1] root (tag "root"),
    // [2] candidate (tag "namespace_id") — verifying the exact sequence
    // guards against ever reusing the "root" tag for a non-own namespace,
    // which throws PathRootError.invalid_root against the real API.
    expect(constructedConfigs).toHaveLength(3);
    expect(constructedConfigs[0].pathRoot).toBeUndefined();
    expect(JSON.parse(constructedConfigs[1].pathRoot as string)).toEqual({ ".tag": "root", root: "ns-root" });
    expect(JSON.parse(constructedConfigs[2].pathRoot as string)).toEqual({ ".tag": "namespace_id", namespace_id: "ns-teamfolder" });
  });

  it("throws NAMESPACE_NOT_TEAM_ELIGIBLE when the Team Folder metadata has no shared_folder_id", async () => {
    usersGetCurrentAccount.mockResolvedValue({
      result: { root_info: { ".tag": "user", root_namespace_id: "ns-root", home_namespace_id: "ns-home" } },
    });
    filesGetMetadata.mockResolvedValue({ result: { ".tag": "folder" } });

    const { resolveTeamFolderNamespace } = await import("../namespaceClient");
    await expect(resolveTeamFolderNamespace(TEST_ENV, "refresh-token-1")).rejects.toMatchObject({
      code: "NAMESPACE_NOT_TEAM_ELIGIBLE",
    });
  });
});
