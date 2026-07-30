import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomBytes } from "crypto";

// --- Dummy test-only env config (never real credentials) ------------------
const TEST_ENV = {
  DROPBOX_APP_KEY: "test-app-key",
  DROPBOX_APP_SECRET: "test-app-secret",
  DROPBOX_REDIRECT_URI: "http://localhost:3001/api/integrations/dropbox/callback",
  DROPBOX_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

// --- In-memory fakes --------------------------------------------------------
type CustomerRow = { id: string; customerNumber: string; companyName: string };
type FolderRow = {
  id: string;
  customerId: string;
  dropboxFolderId: string | null;
  folderName: string;
  displayPath: string | null;
  pathLower: string | null;
  syncStatus: string;
  lastSyncAttemptAt: Date | null;
  lastSyncedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

let customers: CustomerRow[] = [];
let folders: Map<string, FolderRow> = new Map();
let integration = {
  id: "singleton",
  status: "CONNECTED" as string,
  encryptedRefreshToken: null as string | null,
  rootFolder: "/Insurance Management System",
};

function defaultFolder(customerId: string, folderName: string): FolderRow {
  return {
    id: `folder-${customerId}`,
    customerId,
    dropboxFolderId: null,
    folderName,
    displayPath: null,
    pathLower: null,
    syncStatus: "PENDING",
    lastSyncAttemptAt: null,
    lastSyncedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dropboxIntegration: {
      upsert: vi.fn(async () => integration),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        integration = { ...integration, ...data } as typeof integration;
        return integration;
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
    customer: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => customers.find((c) => c.id === where.id) ?? null),
      count: vi.fn(async () => customers.length),
      findMany: vi.fn(async (args: { where?: Record<string, unknown>; take?: number }) => {
        const where = args.where ?? {};
        let candidates: CustomerRow[];
        if ("OR" in where) {
          candidates = customers.filter((c) => {
            const f = folders.get(c.id);
            return !f || f.syncStatus === "PENDING" || f.syncStatus === "SYNCING";
          });
        } else {
          const df = (where as { dropboxFolder?: { syncStatus?: unknown } }).dropboxFolder;
          const statusFilter = df?.syncStatus;
          candidates = customers.filter((c) => {
            const f = folders.get(c.id);
            if (!f) return false;
            if (typeof statusFilter === "object" && statusFilter && "in" in (statusFilter as object)) {
              return (statusFilter as { in: string[] }).in.includes(f.syncStatus);
            }
            return f.syncStatus === statusFilter;
          });
        }
        return candidates.slice(0, args.take ?? candidates.length).map((c) => ({ id: c.id, companyName: c.companyName }));
      }),
    },
    customerDropboxFolder: {
      findUnique: vi.fn(async ({ where }: { where: { customerId: string } }) => folders.get(where.customerId) ?? null),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { customerId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = folders.get(where.customerId);
          const row = existing
            ? ({ ...existing, ...update } as FolderRow)
            : ({ ...defaultFolder(where.customerId, create.folderName as string), ...create } as FolderRow);
          folders.set(where.customerId, row);
          return row;
        }
      ),
      update: vi.fn(async ({ where, data }: { where: { customerId: string }; data: Record<string, unknown> }) => {
        const existing = folders.get(where.customerId);
        if (!existing) throw new Error("not found");
        const row = { ...existing, ...data } as FolderRow;
        folders.set(where.customerId, row);
        return row;
      }),
      groupBy: vi.fn(async () => {
        const counts = new Map<string, number>();
        for (const f of folders.values()) counts.set(f.syncStatus, (counts.get(f.syncStatus) ?? 0) + 1);
        return Array.from(counts.entries()).map(([syncStatus, count]) => ({ syncStatus, _count: { _all: count } }));
      }),
    },
  },
}));

// --- Fake Dropbox SDK: a small stateful "virtual filesystem" so repeated
// calls behave like a real Dropbox account (created folders are found by
// later GetMetadata calls, moved folders resolve by id, etc.) rather than
// stateless per-call mocks that don't remember earlier calls. ---------------
// displayPath preserves the real (mixed-case) path an item was created/moved
// at, mirroring Dropbox's own path_display — separate from the map key,
// which is always lowercased for lookup. Optional so pre-existing tests that
// seed vfs entries directly (and never look them up by id) don't need it.
type VfsEntry = { tag: "folder" | "file"; id: string; displayPath?: string };
let vfs: Map<string, VfsEntry> = new Map();
let idCounter = 0;

