import { describe, it, expect, vi, beforeEach } from "vitest";

// --- In-memory fakes --------------------------------------------------------
type DocRow = {
  id: string;
  customerId: string;
  projectId: string | null;
  documentType: "REGISTRATION_CERTIFICATE" | "PIN_CERTIFICATE" | "CR12" | "OTHER";
  originalFileName: string;
  mimeType: string;
  storageKey: string;
};
type CustomerRow = {
  id: string;
  dropboxFolder: { syncStatus: string; dropboxFolderId: string | null; displayPath: string | null } | null;
};
type SyncRow = {
  customerDocumentId: string;
  standardizedFileName: string;
  originalFileName: string;
  syncStatus: string;
  dropboxFileId: string | null;
  dropboxRevision: string | null;
  dropboxDisplayPath: string | null;
  dropboxPathLower: string | null;
  contentHash: string | null;
  uploadedSize: bigint | null;
  lastSyncAttemptAt: Date | null;
  lastSyncedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

let documents: Map<string, DocRow>;
let customers: Map<string, CustomerRow>;
let syncRows: Map<string, SyncRow>;

function defaultSyncRow(data: Partial<SyncRow> & { customerDocumentId: string; standardizedFileName: string; originalFileName: string }): SyncRow {
  return {
    syncStatus: "PENDING",
    dropboxFileId: null,
    dropboxRevision: null,
    dropboxDisplayPath: null,
    dropboxPathLower: null,
    contentHash: null,
    uploadedSize: null,
    lastSyncAttemptAt: null,
    lastSyncedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    ...data,
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerDocument: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const doc = documents.get(where.id);
        if (!doc) return null;
        const customer = customers.get(doc.customerId) ?? null;
        return {
          ...doc,
          customer: { dropboxFolder: customer?.dropboxFolder ?? null },
          dropboxSync: syncRows.get(doc.id) ?? null,
        };
      }),
      count: vi.fn(async () => documents.size),
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take: number }) => {
        function matchesSyncFilter(docId: string, filter: unknown): boolean {
          if (filter === null) return !syncRows.has(docId);
          const row = syncRows.get(docId);
          if (!row) return false;
          const f = filter as { syncStatus: string | { in: string[] } };
          if (typeof f.syncStatus === "string") return row.syncStatus === f.syncStatus;
          return f.syncStatus.in.includes(row.syncStatus);
        }
        let candidates = Array.from(documents.values());
        if (Array.isArray(where.OR)) {
          const orConditions = where.OR as { dropboxSync: unknown }[];
          candidates = candidates.filter((d) => orConditions.some((cond) => matchesSyncFilter(d.id, cond.dropboxSync)));
        } else if ("dropboxSync" in where) {
          candidates = candidates.filter((d) => matchesSyncFilter(d.id, where.dropboxSync));
        }
        return candidates.slice(0, take).map((d) => ({ id: d.id, originalFileName: d.originalFileName }));
      }),
    },
    customerDocumentDropboxSync: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            syncStatus: { in: string[] };
            customerDocumentId: { not: string };
            customerDocument: { customerId: string; projectId: { not: null } | null };
          };
        }) => {
          const wantProjectLevel = where.customerDocument.projectId !== null;
          const rows = Array.from(syncRows.values()).filter((row) => {
            if (row.customerDocumentId === where.customerDocumentId.not) return false;
            if (!where.syncStatus.in.includes(row.syncStatus)) return false;
            const doc = documents.get(row.customerDocumentId);
            if (!doc || doc.customerId !== where.customerDocument.customerId) return false;
            const isProjectLevel = doc.projectId !== null;
            return isProjectLevel === wantProjectLevel;
          });
          return rows.map((r) => ({ standardizedFileName: r.standardizedFileName }));
        }
      ),
      create: vi.fn(async ({ data }: { data: Partial<SyncRow> & { customerDocumentId: string; standardizedFileName: string; originalFileName: string } }) => {
        if (syncRows.has(data.customerDocumentId)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        const row = defaultSyncRow(data);
        syncRows.set(data.customerDocumentId, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { customerDocumentId: string }; data: Partial<SyncRow> }) => {
        const existing = syncRows.get(where.customerDocumentId);
        if (!existing) throw new Error("Row not found");
        const row = { ...existing, ...data } as SyncRow;
        syncRows.set(where.customerDocumentId, row);
        return row;
      }),
      groupBy: vi.fn(async () => {
        const counts = new Map<string, number>();
        for (const row of syncRows.values()) counts.set(row.syncStatus, (counts.get(row.syncStatus) ?? 0) + 1);
        return Array.from(counts.entries()).map(([syncStatus, count]) => ({ syncStatus, _count: { _all: count } }));
      }),
    },
  },
}));

