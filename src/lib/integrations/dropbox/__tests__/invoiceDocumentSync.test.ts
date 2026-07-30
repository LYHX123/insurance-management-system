import { describe, it, expect, vi, beforeEach } from "vitest";

// Category C — Invoice generation/sync flow (Phase 6, Part 5/14.C).
// invoiceBusinessFile.ts is mocked here (it has its own dedicated test
// file, invoiceBusinessFile.test.ts) so these tests isolate
// invoiceDocumentSync.ts's own upload/verify/backfill logic — same
// isolation choice this project already makes in customerDocumentSync.test
// .ts (which mocks syncCustomerFolder rather than re-testing it).

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  customerId: string;
  generatedFileName: string | null;
  generatedStoragePath: string | null;
  customer: { dropboxFolder: { syncStatus: string; dropboxFolderId: string | null; displayPath: string | null } | null };
};
type SyncRow = {
  invoiceId: string;
  standardizedFileName: string;
  originalFileName: string;
  businessFileId: string | null;
  businessFileSource: string | null;
  syncStatus: string;
  dropboxFileId: string | null;
  dropboxRevision: string | null;
  dropboxDisplayPath: string | null;
  dropboxPathLower: string | null;
  dropboxContentHash: string | null;
  dropboxSize: bigint | null;
  lastSyncAttemptAt: Date | null;
  lastSyncedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

let invoices: Map<string, InvoiceRow>;
let syncRows: Map<string, SyncRow>;

function defaultSyncRow(data: Partial<SyncRow> & { invoiceId: string; standardizedFileName: string; originalFileName: string }): SyncRow {
  return {
    businessFileId: null,
    businessFileSource: null,
    syncStatus: "PENDING",
    dropboxFileId: null,
    dropboxRevision: null,
    dropboxDisplayPath: null,
    dropboxPathLower: null,
    dropboxContentHash: null,
    dropboxSize: null,
    lastSyncAttemptAt: null,
    lastSyncedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    ...data,
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    invoice: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const inv = invoices.get(where.id);
        if (!inv) return null;
        return { ...inv, dropboxSync: syncRows.get(inv.id) ?? null };
      }),
      count: vi.fn(async () => invoices.size),
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take: number }) => {
        function matchesSyncFilter(id: string, filter: unknown): boolean {
          if (filter === null) return !syncRows.has(id);
          const row = syncRows.get(id);
          if (!row) return false;
          const f = filter as { syncStatus: string | { in: string[] } };
          if (typeof f.syncStatus === "string") return row.syncStatus === f.syncStatus;
          return f.syncStatus.in.includes(row.syncStatus);
        }
        let candidates = Array.from(invoices.values());
        if (Array.isArray(where.OR)) {
          const orConditions = where.OR as { dropboxSync: unknown }[];
          candidates = candidates.filter((inv) => orConditions.some((cond) => matchesSyncFilter(inv.id, cond.dropboxSync)));
        } else if ("dropboxSync" in where) {
          candidates = candidates.filter((inv) => matchesSyncFilter(inv.id, where.dropboxSync));
        }
        if ("generatedStoragePath" in where || "OR" in where) {
          candidates = candidates.filter((inv) => inv.generatedStoragePath !== null && inv.generatedFileName !== null);
        }
        return candidates.slice(0, take).map((inv) => ({ id: inv.id }));
      }),
      groupBy: vi.fn(async () => []),
    },
    invoiceDocumentDropboxSync: {
      create: vi.fn(async ({ data }: { data: Partial<SyncRow> & { invoiceId: string; standardizedFileName: string; originalFileName: string } }) => {
        if (syncRows.has(data.invoiceId)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        const row = defaultSyncRow(data);
        syncRows.set(data.invoiceId, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { invoiceId: string }; data: Partial<SyncRow> }) => {
        const existing = syncRows.get(where.invoiceId);
        if (!existing) throw new Error("Row not found");
        const row = { ...existing, ...data } as SyncRow;
        syncRows.set(where.invoiceId, row);
        return row;
      }),
      groupBy: vi.fn(async () => {
        const counts = new Map<string, number>();
        for (const row of syncRows.values()) counts.set(row.syncStatus, (counts.get(row.syncStatus) ?? 0) + 1);
        return Array.from(counts.entries()).map(([syncStatus, count]) => ({ syncStatus, _count: { _all: count } }));
      }),
      count: vi.fn(async ({ where }: { where: { businessFileSource: string } }) =>
        Array.from(syncRows.values()).filter((r) => r.businessFileSource === where.businessFileSource).length
      ),
    },
    quotationDropboxBusinessFile: { update: vi.fn(async () => ({})) },
    policyDropboxBusinessFile: { update: vi.fn(async () => ({})) },
    invoiceDropboxBusinessFile: { update: vi.fn(async () => ({})) },
  },
}));