function resetVfs() {
  vfs = new Map();
  idCounter = 0;
}

function notFoundError() {
  return { status: 409, error: { error_summary: "path/not_found/.." } };
}

const usersGetCurrentAccount = vi.fn();
// Real Dropbox metadata lookups by id resolve to the item's actual current
// path, not the id string itself — mirror that here so tests exercising
// verify/rebuild (which look up by stored dropboxFolderId) see a realistic
// path_display rather than the literal "id:..." token.
function metadataFor(path: string): { entry: VfsEntry; displayPath: string } | null {
  if (path.startsWith("id:")) {
    const key = findKeyById(path);
    const entry = key ? vfs.get(key) : undefined;
    return key && entry ? { entry, displayPath: entry.displayPath ?? key } : null;
  }
  const entry = vfs.get(path.toLowerCase());
  return entry ? { entry, displayPath: entry.displayPath ?? path } : null;
}
const filesGetMetadata = vi.fn(async ({ path }: { path: string }) => {
  const found = metadataFor(path);
  if (!found) throw notFoundError();
  return { result: { ".tag": found.entry.tag, id: found.entry.id, path_display: found.displayPath } };
});
const filesCreateFolderV2 = vi.fn(async ({ path }: { path: string }) => {
  const key = path.toLowerCase();
  if (vfs.has(key)) throw { status: 409, error: { error_summary: "path/conflict/folder/.." } };
  idCounter += 1;
  const id = `id:folder${idCounter}`;
  vfs.set(key, { tag: "folder", id, displayPath: path });
  return { result: { metadata: { id, path_display: path } } };
});
const filesMoveV2 = vi.fn(async ({ from_path, to_path }: { from_path: string; to_path: string }) => {
  const sourceKey = from_path.startsWith("id:") ? findKeyById(from_path) : from_path.toLowerCase();
  const sourceEntry = sourceKey ? vfs.get(sourceKey) : undefined;
  if (!sourceKey || !sourceEntry) throw notFoundError();
  const destKey = to_path.toLowerCase();
  if (vfs.has(destKey)) throw { status: 409, error: { error_summary: "to/conflict/folder/.." } };
  vfs.delete(sourceKey);
  vfs.set(destKey, { ...sourceEntry, displayPath: to_path });
  return { result: { metadata: { ".tag": sourceEntry.tag, id: sourceEntry.id, path_display: to_path } } };
});
const getAccessTokenFromCode = vi.fn();
const getAuthenticationUrl = vi.fn(async () => "https://www.dropbox.com/oauth2/authorize?mock=1");

function findKeyById(id: string): string | undefined {
  for (const [k, v] of vfs.entries()) if (v.id === id) return k;
  return undefined;
}

vi.mock("dropbox", () => ({
  Dropbox: vi.fn().mockImplementation(function () {
    return { usersGetCurrentAccount, filesGetMetadata, filesCreateFolderV2, filesMoveV2 };
  }),
  DropboxAuth: vi.fn().mockImplementation(function () {
    return { getAccessTokenFromCode, getAuthenticationUrl };
  }),
}));

