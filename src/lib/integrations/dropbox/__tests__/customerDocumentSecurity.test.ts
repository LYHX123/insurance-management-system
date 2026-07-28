import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 3 Part 15/17.F — security regression coverage for the document sync
// service: no arbitrary/traversal paths ever reach Dropbox, no public
// sharing API is ever called, and no secret ever appears in a result.

type DocRow = {
  id: string;
  customerId: string;
  projectId: string | null;
  documentType: "REGISTRATION_CERTIFICATE" | "PIN_CERTIFICATE" | "CR12" | "OTHER";
  originalFileName: string;
  mimeType: string;
  storageKey: string;
};
type CustomerRow = { id: string; dropboxFolder: { syncStatus: string; dropboxFolderId: string | null; displayPath: string | null } | null };
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
        return { ...doc, customer: { dropboxFolder: customer?.dropboxFolder ?? null }, dropboxSync: syncRows.get(doc.id) ?? null };
      }),
    },
    customerDocumentDropboxSync: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Partial<SyncRow> & { customerDocumentId: string; standardizedFileName: string; originalFileName: string } }) => {
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
    },
  },
}));

const getFile = vi.fn();
vi.mock("@/lib/storage", () => ({ storageService: { getFile: (...args: unknown[]) => getFile(...args) } }));

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

function notFoundError() {
  return { status: 409, error: { error_summary: "path/not_found/.." } };
}

describe("Dropbox document sync — security regression (Phase 3 Part 15/17.F)", () => {
  let calledMethods: string[];
  let fakeClient: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    documents = new Map([
      ["doc-1", { id: "doc-1", customerId: "cust-1", projectId: null, documentType: "REGISTRATION_CERTIFICATE", originalFileName: "scan.pdf", mimeType: "application/pdf", storageKey: "k1" }],
    ]);
    customers = new Map([
      ["cust-1", { id: "cust-1", dropboxFolder: { syncStatus: "SYNCED", dropboxFolderId: "id:customerfolder", displayPath: CUSTOMER_FOLDER_PATH } }],
    ]);
    syncRows = new Map();
    getFile.mockResolvedValue({ buffer: Buffer.from("%PDF-1.4"), mimeType: "application/pdf" });

    // Only filesGetMetadata/filesUpload are legitimate — a Proxy traps any
    // other call (e.g. a sharing/link-creation method) and records it, so
    // "no public link ever created" is enforced by construction, not by
    // trusting the implementation not to call it.
    calledMethods = [];
    const filesGetMetadata = vi.fn().mockRejectedValue(notFoundError());
    const filesUpload = vi.fn().mockResolvedValue({
      result: { id: "id:new", rev: "rev1", path_display: `${CUSTOMER_FOLDER_PATH}/Customer Documents/Registration Certificate.pdf`, path_lower: "x", content_hash: "h", size: 8, name: "Registration Certificate.pdf" },
    });
    fakeClient = new Proxy(
      { filesGetMetadata, filesUpload },
      {
        get(target, prop: string) {
          calledMethods.push(prop);
          if (prop in target) return (target as Record<string, unknown>)[prop];
          throw new Error(`Unexpected Dropbox SDK method invoked: ${prop}`);
        },
      }
    );
    getAuthenticatedDropboxClient.mockResolvedValue({ ok: true, client: fakeClient, env: {}, row: { rootFolder: ROOT } });
  });

  it("F5: never calls any sharing/link-creation Dropbox API — only filesGetMetadata/filesUpload", async () => {
    const { syncCustomerDocument } = await import("../customerDocumentSync");

    const result = await syncCustomerDocument("doc-1");

    expect(result.success).toBe(true);
    const uniqueMethods = new Set(calledMethods);
    expect(uniqueMethods).toEqual(new Set(["filesGetMetadata", "filesUpload"]));
  });

  it("F1/F2: a tampered standardizedFileName containing '..' is rejected before any Dropbox call (defense in depth)", async () => {
    // Simulate a row whose name was somehow corrupted (e.g. direct DB edit)
    // to attempt a traversal — the pure filename builder itself can never
    // produce this, but the sync path must still refuse to use it.
    syncRows.set(
      "doc-1",
      defaultSyncRow({
        customerDocumentId: "doc-1",
        standardizedFileName: "../../Escape Attempt.pdf",
        originalFileName: "scan.pdf",
        syncStatus: "PENDING",
      })
    );
    const { syncCustomerDocument } = await import("../customerDocumentSync");

    const result = await syncCustomerDocument("doc-1");

    expect(result.success).toBe(false);
    expect(result.code).toBe("DROPBOX_FILE_OUTSIDE_ROOT");
    expect(calledMethods.filter((m) => m === "filesUpload")).toHaveLength(0);
  });

  it("F4: no secret/token ever appears in the sync result", async () => {
    const { syncCustomerDocument } = await import("../customerDocumentSync");

    const result = await syncCustomerDocument("doc-1");

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/refresh|access_token|clientSecret|appSecret/i);
  });

  it("F3: a document always resolves through its OWN customer — no customerId is ever accepted as a parameter that could target another customer's folder", async () => {
    // syncCustomerDocument's only input is the document id; the customer
    // (and therefore the Dropbox destination) is always derived server-side
    // from that document's own row, never from caller-supplied data.
    const { syncCustomerDocument } = await import("../customerDocumentSync");
    expect(syncCustomerDocument.length).toBe(1);

    await syncCustomerDocument("doc-1");
    const [uploadArgs] = (fakeClient as { filesUpload: ReturnType<typeof vi.fn> }).filesUpload.mock.calls[0];
    expect(uploadArgs.path.startsWith(CUSTOMER_FOLDER_PATH)).toBe(true);
  });
});