const fileExists = vi.fn();
const getMetadata = vi.fn();
const openFile = vi.fn();
vi.mock("@/lib/invoiceDocuments/storage", () => ({
  invoiceDocumentStorage: {
    fileExists: (...args: unknown[]) => fileExists(...args),
    getMetadata: (...args: unknown[]) => getMetadata(...args),
    openFile: (...args: unknown[]) => openFile(...args),
  },
}));

const getAuthenticatedDropboxClient = vi.fn();
vi.mock("@/lib/integrations/dropbox/service", () => ({
  getAuthenticatedDropboxClient: (...args: unknown[]) => getAuthenticatedDropboxClient(...args),
}));

const syncCustomerFolder = vi.fn();
vi.mock("@/lib/integrations/dropbox/customer-folders", () => ({
  syncCustomerFolder: (...args: unknown[]) => syncCustomerFolder(...args),
}));

const ensureBusinessFolder = vi.fn();
vi.mock("@/lib/integrations/dropbox/quotationDropboxSync", () => ({
  ensureBusinessFolder: (...args: unknown[]) => ensureBusinessFolder(...args),
}));

const ensureInvoiceDropboxBusinessFile = vi.fn();
const resolveInvoiceBusinessFileRefReadOnly = vi.fn();
vi.mock("@/lib/integrations/dropbox/invoiceBusinessFile", () => ({
  ensureInvoiceDropboxBusinessFile: (...args: unknown[]) => ensureInvoiceDropboxBusinessFile(...args),
  resolveInvoiceBusinessFileRefReadOnly: (...args: unknown[]) => resolveInvoiceBusinessFileRefReadOnly(...args),
}));

const ROOT = "/Insurance Management System";
const CUSTOMER_FOLDER_PATH = `${ROOT}/Customers/CUST-0001 - Acme Ltd`;
const BUSINESS_FOLDER_PATH = `${CUSTOMER_FOLDER_PATH}/20260730-MOTOR-KDQ175V`;

function connectedAuth() {
  return { ok: true as const, client: fakeClient, env: {}, row: { rootFolder: ROOT } };
}

const filesGetMetadata = vi.fn();
const filesUpload = vi.fn();
const filesCreateFolderV2 = vi.fn();
const fakeClient = { filesGetMetadata, filesUpload, filesCreateFolderV2 } as unknown as import("dropbox").Dropbox;

function notFoundError() {
  return { status: 409, error: { error_summary: "path/not_found/.." } };
}

const REF_QUOTATION_CASE = {
  source: "QUOTATION_CASE" as const,
  businessFileId: "biz-1",
  businessFolderName: "20260730-MOTOR-KDQ175V",
  dropboxDisplayPath: BUSINESS_FOLDER_PATH,
  dropboxFolderId: "id:bizfolder",
  syncStatus: "SYNCED",
  lastErrorMessage: null,
};