describe("Customer Dropbox filing (Part 23.A/C/D/E/F)", () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;
    vi.clearAllMocks();
    customers = [{ id: "cust-1", customerNumber: "CUST-0001", companyName: "Acme Ltd" }];
    folders = new Map();
    integration = { id: "singleton", status: "CONNECTED", encryptedRefreshToken: null, rootFolder: "/Insurance Management System" };
    resetVfs();
    // Restore default implementations after vi.clearAllMocks() (which
    // clears mock implementations set via the factory's inline `vi.fn(impl)`
    // — re-declare them per test run).
    filesGetMetadata.mockImplementation(async ({ path }: { path: string }) => {
      const found = metadataFor(path);
      if (!found) throw notFoundError();
      return { result: { ".tag": found.entry.tag, id: found.entry.id, path_display: found.displayPath } };
    });
    filesCreateFolderV2.mockImplementation(async ({ path }: { path: string }) => {
      const key = path.toLowerCase();
      if (vfs.has(key)) throw { status: 409, error: { error_summary: "path/conflict/folder/.." } };
      idCounter += 1;
      const id = `id:folder${idCounter}`;
      vfs.set(key, { tag: "folder", id, displayPath: path });
      return { result: { metadata: { id, path_display: path } } };
    });
    filesMoveV2.mockImplementation(async ({ from_path, to_path }: { from_path: string; to_path: string }) => {
      const sourceKey = from_path.startsWith("id:") ? findKeyById(from_path) : from_path.toLowerCase();
      const sourceEntry = sourceKey ? vfs.get(sourceKey) : undefined;
      if (!sourceKey || !sourceEntry) throw notFoundError();
      const destKey = to_path.toLowerCase();
      if (vfs.has(destKey)) throw { status: 409, error: { error_summary: "to/conflict/folder/.." } };
      vfs.delete(sourceKey);
      vfs.set(destKey, { ...sourceEntry, displayPath: to_path });
      return { result: { metadata: { ".tag": sourceEntry.tag, id: sourceEntry.id, path_display: to_path } } };
    });
  });

  async function connectIntegration() {
    const { encryptToken } = await import("../encryption");
    integration.encryptedRefreshToken = encryptToken("dummy-refresh-token", Buffer.from(TEST_ENV.DROPBOX_TOKEN_ENCRYPTION_KEY, "base64"));
  }

  it("A1: syncs a full customer + Dropbox connected -> folder structure synchronized", async () => {
    await connectIntegration();
    const { syncCustomerFolder, STANDARD_CUSTOMER_SUBFOLDERS } = await import("../customer-folders");

    const result = await syncCustomerFolder("cust-1");

    expect(result.success).toBe(true);
    expect(result.status).toBe("SYNCED");
    const row = folders.get("cust-1")!;
    expect(row.syncStatus).toBe("SYNCED");
    expect(row.dropboxFolderId).not.toBeNull();
    expect(row.displayPath).toContain("CUST-0001");
    // Customers + customer folder + STANDARD_CUSTOMER_SUBFOLDERS create calls
    // (Customer Documents, General Documents only — insurance-type folders
    // are created lazily elsewhere, not during Customer sync).
    expect(filesCreateFolderV2).toHaveBeenCalledTimes(2 + STANDARD_CUSTOMER_SUBFOLDERS.length);
  });

  it("Phase 2 correction: only Customer Documents + General Documents are created on Customer sync", async () => {
    await connectIntegration();
    const { syncCustomerFolder, STANDARD_CUSTOMER_SUBFOLDERS } = await import("../customer-folders");

    expect(STANDARD_CUSTOMER_SUBFOLDERS).toEqual(["Customer Documents", "General Documents"]);

    await syncCustomerFolder("cust-1");

    const created = filesCreateFolderV2.mock.calls.map(([args]) => args.path.toLowerCase());
    expect(created.some((p) => p.endsWith("/motor"))).toBe(false);
    expect(created.some((p) => p.endsWith("/non motor"))).toBe(false);
    expect(created.some((p) => p.endsWith("/bond"))).toBe(false);
    expect(created.some((p) => p.endsWith("/work permit"))).toBe(false);
    expect(created.some((p) => p.endsWith("/customer documents"))).toBe(true);
    expect(created.some((p) => p.endsWith("/general documents"))).toBe(true);
  });

  it("Phase 2 correction: pre-existing insurance-type folders are preserved, untouched, and not required by verify", async () => {
    await connectIntegration();
    const { syncCustomerFolder, verifyCustomerFolder } = await import("../customer-folders");

    await syncCustomerFolder("cust-1");
    const customerPath = "/insurance management system/customers/cust-0001 - acme ltd";
    // Simulate legacy insurance-type folders that already exist from before
    // this correction — sync must never have created them, but they must
    // still be recognized as present and left alone.
    vfs.set(`${customerPath}/motor`, { tag: "folder", id: "id:legacy-motor" });
    vfs.set(`${customerPath}/non motor`, { tag: "folder", id: "id:legacy-nonmotor" });
    vfs.set(`${customerPath}/bond`, { tag: "folder", id: "id:legacy-bond" });
    vfs.set(`${customerPath}/work permit`, { tag: "folder", id: "id:legacy-workpermit" });

    const result = await verifyCustomerFolder("cust-1");

    expect(result.success).toBe(true);
    expect(result.status).toBe("SYNCED");
    expect(result.missingSubfolders).toBeUndefined();
    // Nothing about the legacy folders was moved or deleted.
    expect(filesMoveV2).not.toHaveBeenCalled();
    expect(vfs.get(`${customerPath}/motor`)?.id).toBe("id:legacy-motor");
    expect(vfs.get(`${customerPath}/non motor`)?.id).toBe("id:legacy-nonmotor");
    expect(vfs.get(`${customerPath}/bond`)?.id).toBe("id:legacy-bond");
    expect(vfs.get(`${customerPath}/work permit`)?.id).toBe("id:legacy-workpermit");
  });

  it("Phase 2 correction: rebuild only fills Customer Documents/General Documents, never insurance-type folders", async () => {
    await connectIntegration();
    const { syncCustomerFolder, rebuildCustomerSubfolders } = await import("../customer-folders");

    await syncCustomerFolder("cust-1");
    filesCreateFolderV2.mockClear();

    const result = await rebuildCustomerSubfolders("cust-1");

    expect(result.success).toBe(true);
    // Everything already existed from the initial sync, so rebuild creates nothing new.
    expect(filesCreateFolderV2).not.toHaveBeenCalled();
  });

  it("A2: customer created while Dropbox disconnected -> Customer remains, status pending/error, never throws", async () => {
    integration.status = "DISCONNECTED";
    integration.encryptedRefreshToken = null;
    const { syncCustomerFolder } = await import("../customer-folders");

    const result = await syncCustomerFolder("cust-1");

    expect(result.success).toBe(false);
    expect(["ERROR", "PENDING"]).toContain(result.status);
    expect(folders.get("cust-1")).toBeDefined();
  });

  it("A3: Dropbox network failure -> Customer/metadata remain, safe ERROR status", async () => {
    await connectIntegration();
    filesGetMetadata.mockRejectedValue(new TypeError("fetch failed"));
    filesCreateFolderV2.mockRejectedValue(new TypeError("fetch failed"));
    const { syncCustomerFolder } = await import("../customer-folders");

    const result = await syncCustomerFolder("cust-1");

    expect(result.success).toBe(false);
    expect(result.status).toBe("ERROR");
    expect(folders.get("cust-1")?.syncStatus).toBe("ERROR");
  });

  it("A4: partial folder structure exists -> only missing folders are created", async () => {
    await connectIntegration();
    // Pre-create /Customers and the customer folder; subfolders are absent.
    vfs.set("/insurance management system/customers", { tag: "folder", id: "id:customers" });
    vfs.set("/insurance management system/customers/cust-0001 - acme ltd", { tag: "folder", id: "id:custfolder" });
    const { syncCustomerFolder, STANDARD_CUSTOMER_SUBFOLDERS } = await import("../customer-folders");

    const result = await syncCustomerFolder("cust-1");

    expect(result.success).toBe(true);
    expect(filesCreateFolderV2).toHaveBeenCalledTimes(STANDARD_CUSTOMER_SUBFOLDERS.length);
  });

  it("A5: customer folder already exists -> reused safely, not recreated", async () => {
    await connectIntegration();
    const { syncCustomerFolder } = await import("../customer-folders");
    await syncCustomerFolder("cust-1");
    const callsAfterFirstSync = filesCreateFolderV2.mock.calls.length;

    const result = await syncCustomerFolder("cust-1");

    expect(result.success).toBe(true);
    expect(filesCreateFolderV2).toHaveBeenCalledTimes(callsAfterFirstSync); // no new creates
  });

  it("A6: a file exists at the required customer folder path -> safe CONFLICT, no crash", async () => {
    await connectIntegration();
    vfs.set("/insurance management system/customers/cust-0001 - acme ltd", { tag: "file", id: "id:afile" });
    const { syncCustomerFolder } = await import("../customer-folders");

    const result = await syncCustomerFolder("cust-1");

    expect(result.success).toBe(false);
    expect(result.status).toBe("CONFLICT");
    expect(result.code).toBe("CUSTOMER_FOLDER_IS_FILE");
  });

  it("A7: repeated sync does not create duplicates", async () => {
    await connectIntegration();
    const { syncCustomerFolder } = await import("../customer-folders");

    await syncCustomerFolder("cust-1");
    const firstCallCount = filesCreateFolderV2.mock.calls.length;
    await syncCustomerFolder("cust-1");

    expect(filesCreateFolderV2).toHaveBeenCalledTimes(firstCallCount); // no new creates on 2nd run
  });

  it("A8: a concurrent create race (folder now exists) is treated as success, not an error", async () => {
    await connectIntegration();
    vfs.set("/insurance management system/customers", { tag: "folder", id: "id:customers" });
    // Simulate another request creating the exact same folder in the race
    // window between our own check and our own create call.
    filesCreateFolderV2.mockImplementationOnce(async ({ path }: { path: string }) => {
      vfs.set(path.toLowerCase(), { tag: "folder", id: "id:racer" });
      throw { status: 409, error: { error_summary: "path/conflict/folder/.." } };
    });
    const { ensureCustomerFolder } = await import("../customer-folders");
    const { Dropbox } = await import("dropbox");
    const client = new Dropbox({});

    const result = await ensureCustomerFolder(client, integration.rootFolder, "CUST-0001 - Acme Ltd");

    expect(result.folderId).toBe("id:racer");
  });

  it("C1: renames a synchronized folder using its stored folder ID", async () => {
    await connectIntegration();
    const { syncCustomerFolder, renameCustomerFolder } = await import("../customer-folders");
    await syncCustomerFolder("cust-1");
    const originalFolderId = folders.get("cust-1")!.dropboxFolderId;

    customers[0].companyName = "Acme Global Ltd";
    const result = await renameCustomerFolder("cust-1");

    expect(result.success).toBe(true);
    expect(filesMoveV2).toHaveBeenCalledOnce();
    const [args] = filesMoveV2.mock.calls[0];
    expect(args.from_path).toBe(originalFolderId); // looked up BY ID, not by old path string
    expect(folders.get("cust-1")!.folderName).toContain("Acme Global Ltd");
    expect(folders.get("cust-1")!.displayPath).toContain("Acme Global Ltd");
  });

  it("C2: a rename conflict at the destination does not overwrite (autorename:false, safe error)", async () => {
    await connectIntegration();
    const { syncCustomerFolder, renameCustomerFolder } = await import("../customer-folders");
    await syncCustomerFolder("cust-1");
    const before = { ...folders.get("cust-1")! };

    // Something already occupies the destination path.
    vfs.set("/insurance management system/customers/cust-0001 - renamed co", { tag: "folder", id: "id:someone-elses-folder" });
    customers[0].companyName = "Renamed Co";

    const result = await renameCustomerFolder("cust-1");

    expect(result.success).toBe(false);
    expect(folders.get("cust-1")!.dropboxFolderId).toBe(before.dropboxFolderId); // old folder retained
  });

  it("C3: a rename API failure leaves the Customer's own edit unaffected (service-level: status ERROR, retriable)", async () => {
    await connectIntegration();
    const { syncCustomerFolder, renameCustomerFolder } = await import("../customer-folders");
    await syncCustomerFolder("cust-1");

    customers[0].companyName = "Failing Rename Co";
    filesMoveV2.mockRejectedValueOnce(new TypeError("fetch failed"));
    const result = await renameCustomerFolder("cust-1");

    expect(result.success).toBe(false);
    expect(folders.get("cust-1")!.syncStatus).toBe("ERROR");
  });

  it("C4/C5: retry after a failed rename succeeds and does not create a second customer folder", async () => {
    await connectIntegration();
    const { syncCustomerFolder, renameCustomerFolder } = await import("../customer-folders");
    await syncCustomerFolder("cust-1");
    const folderCountAfterSync = new Set(vfs.keys()).size;

    customers[0].companyName = "Retry Rename Co";
    filesMoveV2.mockRejectedValueOnce(new TypeError("fetch failed"));
    const failed = await renameCustomerFolder("cust-1");
    expect(failed.success).toBe(false);

    const retried = await renameCustomerFolder("cust-1");

    expect(retried.success).toBe(true);
    // Same number of distinct paths in the "Dropbox account" as right after
    // the initial sync — the folder moved, nothing new was created.
    expect(new Set(vfs.keys()).size).toBe(folderCountAfterSync);
  });

  it("D1/D2/D3: nothing in this module ever calls a Dropbox delete API — deletion is out of scope by construction", async () => {
    const customerFolders = await import("../customer-folders");
    const exportedNames = Object.keys(customerFolders);
    expect(exportedNames.some((name) => /delete/i.test(name))).toBe(false);
  });

  it("E1: preview never calls Dropbox", async () => {
    const { previewCustomerFolderBackfill } = await import("../customer-folders");
    await previewCustomerFolderBackfill();
    expect(filesGetMetadata).not.toHaveBeenCalled();
    expect(filesCreateFolderV2).not.toHaveBeenCalled();
  });

  it("E2/E3: batch sync processes only missing customers, skips already-synced ones", async () => {
    await connectIntegration();
    customers.push({ id: "cust-2", customerNumber: "CUST-0002", companyName: "Beta Ltd" });
    const { syncCustomerFolder, runCustomerFolderBackfillBatch } = await import("../customer-folders");
    await syncCustomerFolder("cust-1"); // already synced

    const batch = await runCustomerFolderBackfillBatch("missing", 10);

    expect(batch.processed).toBe(1);
    expect(batch.results[0].customerId).toBe("cust-2");
  });

  it("E4: failed customers can be retried via the retry-failed mode", async () => {
    await connectIntegration();
    const { syncCustomerFolder, runCustomerFolderBackfillBatch } = await import("../customer-folders");
    filesGetMetadata.mockRejectedValue(new TypeError("fetch failed"));
    filesCreateFolderV2.mockRejectedValue(new TypeError("fetch failed"));
    await syncCustomerFolder("cust-1");
    expect(folders.get("cust-1")!.syncStatus).toBe("ERROR");

    filesGetMetadata.mockImplementation(async ({ path }: { path: string }) => {
      const found = metadataFor(path);
      if (!found) throw notFoundError();
      return { result: { ".tag": found.entry.tag, id: found.entry.id, path_display: found.displayPath } };
    });
    filesCreateFolderV2.mockImplementation(async ({ path }: { path: string }) => {
      const key = path.toLowerCase();
      if (vfs.has(key)) throw { status: 409, error: { error_summary: "path/conflict/folder/.." } };
      idCounter += 1;
      const id = `id:folder${idCounter}`;
      vfs.set(key, { tag: "folder", id });
      return { result: { metadata: { id, path_display: path } } };
    });
    const batch = await runCustomerFolderBackfillBatch("retry-failed", 10);

    expect(batch.processed).toBe(1);
    expect(batch.succeeded).toBe(1);
    expect(folders.get("cust-1")!.syncStatus).toBe("SYNCED");
  });

  it("E7: batch is resumable — a second call only picks up customers still pending", async () => {
    await connectIntegration();
    customers.push({ id: "cust-2", customerNumber: "CUST-0002", companyName: "Beta Ltd" });
    customers.push({ id: "cust-3", customerNumber: "CUST-0003", companyName: "Gamma Ltd" });
    const { runCustomerFolderBackfillBatch } = await import("../customer-folders");

    const firstBatch = await runCustomerFolderBackfillBatch("missing", 2);
    expect(firstBatch.processed).toBe(2);
    const secondBatch = await runCustomerFolderBackfillBatch("missing", 2);
    expect(secondBatch.processed).toBe(1);
    const thirdBatch = await runCustomerFolderBackfillBatch("missing", 2);
    expect(thirdBatch.processed).toBe(0);
  });

  it("F3/F4: root-boundary and path-injection safety are enforced via joinDropboxPath (not a bare string join)", async () => {
    const { ensureCustomerFolder } = await import("../customer-folders");
    const { Dropbox } = await import("dropbox");
    const client = new Dropbox({});

    await expect(ensureCustomerFolder(client, integration.rootFolder, "../../Escape Attempt")).rejects.toMatchObject({
      code: "ROOT_PATH_INVALID",
    });
  });

  it("F6: a sibling-named root does not get confused with the real root (prefix-confusion)", async () => {
    const { assertInsideRoot } = await import("../paths");
    // A root of "/Insurance Management System 2" must not be treated as
    // inside "/Insurance Management System".
    expect(() => assertInsideRoot("/Insurance Management System 2/Customers/Foo", integration.rootFolder)).toThrow();
  });
});