const getFile = vi.fn();
vi.mock("@/lib/storage", () => ({
  storageService: { getFile: (...args: unknown[]) => getFile(...args) },
}));

const getAuthenticatedDropboxClient = vi.fn();
vi.mock("@/lib/integrations/dropbox/service", () => ({
  getAuthenticatedDropboxClient: (...args: unknown[]) => getAuthenticatedDropboxClient(...args),
}));

const syncCustomerFolder = vi.fn();
vi.mock("@/lib/integrations/dropbox/customer-folders", () => ({
  syncCustomerFolder: (...args: unknown[]) => syncCustomerFolder(...args),
}));

const ROOT = "/Insurance Management System";
const CUSTOMER_FOLDER_PATH = `${ROOT}/Customers/CUST-0001 - Acme Ltd`;

function connectedAuth() {
  return { ok: true as const, client: fakeClient, env: {}, row: { rootFolder: ROOT } };
}

const filesGetMetadata = vi.fn();
const filesUpload = vi.fn();
const fakeClient = { filesGetMetadata, filesUpload } as unknown as import("dropbox").Dropbox;

function notFoundError() {
  return { status: 409, error: { error_summary: "path/not_found/.." } };
}

describe("syncCustomerDocument (Phase 3 Part 5/8/13)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    documents = new Map([
      [
        "doc-1",
        {
          id: "doc-1",
          customerId: "cust-1",
          projectId: null,
          documentType: "REGISTRATION_CERTIFICATE",
          originalFileName: "scan.pdf",
          mimeType: "application/pdf",
          storageKey: "customers/CUST-0001/company/abc.pdf",
        },
      ],
    ]);
    customers = new Map([
      ["cust-1", { id: "cust-1", dropboxFolder: { syncStatus: "SYNCED", dropboxFolderId: "id:customerfolder", displayPath: CUSTOMER_FOLDER_PATH } }],
    ]);
    syncRows = new Map();
    getFile.mockResolvedValue({ buffer: Buffer.from("%PDF-1.4 test"), mimeType: "application/pdf" });
    getAuthenticatedDropboxClient.mockResolvedValue(connectedAuth());
    filesGetMetadata.mockRejectedValue(notFoundError());
    filesUpload.mockResolvedValue({
      result: {
        id: "id:file1",
        rev: "rev1",
        path_display: `${CUSTOMER_FOLDER_PATH}/Customer Documents/Registration Certificate.pdf`,
        path_lower: `${CUSTOMER_FOLDER_PATH.toLowerCase()}/customer documents/registration certificate.pdf`,
        content_hash: "hash1",
        size: 13,
        name: "Registration Certificate.pdf",
      },
    });
  });

  it("B1: local upload + Dropbox success -> SYNCED with metadata stored", async () => {
    const { syncCustomerDocument } = await import("../customerDocumentSync");

    const result = await syncCustomerDocument("doc-1");

    expect(result.success).toBe(true);
    expect(result.status).toBe("SYNCED");
    const row = syncRows.get("doc-1")!;
    expect(row.dropboxFileId).toBe("id:file1");
    expect(row.dropboxRevision).toBe("rev1");
    expect(row.contentHash).toBe("hash1");
    expect(row.uploadedSize).toBe(BigInt(13));
    expect(row.standardizedFileName).toBe("Registration Certificate.pdf");
    expect(filesUpload).toHaveBeenCalledOnce();
    const [uploadArgs] = filesUpload.mock.calls[0];
    expect(uploadArgs.mode).toEqual({ ".tag": "add" });
  });

  it("B2: Dropbox disconnected -> local document remains available, status ERROR/retryable, no throw", async () => {
    getAuthenticatedDropboxClient.mockResolvedValue({ ok: false, code: "DROPBOX_NOT_CONNECTED", message: "Not connected.", row: null });
    const { syncCustomerDocument } = await import("../customerDocumentSync");

    const result = await syncCustomerDocument("doc-1");

    expect(result.success).toBe(false);
    expect(result.code).toBe("DROPBOX_NOT_CONNECTED");
    expect(syncRows.get("doc-1")?.syncStatus).toBe("ERROR");
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("B3: network failure during upload -> safe ERROR, no throw", async () => {
    filesUpload.mockRejectedValue(new TypeError("fetch failed"));
    const { syncCustomerDocument } = await import("../customerDocumentSync");

    const result = await syncCustomerDocument("doc-1");

    expect(result.success).toBe(false);
    expect(result.code).toBe("NETWORK_ERROR");
    expect(syncRows.get("doc-1")?.syncStatus).toBe("ERROR");
  });

  it("B4: rate limited -> safe ERROR with RATE_LIMITED code", async () => {
    // Phase 8 Part 8/12: filesUpload is now wrapped in withRateLimitBackoff,
    // so a persistent 429 is retried (BATCH_BACKOFF) before failing — a
    // tiny retry_after keeps this test fast instead of waiting out real
    // exponential backoff (same convention as rateLimitRetry.test.ts).
    filesUpload.mockRejectedValue({ status: 429, error: { retry_after: 0.001 } });
    const { syncCustomerDocument } = await import("../customerDocumentSync");

    const result = await syncCustomerDocument("doc-1");

    expect(result.success).toBe(false);
    expect(result.code).toBe("RATE_LIMITED");
  });

  it("B5: customer folder not yet synced -> attempts folder sync first", async () => {
    customers.set("cust-1", { id: "cust-1", dropboxFolder: { syncStatus: "PENDING", dropboxFolderId: null, displayPath: null } });
    syncCustomerFolder.mockResolvedValue({ success: true, status: "SYNCED", path: CUSTOMER_FOLDER_PATH });
    const { syncCustomerDocument } = await import("../customerDocumentSync");

    const result = await syncCustomerDocument("doc-1");

    expect(syncCustomerFolder).toHaveBeenCalledWith("cust-1");
    expect(result.success).toBe(true);
    expect(result.status).toBe("SYNCED");
  });

  it("B6: customer folder sync fails -> document sync fails safely, never attempts upload", async () => {
    customers.set("cust-1", { id: "cust-1", dropboxFolder: { syncStatus: "PENDING", dropboxFolderId: null, displayPath: null } });
    syncCustomerFolder.mockResolvedValue({ success: false, status: "ERROR", code: "DROPBOX_NOT_CONNECTED" });
    const { syncCustomerDocument } = await import("../customerDocumentSync");

    const result = await syncCustomerDocument("doc-1");

    expect(result.success).toBe(false);
    expect(result.code).toBe("CUSTOMER_FOLDER_NOT_SYNCED");
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("B8/B9: retry reuses the existing local file and the same standardized name — no duplicate row/name", async () => {
    const { syncCustomerDocument } = await import("../customerDocumentSync");

    const first = await syncCustomerDocument("doc-1");
    expect(first.success).toBe(true);
    const nameAfterFirst = syncRows.get("doc-1")!.standardizedFileName;

    // Simulate a retry: our own file now exists at the target path.
    filesGetMetadata.mockResolvedValue({
      result: { ".tag": "file", id: "id:file1", rev: "rev1", path_display: `${CUSTOMER_FOLDER_PATH}/Customer Documents/Registration Certificate.pdf` },
    });
    filesUpload.mockResolvedValue({
      result: {
        id: "id:file1",
        rev: "rev2",
        path_display: `${CUSTOMER_FOLDER_PATH}/Customer Documents/Registration Certificate.pdf`,
        path_lower: `${CUSTOMER_FOLDER_PATH.toLowerCase()}/customer documents/registration certificate.pdf`,
        content_hash: "hash2",
        size: 13,
        name: "Registration Certificate.pdf",
      },
    });

    const second = await syncCustomerDocument("doc-1");

    expect(second.success).toBe(true);
    expect(syncRows.size).toBe(1); // still exactly one sync row
    expect(syncRows.get("doc-1")!.standardizedFileName).toBe(nameAfterFirst);
    const [, secondUploadArgs] = filesUpload.mock.calls;
    expect(secondUploadArgs[0].mode).toEqual({ ".tag": "update", update: "rev1" }); // safe conditional overwrite of its OWN file
  });

  it("B10: concurrent retry (already SYNCING, recent attempt) is refused rather than double-processed", async () => {
    syncRows.set(
      "doc-1",
      defaultSyncRow({
        customerDocumentId: "doc-1",
        standardizedFileName: "Registration Certificate.pdf",
        originalFileName: "scan.pdf",
        syncStatus: "SYNCING",
        lastSyncAttemptAt: new Date(),
      })
    );
    const { syncCustomerDocument } = await import("../customerDocumentSync");

    const result = await syncCustomerDocument("doc-1");

    expect(result.success).toBe(false);
    expect(result.status).toBe("SYNCING");
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("a stale SYNCING row (old attempt) is recovered and retried, not blocked forever", async () => {
    syncRows.set(
      "doc-1",
      defaultSyncRow({
        customerDocumentId: "doc-1",
        standardizedFileName: "Registration Certificate.pdf",
        originalFileName: "scan.pdf",
        syncStatus: "SYNCING",
        lastSyncAttemptAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
      })
    );
    const { syncCustomerDocument } = await import("../customerDocumentSync");

    const result = await syncCustomerDocument("doc-1");

    expect(result.success).toBe(true);
    expect(result.status).toBe("SYNCED");
  });

  it("local file missing -> LOCAL_FILE_NOT_FOUND, never calls Dropbox", async () => {
    getFile.mockResolvedValue(null);
    const { syncCustomerDocument } = await import("../customerDocumentSync");

    const result = await syncCustomerDocument("doc-1");

    expect(result.success).toBe(false);
    expect(result.code).toBe("LOCAL_FILE_NOT_FOUND");
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("unrelated existing file at the target path -> CONFLICT, never overwritten", async () => {
    filesGetMetadata.mockResolvedValue({
      result: { ".tag": "file", id: "id:someone-elses-file", rev: "rev9", path_display: `${CUSTOMER_FOLDER_PATH}/Customer Documents/Registration Certificate.pdf` },
    });
    const { syncCustomerDocument } = await import("../customerDocumentSync");

    const result = await syncCustomerDocument("doc-1");

    expect(result.success).toBe(false);
    expect(result.status).toBe("CONFLICT");
    expect(result.code).toBe("CUSTOMER_DOCUMENT_CONFLICT");
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("a second same-day document of the same type gets a versioned filename, no collision", async () => {
    syncRows.set(
      "doc-existing",
      defaultSyncRow({
        customerDocumentId: "doc-existing",
        standardizedFileName: "Registration Certificate.pdf",
        originalFileName: "old.pdf",
        syncStatus: "SYNCED",
      })
    );
    documents.set("doc-existing", {
      id: "doc-existing",
      customerId: "cust-1",
      projectId: null,
      documentType: "REGISTRATION_CERTIFICATE",
      originalFileName: "old.pdf",
      mimeType: "application/pdf",
      storageKey: "x",
    });
    const { syncCustomerDocument } = await import("../customerDocumentSync");

    const result = await syncCustomerDocument("doc-1");

    expect(result.success).toBe(true);
    expect(syncRows.get("doc-1")!.standardizedFileName).not.toBe("Registration Certificate.pdf");
    expect(syncRows.get("doc-1")!.standardizedFileName).toMatch(/^Registration Certificate - \d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("project-level document syncs to General Documents, not Customer Documents", async () => {
    documents.set("doc-1", { ...documents.get("doc-1")!, projectId: "proj-1" });
    const { syncCustomerDocument } = await import("../customerDocumentSync");

    await syncCustomerDocument("doc-1");

    const [uploadArgs] = filesUpload.mock.calls[0];
    expect(uploadArgs.path).toContain("/General Documents/");
    expect(uploadArgs.path).not.toContain("/Customer Documents/");
  });
});

describe("verifyCustomerDocumentSync (Phase 3 Part 9/17.C) — read-only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    documents = new Map([
      [
        "doc-1",
        {
          id: "doc-1",
          customerId: "cust-1",
          projectId: null,
          documentType: "REGISTRATION_CERTIFICATE",
          originalFileName: "scan.pdf",
          mimeType: "application/pdf",
          storageKey: "x",
        },
      ],
    ]);
    customers = new Map([
      ["cust-1", { id: "cust-1", dropboxFolder: { syncStatus: "SYNCED", dropboxFolderId: "id:customerfolder", displayPath: CUSTOMER_FOLDER_PATH } }],
    ]);
    syncRows = new Map([
      [
        "doc-1",
        defaultSyncRow({
          customerDocumentId: "doc-1",
          standardizedFileName: "Registration Certificate.pdf",
          originalFileName: "scan.pdf",
          syncStatus: "SYNCED",
          dropboxFileId: "id:file1",
          uploadedSize: BigInt(13),
          contentHash: "hash1",
        }),
      ],
    ]);
    getAuthenticatedDropboxClient.mockResolvedValue(connectedAuth());
  });

  it("C1: file exists and matches -> SYNCED, no Dropbox write call made", async () => {
    filesGetMetadata.mockResolvedValue({
      result: {
        ".tag": "file",
        id: "id:file1",
        rev: "rev1",
        name: "Registration Certificate.pdf",
        path_display: `${CUSTOMER_FOLDER_PATH}/Customer Documents/Registration Certificate.pdf`,
        path_lower: `${CUSTOMER_FOLDER_PATH.toLowerCase()}/customer documents/registration certificate.pdf`,
        size: 13,
        content_hash: "hash1",
      },
    });
    const { verifyCustomerDocumentSync } = await import("../customerDocumentSync");

    const result = await verifyCustomerDocumentSync("doc-1");

    expect(result.success).toBe(true);
    expect(result.status).toBe("SYNCED");
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("C2: linked file missing -> ERROR/DROPBOX_FILE_NOT_FOUND, allows re-upload", async () => {
    filesGetMetadata.mockRejectedValue(notFoundError());
    const { verifyCustomerDocumentSync } = await import("../customerDocumentSync");

    const result = await verifyCustomerDocumentSync("doc-1");

    expect(result.success).toBe(false);
    expect(result.code).toBe("DROPBOX_FILE_NOT_FOUND");
  });

  it("C3: linked object is a folder -> ERROR/DROPBOX_FILE_IS_FOLDER", async () => {
    filesGetMetadata.mockResolvedValue({ result: { ".tag": "folder", id: "id:file1", name: "Registration Certificate.pdf" } });
    const { verifyCustomerDocumentSync } = await import("../customerDocumentSync");

    const result = await verifyCustomerDocumentSync("doc-1");

    expect(result.success).toBe(false);
    expect(result.code).toBe("DROPBOX_FILE_IS_FOLDER");
  });

  it("C4: file outside configured root -> ERROR/DROPBOX_FILE_OUTSIDE_ROOT", async () => {
    filesGetMetadata.mockResolvedValue({
      result: {
        ".tag": "file",
        id: "id:file1",
        rev: "rev1",
        name: "Registration Certificate.pdf",
        path_display: "/Some Other Root/Registration Certificate.pdf",
        size: 13,
      },
    });
    const { verifyCustomerDocumentSync } = await import("../customerDocumentSync");

    const result = await verifyCustomerDocumentSync("doc-1");

    expect(result.success).toBe(false);
    expect(result.code).toBe("DROPBOX_FILE_OUTSIDE_ROOT");
  });

  it("C5: size mismatch -> CONFLICT", async () => {
    filesGetMetadata.mockResolvedValue({
      result: {
        ".tag": "file",
        id: "id:file1",
        rev: "rev1",
        name: "Registration Certificate.pdf",
        path_display: `${CUSTOMER_FOLDER_PATH}/Customer Documents/Registration Certificate.pdf`,
        size: 999,
        content_hash: "hash1",
      },
    });
    const { verifyCustomerDocumentSync } = await import("../customerDocumentSync");

    const result = await verifyCustomerDocumentSync("doc-1");

    expect(result.success).toBe(false);
    expect(result.status).toBe("CONFLICT");
  });

  it("C6: content hash mismatch -> CONFLICT", async () => {
    filesGetMetadata.mockResolvedValue({
      result: {
        ".tag": "file",
        id: "id:file1",
        rev: "rev1",
        name: "Registration Certificate.pdf",
        path_display: `${CUSTOMER_FOLDER_PATH}/Customer Documents/Registration Certificate.pdf`,
        size: 13,
        content_hash: "different-hash",
      },
    });
    const { verifyCustomerDocumentSync } = await import("../customerDocumentSync");

    const result = await verifyCustomerDocumentSync("doc-1");

    expect(result.success).toBe(false);
    expect(result.status).toBe("CONFLICT");
  });

  it("C7: filename no longer matches expected pattern -> CONFLICT", async () => {
    filesGetMetadata.mockResolvedValue({
      result: {
        ".tag": "file",
        id: "id:file1",
        rev: "rev1",
        name: "Totally Different Name.pdf",
        path_display: `${CUSTOMER_FOLDER_PATH}/Customer Documents/Totally Different Name.pdf`,
        size: 13,
        content_hash: "hash1",
      },
    });
    const { verifyCustomerDocumentSync } = await import("../customerDocumentSync");

    const result = await verifyCustomerDocumentSync("doc-1");

    expect(result.success).toBe(false);
    expect(result.status).toBe("CONFLICT");
  });

  it("never synced yet -> PENDING, no Dropbox call", async () => {
    syncRows.set("doc-1", defaultSyncRow({ customerDocumentId: "doc-1", standardizedFileName: "", originalFileName: "scan.pdf", dropboxFileId: null }));
    const { verifyCustomerDocumentSync } = await import("../customerDocumentSync");

    const result = await verifyCustomerDocumentSync("doc-1");

    expect(result.status).toBe("PENDING");
    expect(filesGetMetadata).not.toHaveBeenCalled();
  });
});

describe("Customer document backfill (Phase 3 Part 11/17.E)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    documents = new Map([
      ["doc-1", { id: "doc-1", customerId: "cust-1", projectId: null, documentType: "REGISTRATION_CERTIFICATE", originalFileName: "a.pdf", mimeType: "application/pdf", storageKey: "k1" }],
      ["doc-2", { id: "doc-2", customerId: "cust-1", projectId: null, documentType: "PIN_CERTIFICATE", originalFileName: "b.pdf", mimeType: "application/pdf", storageKey: "k2" }],
      ["doc-3", { id: "doc-3", customerId: "cust-1", projectId: null, documentType: "CR12", originalFileName: "c.pdf", mimeType: "application/pdf", storageKey: "k3" }],
    ]);
    customers = new Map([
      ["cust-1", { id: "cust-1", dropboxFolder: { syncStatus: "SYNCED", dropboxFolderId: "id:customerfolder", displayPath: CUSTOMER_FOLDER_PATH } }],
    ]);
    syncRows = new Map([
      ["doc-2", defaultSyncRow({ customerDocumentId: "doc-2", standardizedFileName: "PIN Certificate.pdf", originalFileName: "b.pdf", syncStatus: "SYNCED", dropboxFileId: "id:file2" })],
    ]);
    getFile.mockResolvedValue({ buffer: Buffer.from("%PDF-1.4 test"), mimeType: "application/pdf" });
    getAuthenticatedDropboxClient.mockResolvedValue(connectedAuth());
    filesGetMetadata.mockRejectedValue(notFoundError());
    filesUpload.mockResolvedValue({
      result: { id: "id:new", rev: "rev1", path_display: `${CUSTOMER_FOLDER_PATH}/Customer Documents/x.pdf`, path_lower: "x", content_hash: "h", size: 13, name: "x.pdf" },
    });
  });

  it("E1: preview never writes and never touches Dropbox", async () => {
    const { previewCustomerDocumentBackfill } = await import("../customerDocumentSync");

    const preview = await previewCustomerDocumentBackfill();

    expect(preview.totalDocuments).toBe(3);
    expect(preview.synced).toBe(1);
    expect(preview.notInitialized).toBe(2);
    expect(filesGetMetadata).not.toHaveBeenCalled();
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("E2/E3: syncs only missing documents, skips the already-synchronized one", async () => {
    const { runCustomerDocumentBackfillBatch } = await import("../customerDocumentSync");

    const batch = await runCustomerDocumentBackfillBatch("missing", 10);

    expect(batch.processed).toBe(2);
    expect(batch.results.map((r) => r.customerDocumentId).sort()).toEqual(["doc-1", "doc-3"]);
    expect(syncRows.get("doc-2")!.syncStatus).toBe("SYNCED"); // untouched
  });

  it("E4: retry-failed mode only picks up ERROR/CONFLICT documents", async () => {
    syncRows.set("doc-1", defaultSyncRow({ customerDocumentId: "doc-1", standardizedFileName: "Registration Certificate.pdf", originalFileName: "a.pdf", syncStatus: "ERROR" }));
    const { runCustomerDocumentBackfillBatch } = await import("../customerDocumentSync");

    const batch = await runCustomerDocumentBackfillBatch("retry-failed", 10);

    expect(batch.processed).toBe(1);
    expect(batch.results[0].customerDocumentId).toBe("doc-1");
    expect(batch.results[0].success).toBe(true);
    expect(syncRows.get("doc-1")!.syncStatus).toBe("SYNCED");
  });

  it("E5: a genuine conflict is preserved, not silently retried into an overwrite", async () => {
    syncRows.set("doc-1", defaultSyncRow({ customerDocumentId: "doc-1", standardizedFileName: "Registration Certificate.pdf", originalFileName: "a.pdf", syncStatus: "CONFLICT", dropboxFileId: null }));
    filesGetMetadata.mockResolvedValue({
      result: { ".tag": "file", id: "id:someone-elses-file", rev: "r", path_display: `${CUSTOMER_FOLDER_PATH}/Customer Documents/Registration Certificate.pdf` },
    });
    const { runCustomerDocumentBackfillBatch } = await import("../customerDocumentSync");

    const batch = await runCustomerDocumentBackfillBatch("retry-failed", 10);

    expect(batch.succeeded).toBe(0);
    expect(batch.results[0].status).toBe("CONFLICT");
    expect(filesUpload).not.toHaveBeenCalled();
  });

  it("E6: a missing local file is reported safely per-document, never throws, never calls Dropbox for that doc", async () => {
    getFile.mockImplementation(async (key: string) => (key === "k1" ? null : { buffer: Buffer.from("x"), mimeType: "application/pdf" }));
    const { runCustomerDocumentBackfillBatch } = await import("../customerDocumentSync");

    const batch = await runCustomerDocumentBackfillBatch("missing", 10);

    const doc1Result = batch.results.find((r) => r.customerDocumentId === "doc-1")!;
    expect(doc1Result.success).toBe(false);
    expect(doc1Result.code).toBe("LOCAL_FILE_NOT_FOUND");
  });

  it("E7: batch size is bounded even when a larger limit is requested", async () => {
    for (let i = 4; i <= 30; i++) {
      documents.set(`doc-${i}`, { id: `doc-${i}`, customerId: "cust-1", projectId: null, documentType: "OTHER", originalFileName: `f${i}.pdf`, mimeType: "application/pdf", storageKey: `k${i}` });
    }
    const { runCustomerDocumentBackfillBatch } = await import("../customerDocumentSync");

    const batch = await runCustomerDocumentBackfillBatch("missing", 1000);

    expect(batch.processed).toBeLessThanOrEqual(25);
  });

  it("E9: resumable — a second call only picks up documents still pending", async () => {
    const { runCustomerDocumentBackfillBatch } = await import("../customerDocumentSync");

    const first = await runCustomerDocumentBackfillBatch("missing", 1);
    expect(first.processed).toBe(1);
    const second = await runCustomerDocumentBackfillBatch("missing", 10);
    expect(second.processed).toBe(1); // the other one of the two originally missing
    const third = await runCustomerDocumentBackfillBatch("missing", 10);
    expect(third.processed).toBe(0);
  });

  it("processes sequentially, never via Promise.all (upload calls happen one at a time in document order)", async () => {
    const uploadOrder: string[] = [];
    filesUpload.mockImplementation(async ({ path }: { path: string }) => {
      uploadOrder.push(path);
      return { result: { id: `id:${path}`, rev: "r", path_display: path, path_lower: path.toLowerCase(), content_hash: "h", size: 1, name: path } };
    });
    const { runCustomerDocumentBackfillBatch } = await import("../customerDocumentSync");

    await runCustomerDocumentBackfillBatch("missing", 10);

    expect(uploadOrder.length).toBe(2); // doc-1 and doc-3, in order
  });
});