describe("syncInvoiceDocumentToDropbox (Phase 6, Category C)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoices = new Map([
      [
        "inv-1",
        {
          id: "inv-1",
          invoiceNumber: "INV202607-0001",
          customerId: "cust-1",
          generatedFileName: "INV202607-0001.xlsx",
          generatedStoragePath: "INV202607-0001/INV202607-0001.xlsx",
          customer: { dropboxFolder: { syncStatus: "SYNCED", dropboxFolderId: "id:customerfolder", displayPath: CUSTOMER_FOLDER_PATH } },
        },
      ],
    ]);
    syncRows = new Map();
    fileExists.mockResolvedValue(true);
    getMetadata.mockResolvedValue({ size: 1234 });
    openFile.mockResolvedValue((async function* () {
      yield Buffer.from("fake xlsx bytes");
    })());
    getAuthenticatedDropboxClient.mockResolvedValue(connectedAuth());
    ensureInvoiceDropboxBusinessFile.mockResolvedValue({ ok: true, ref: REF_QUOTATION_CASE });
    filesGetMetadata.mockRejectedValue(notFoundError());
    filesCreateFolderV2.mockResolvedValue({});
    filesUpload.mockResolvedValue({
      result: {
        id: "id:file1",
        rev: "rev1",
        path_display: `${BUSINESS_FOLDER_PATH}/Invoice/INV202607-0001.xlsx`,
        path_lower: `${BUSINESS_FOLDER_PATH.toLowerCase()}/invoice/inv202607-0001.xlsx`,
        content_hash: "hash1",
        size: 1234,
        name: "INV202607-0001.xlsx",
      },
    });
  });

  it("C1/C5: generation succeeds with Dropbox connected -> SYNCED with metadata stored, business folder reused (never a second folder)", async () => {
    const { syncInvoiceDocumentToDropbox } = await import("../invoiceDocumentSync");

    const result = await syncInvoiceDocumentToDropbox("inv-1");

    expect(result.success).toBe(true);
    expect(result.status).toBe("SYNCED");
    const row = syncRows.get("inv-1")!;
    expect(row.dropboxFileId).toBe("id:file1");
    expect(row.standardizedFileName).toBe("INV202607-0001.xlsx");
    expect(row.businessFileSource).toBe("QUOTATION_CASE");
    expect(filesUpload).toHaveBeenCalledOnce();
    const [uploadArgs] = filesUpload.mock.calls[0];
    expect(uploadArgs.mode).toEqual({ ".tag": "add" });
    expect(uploadArgs.path).toBe(`${BUSINESS_FOLDER_PATH}/Invoice/INV202607-0001.xlsx`);
    // The business folder was already SYNCED (REF_QUOTATION_CASE) — never
    // called ensureBusinessFolder again, i.e. never created a second one.
    expect(ensureBusinessFolder).not.toHaveBeenCalled();
    // Exactly one subfolder created: "Invoice", never "Claim".
    expect(filesCreateFolderV2).toHaveBeenCalledWith({ path: `${BUSINESS_FOLDER_PATH}/Invoice`, autorename: false });
  });

  it("C2: Dropbox disconnected -> local generation/download remains unaffected, safe ERROR, no throw", async () => {
    getAuthenticatedDropboxClient.mockResolvedValue({ ok: false, code: "DROPBOX_NOT_CONNECTED", message: "Not connected.", row: null });
    const { syncInvoiceDocumentToDropbox } = await import("../invoiceDocumentSync");

    const result = await syncInvoiceDocumentToDropbox("inv-1");

    expect(result.success).toBe(false);
    expect(result.code).toBe("DROPBOX_NOT_CONNECTED");
    expect(syncRows.get("inv-1")?.syncStatus).toBe("ERROR");
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("C3: bounded by an internal timeout — syncInvoiceDocumentWithTimeout never hangs and returns a status string", async () => {
    filesUpload.mockImplementation(() => new Promise(() => {})); // never resolves
    const { syncInvoiceDocumentWithTimeout } = await import("../invoiceDocumentSync");

    const status = await syncInvoiceDocumentWithTimeout("inv-1");

    expect(typeof status).toBe("string");
  }, 20000);

  it("C4: a sync row is created (PENDING->SYNCING->SYNCED) after generation — never missing", async () => {
    expect(syncRows.has("inv-1")).toBe(false);
    const { syncInvoiceDocumentToDropbox } = await import("../invoiceDocumentSync");

    await syncInvoiceDocumentToDropbox("inv-1");

    expect(syncRows.has("inv-1")).toBe(true);
    expect(syncRows.get("inv-1")!.syncStatus).toBe("SYNCED");
  });

  it("C6/re-generation idempotency: retry after a prior SYNCED upload safely re-updates the SAME file, never duplicates", async () => {
    const { syncInvoiceDocumentToDropbox } = await import("../invoiceDocumentSync");
    const first = await syncInvoiceDocumentToDropbox("inv-1");
    expect(first.success).toBe(true);

    // Simulate a retry: the "Invoice" subfolder and our own file both
    // already exist. filesGetMetadata is used for both checks, so the fake
    // must distinguish by path rather than always returning the file.
    filesGetMetadata.mockImplementation(async ({ path }: { path: string }) => {
      if (path === `${BUSINESS_FOLDER_PATH}/Invoice`) {
        return { result: { ".tag": "folder", id: "id:invoicefolder" } };
      }
      return { result: { ".tag": "file", id: "id:file1", rev: "rev1", path_display: `${BUSINESS_FOLDER_PATH}/Invoice/INV202607-0001.xlsx` } };
    });
    filesUpload.mockResolvedValue({
      result: {
        id: "id:file1",
        rev: "rev2",
        path_display: `${BUSINESS_FOLDER_PATH}/Invoice/INV202607-0001.xlsx`,
        path_lower: `${BUSINESS_FOLDER_PATH.toLowerCase()}/invoice/inv202607-0001.xlsx`,
        content_hash: "hash2",
        size: 1234,
        name: "INV202607-0001.xlsx",
      },
    });

    const second = await syncInvoiceDocumentToDropbox("inv-1");

    expect(second.success).toBe(true);
    expect(syncRows.size).toBe(1); // still exactly one sync row for this Invoice
    const [, secondUploadArgs] = filesUpload.mock.calls;
    expect(secondUploadArgs[0].mode).toEqual({ ".tag": "update", update: "rev1" }); // safe conditional overwrite of its OWN file, never a blind add
  });

  it("C7 (re-generation is idempotent): a second sync call on already-SYNCED content re-verifies via the same standardized name — never renames", async () => {
    const { syncInvoiceDocumentToDropbox } = await import("../invoiceDocumentSync");
    await syncInvoiceDocumentToDropbox("inv-1");
    const nameAfterFirst = syncRows.get("inv-1")!.standardizedFileName;

    filesGetMetadata.mockResolvedValue({
      result: { ".tag": "file", id: "id:file1", rev: "rev1", path_display: `${BUSINESS_FOLDER_PATH}/Invoice/INV202607-0001.xlsx` },
    });
    await syncInvoiceDocumentToDropbox("inv-1");

    expect(syncRows.get("inv-1")!.standardizedFileName).toBe(nameAfterFirst);
  });

  it("unrelated existing file at the target path -> CONFLICT, never overwritten", async () => {
    filesGetMetadata.mockImplementation(async ({ path }: { path: string }) => {
      if (path === `${BUSINESS_FOLDER_PATH}/Invoice`) {
        throw notFoundError(); // subfolder not created yet -> gets created below
      }
      return { result: { ".tag": "file", id: "id:someone-elses-file", rev: "rev9", path_display: `${BUSINESS_FOLDER_PATH}/Invoice/INV202607-0001.xlsx` } };
    });
    const { syncInvoiceDocumentToDropbox } = await import("../invoiceDocumentSync");

    const result = await syncInvoiceDocumentToDropbox("inv-1");

    expect(result.success).toBe(false);
    expect(result.status).toBe("CONFLICT");
    expect(result.code).toBe("INVOICE_DOCUMENT_CONFLICT");
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("no generated local file yet -> LOCAL_FILE_NOT_FOUND, never calls Dropbox", async () => {
    invoices.set("inv-1", { ...invoices.get("inv-1")!, generatedFileName: null, generatedStoragePath: null });
    const { syncInvoiceDocumentToDropbox } = await import("../invoiceDocumentSync");

    const result = await syncInvoiceDocumentToDropbox("inv-1");

    expect(result.success).toBe(false);
    expect(result.code).toBe("LOCAL_FILE_NOT_FOUND");
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("Invoice not found -> INVOICE_NOT_FOUND, never throws", async () => {
    const { syncInvoiceDocumentToDropbox } = await import("../invoiceDocumentSync");

    const result = await syncInvoiceDocumentToDropbox("does-not-exist");

    expect(result.success).toBe(false);
    expect(result.code).toBe("INVOICE_NOT_FOUND");
  });

  it("stale-but-recent SYNCING is refused rather than double-processed; an old stale SYNCING recovers", async () => {
    syncRows.set("inv-1", defaultSyncRow({ invoiceId: "inv-1", standardizedFileName: "INV202607-0001.xlsx", originalFileName: "INV202607-0001.xlsx", syncStatus: "SYNCING", lastSyncAttemptAt: new Date() }));
    const { syncInvoiceDocumentToDropbox } = await import("../invoiceDocumentSync");

    const recent = await syncInvoiceDocumentToDropbox("inv-1");
    expect(recent.status).toBe("SYNCING");
    expect(filesUpload).not.toHaveBeenCalled();

    syncRows.set("inv-1", { ...syncRows.get("inv-1")!, lastSyncAttemptAt: new Date(Date.now() - 10 * 60 * 1000) });
    const stale = await syncInvoiceDocumentToDropbox("inv-1");
    expect(stale.success).toBe(true);
  });

  it("C8: no Prisma transaction spans the Dropbox network call — invoiceDocumentDropboxSync.update is the only prisma call, never $transaction", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const source = readFileSync(join(__dirname, "..", "invoiceDocumentSync.ts"), "utf8");
    expect(source).not.toMatch(/\$transaction/);
  });

  it("never calls a Dropbox delete API, and never creates a Claim folder", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const source = readFileSync(join(__dirname, "..", "invoiceDocumentSync.ts"), "utf8");
    expect(source).not.toMatch(/filesDeleteV2|filesPermanentlyDelete/);
    // Matches phase5Regression.test.ts's convention: check for the literal
    // quoted folder-name string a real implementation would use, not the
    // bare word (which also appears in comments explaining what is NOT
    // created).
    expect(source).not.toMatch(/"Claim"/);
  });
});

describe("verifyInvoiceDocumentSync — read-only (Phase 6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoices = new Map([
      [
        "inv-1",
        {
          id: "inv-1",
          invoiceNumber: "INV202607-0001",
          customerId: "cust-1",
          generatedFileName: "INV202607-0001.xlsx",
          generatedStoragePath: "INV202607-0001/INV202607-0001.xlsx",
          customer: { dropboxFolder: { syncStatus: "SYNCED", dropboxFolderId: "id:customerfolder", displayPath: CUSTOMER_FOLDER_PATH } },
        },
      ],
    ]);
    syncRows = new Map([
      [
        "inv-1",
        defaultSyncRow({
          invoiceId: "inv-1",
          standardizedFileName: "INV202607-0001.xlsx",
          originalFileName: "INV202607-0001.xlsx",
          syncStatus: "SYNCED",
          dropboxFileId: "id:file1",
          dropboxSize: BigInt(1234),
          dropboxContentHash: "hash1",
        }),
      ],
    ]);
    getAuthenticatedDropboxClient.mockResolvedValue(connectedAuth());
  });

  it("file exists and matches -> SYNCED, never calls filesUpload", async () => {
    filesGetMetadata.mockResolvedValue({
      result: {
        ".tag": "file",
        id: "id:file1",
        rev: "rev1",
        name: "INV202607-0001.xlsx",
        path_display: `${BUSINESS_FOLDER_PATH}/Invoice/INV202607-0001.xlsx`,
        path_lower: `${BUSINESS_FOLDER_PATH.toLowerCase()}/invoice/inv202607-0001.xlsx`,
        size: 1234,
        content_hash: "hash1",
      },
    });
    const { verifyInvoiceDocumentSync } = await import("../invoiceDocumentSync");

    const result = await verifyInvoiceDocumentSync("inv-1");

    expect(result.success).toBe(true);
    expect(result.status).toBe("SYNCED");
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("linked file missing -> DROPBOX_FILE_NOT_FOUND, allows re-upload", async () => {
    filesGetMetadata.mockRejectedValue(notFoundError());
    const { verifyInvoiceDocumentSync } = await import("../invoiceDocumentSync");

    const result = await verifyInvoiceDocumentSync("inv-1");

    expect(result.success).toBe(false);
    expect(result.code).toBe("DROPBOX_FILE_NOT_FOUND");
  });

  it("never synced yet -> PENDING, no Dropbox call", async () => {
    syncRows.set("inv-1", defaultSyncRow({ invoiceId: "inv-1", standardizedFileName: "", originalFileName: "x", dropboxFileId: null }));
    const { verifyInvoiceDocumentSync } = await import("../invoiceDocumentSync");

    const result = await verifyInvoiceDocumentSync("inv-1");

    expect(result.status).toBe("PENDING");
    expect(filesGetMetadata).not.toHaveBeenCalled();
  });
});

describe("Invoice document backfill (Phase 6, Category E)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invoices = new Map([
      ["inv-1", { id: "inv-1", invoiceNumber: "INV1", customerId: "cust-1", generatedFileName: "INV1.xlsx", generatedStoragePath: "INV1/INV1.xlsx", customer: { dropboxFolder: { syncStatus: "SYNCED", dropboxFolderId: "id:cf", displayPath: CUSTOMER_FOLDER_PATH } } }],
      ["inv-2", { id: "inv-2", invoiceNumber: "INV2", customerId: "cust-1", generatedFileName: "INV2.xlsx", generatedStoragePath: "INV2/INV2.xlsx", customer: { dropboxFolder: { syncStatus: "SYNCED", dropboxFolderId: "id:cf", displayPath: CUSTOMER_FOLDER_PATH } } }],
      ["inv-3", { id: "inv-3", invoiceNumber: "INV3", customerId: "cust-1", generatedFileName: "INV3.xlsx", generatedStoragePath: "INV3/INV3.xlsx", customer: { dropboxFolder: { syncStatus: "SYNCED", dropboxFolderId: "id:cf", displayPath: CUSTOMER_FOLDER_PATH } } }],
    ]);
    syncRows = new Map([["inv-2", defaultSyncRow({ invoiceId: "inv-2", standardizedFileName: "INV2.xlsx", originalFileName: "INV2.xlsx", syncStatus: "SYNCED", dropboxFileId: "id:f2" })]]);
    fileExists.mockResolvedValue(true);
    getMetadata.mockResolvedValue({ size: 100 });
    openFile.mockResolvedValue((async function* () { yield Buffer.from("x"); })());
    getAuthenticatedDropboxClient.mockResolvedValue(connectedAuth());
    ensureInvoiceDropboxBusinessFile.mockResolvedValue({ ok: true, ref: REF_QUOTATION_CASE });
    filesGetMetadata.mockRejectedValue(notFoundError());
    filesCreateFolderV2.mockResolvedValue({});
    filesUpload.mockResolvedValue({ result: { id: "id:new", rev: "r1", path_display: `${BUSINESS_FOLDER_PATH}/Invoice/x.xlsx`, path_lower: "x", content_hash: "h", size: 100, name: "x.xlsx" } });
  });

  it("E1: preview never writes and never touches Dropbox", async () => {
    const { previewInvoiceDocumentBackfill } = await import("../invoiceDocumentSync");

    const preview = await previewInvoiceDocumentBackfill();

    expect(preview.totalInvoices).toBe(3);
    expect(preview.synced).toBe(1);
    expect(filesGetMetadata).not.toHaveBeenCalled();
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("E2/E3: batch processes sequentially and skips the already-synced invoice", async () => {
    const uploadOrder: string[] = [];
    filesUpload.mockImplementation(async ({ path }: { path: string }) => {
      uploadOrder.push(path);
      return { result: { id: `id:${path}`, rev: "r", path_display: path, path_lower: path.toLowerCase(), content_hash: "h", size: 1, name: path } };
    });
    const { runInvoiceDocumentBackfillBatch } = await import("../invoiceDocumentSync");

    const batch = await runInvoiceDocumentBackfillBatch("sync-missing", 10);

    expect(batch.processed).toBe(2); // inv-1, inv-3 — inv-2 already SYNCED
    expect(uploadOrder.length).toBe(2);
    expect(syncRows.get("inv-2")!.syncStatus).toBe("SYNCED"); // untouched
  });

  it("E5: already-synced invoices are skipped in sync-missing/init-missing mode", async () => {
    const { runInvoiceDocumentBackfillBatch } = await import("../invoiceDocumentSync");

    const batch = await runInvoiceDocumentBackfillBatch("init-missing", 10);

    expect(batch.results.map((r) => r.invoiceId)).not.toContain("inv-2");
  });

  it("E6: failed invoices retry safely via retry-failed mode", async () => {
    syncRows.set("inv-1", defaultSyncRow({ invoiceId: "inv-1", standardizedFileName: "INV1.xlsx", originalFileName: "INV1.xlsx", syncStatus: "ERROR" }));
    const { runInvoiceDocumentBackfillBatch } = await import("../invoiceDocumentSync");

    const batch = await runInvoiceDocumentBackfillBatch("retry-failed", 10);

    expect(batch.processed).toBe(1);
    expect(batch.results[0].invoiceId).toBe("inv-1");
  });

  it("E7: an Invoice with no local artifact yet is never picked up by init/sync-missing (reported safely, not attempted)", async () => {
    invoices.set("inv-4", { id: "inv-4", invoiceNumber: "INV4", customerId: "cust-1", generatedFileName: null, generatedStoragePath: null, customer: { dropboxFolder: null } });
    const { runInvoiceDocumentBackfillBatch } = await import("../invoiceDocumentSync");

    const batch = await runInvoiceDocumentBackfillBatch("sync-missing", 10);

    expect(batch.results.map((r) => r.invoiceId)).not.toContain("inv-4");
  });

  it("E2 (batch size bounded): a limit above MAX_BATCH_SIZE is clamped to 20", async () => {
    for (let i = 4; i <= 30; i++) {
      invoices.set(`inv-${i}`, { id: `inv-${i}`, invoiceNumber: `INV${i}`, customerId: "cust-1", generatedFileName: `INV${i}.xlsx`, generatedStoragePath: `INV${i}/INV${i}.xlsx`, customer: { dropboxFolder: { syncStatus: "SYNCED", dropboxFolderId: "id:cf", displayPath: CUSTOMER_FOLDER_PATH } } });
    }
    const { runInvoiceDocumentBackfillBatch } = await import("../invoiceDocumentSync");

    const batch = await runInvoiceDocumentBackfillBatch("sync-missing", 1000);

    expect(batch.processed).toBeLessThanOrEqual(20);
  });

  it("E4 (resumable): a second call only picks up invoices still pending", async () => {
    const { runInvoiceDocumentBackfillBatch } = await import("../invoiceDocumentSync");

    const first = await runInvoiceDocumentBackfillBatch("sync-missing", 1);
    expect(first.processed).toBe(1);
    const second = await runInvoiceDocumentBackfillBatch("sync-missing", 10);
    expect(second.processed).toBe(1);
    const third = await runInvoiceDocumentBackfillBatch("sync-missing", 10);
    expect(third.processed).toBe(0);
  });

  it("E9: never calls a Dropbox delete API and never invents a historical version", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const source = readFileSync(join(__dirname, "..", "invoiceDocumentSync.ts"), "utf8");
    expect(source).not.toMatch(/filesDeleteV2|filesPermanentlyDelete/);
    expect(source).not.toMatch(/versionNumber|revisionNumber/);
  });
});
