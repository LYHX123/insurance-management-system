import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 3 Part 5/8/10 regression at the action layer: a local document
// upload must succeed and stay committed no matter what Dropbox does, and
// document deletion must never touch Dropbox.

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => auth(...args) }));

const requireAdmin = vi.fn();
vi.mock("@/lib/authz", () => ({ requireAdmin: (...args: unknown[]) => requireAdmin(...args) }));

vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  // Permission logic itself is out of scope for these Dropbox-sync-behavior
  // tests (the fake session objects below have no status/permissions
  // fields) — both the VIEW-level and EDIT-level checks are stubbed open,
  // same as before the VIEW/EDIT upgrade added the canEdit() check.
  return { ...actual, hasPermission: () => true, canEdit: () => true };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const syncCustomerDocument = vi.fn();
const verifyCustomerDocumentSync = vi.fn();
const loadSiblingStandardizedNamesLower = vi.fn();
vi.mock("@/lib/integrations/dropbox/customerDocumentSync", () => ({
  syncCustomerDocument: (...args: unknown[]) => syncCustomerDocument(...args),
  verifyCustomerDocumentSync: (...args: unknown[]) => verifyCustomerDocumentSync(...args),
  loadSiblingStandardizedNamesLower: (...args: unknown[]) => loadSiblingStandardizedNamesLower(...args),
}));

const createFile = vi.fn();
const deleteFile = vi.fn();
vi.mock("@/lib/storage", () => ({
  storageService: {
    createFolder: vi.fn(async () => {}),
    uploadFile: (...args: unknown[]) => createFile(...args),
    deleteFile: (...args: unknown[]) => deleteFile(...args),
  },
}));

type DocRow = {
  id: string;
  customerId: string;
  projectId: string | null;
  documentType: string;
  customDocumentName: string | null;
  originalFileName: string;
  storedFileName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  uploadedBy: string;
};
let customers: Map<string, { id: string; customerNumber: string }>;
let documents: Map<string, DocRow>;
let syncRows: Map<string, { customerDocumentId: string; standardizedFileName: string }>;
let idCounter = 0;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customer: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => customers.get(where.id) ?? null),
    },
    customerProject: {
      findUnique: vi.fn(async () => null),
    },
    customerDocument: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => documents.get(where.id) ?? null),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        documents.delete(where.id);
      }),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      idCounter += 1;
      const docId = `doc-${idCounter}`;
      const tx = {
        customerDocument: {
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            const doc = { id: docId, ...data } as unknown as DocRow;
            documents.set(docId, doc);
            return doc;
          }),
        },
        customerDocumentDropboxSync: {
          create: vi.fn(async ({ data }: { data: { customerDocumentId: string; standardizedFileName: string } }) => {
            syncRows.set(data.customerDocumentId, data);
            return data;
          }),
        },
      };
      return cb(tx);
    }),
  },
}));

describe("uploadDocumentAction — Dropbox sync integration (Phase 3 Part 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } });
    customers = new Map([["cust-1", { id: "cust-1", customerNumber: "CUST-0001" }]]);
    documents = new Map();
    syncRows = new Map();
    idCounter = 0;
    createFile.mockResolvedValue({ storageKey: "customers/CUST-0001/company/file.pdf" });
    loadSiblingStandardizedNamesLower.mockResolvedValue(new Set());
  });

  function buildFormData() {
    const formData = new FormData();
    formData.set("customerId", "cust-1");
    formData.set("projectId", "");
    formData.set("documentType", "REGISTRATION_CERTIFICATE");
    formData.set("customDocumentName", "");
    formData.set("file", new File(["%PDF-1.4"], "scan.pdf", { type: "application/pdf" }));
    return formData;
  }

  it("B1/B7: local upload succeeds and reports success even when Dropbox sync fails", async () => {
    syncCustomerDocument.mockResolvedValue({ success: false, status: "ERROR", code: "NETWORK_ERROR" });
    const { uploadDocumentAction } = await import("../document-actions");

    const result = await uploadDocumentAction(buildFormData());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.dropboxSyncStatus).toBe("ERROR");
    }
    // The local document row exists regardless of the Dropbox outcome.
    expect(documents.size).toBe(1);
    expect(syncRows.size).toBe(1);
  });

  it("B1: local upload succeeds and Dropbox sync succeeds -> SYNCED reported", async () => {
    syncCustomerDocument.mockResolvedValue({ success: true, status: "SYNCED" });
    const { uploadDocumentAction } = await import("../document-actions");

    const result = await uploadDocumentAction(buildFormData());

    expect(result.success).toBe(true);
    if (result.success) expect(result.dropboxSyncStatus).toBe("SYNCED");
  });

  it("a Dropbox sync that hangs beyond the bound never blocks reporting local success", async () => {
    syncCustomerDocument.mockImplementation(() => new Promise(() => {})); // never resolves
    const { uploadDocumentAction } = await import("../document-actions");

    // This test only completes if uploadDocumentAction's internal timeout
    // actually races the hang — vitest's default test timeout would fail
    // it otherwise.
    const result = await uploadDocumentAction(buildFormData());
    expect(result.success).toBe(true);
  }, 20_000);

  it("creates the Dropbox sync row as PENDING inside the same transaction as the document, before any network call", async () => {
    let syncRowExistedDuringDropboxCall = false;
    syncCustomerDocument.mockImplementation(async () => {
      syncRowExistedDuringDropboxCall = syncRows.size === 1;
      return { success: true, status: "SYNCED" };
    });
    const { uploadDocumentAction } = await import("../document-actions");

    await uploadDocumentAction(buildFormData());

    expect(syncRowExistedDuringDropboxCall).toBe(true);
  });
});

describe("deleteDocumentAction — never touches Dropbox (Phase 3 Part 10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } });
    customers = new Map([["cust-1", { id: "cust-1", customerNumber: "CUST-0001" }]]);
    documents = new Map([
      [
        "doc-1",
        {
          id: "doc-1",
          customerId: "cust-1",
          projectId: null,
          documentType: "OTHER",
          customDocumentName: "x",
          originalFileName: "a.pdf",
          storedFileName: "b.pdf",
          mimeType: "application/pdf",
          fileSize: 1,
          storageKey: "k",
          uploadedBy: "u1",
        },
      ],
    ]);
    syncRows = new Map();
    deleteFile.mockResolvedValue(undefined);
  });

  it("deleting a document never calls any Dropbox sync/verify function", async () => {
    const { deleteDocumentAction } = await import("../document-actions");

    const result = await deleteDocumentAction("doc-1");

    expect(result.success).toBe(true);
    expect(syncCustomerDocument).not.toHaveBeenCalled();
    expect(verifyCustomerDocumentSync).not.toHaveBeenCalled();
    expect(documents.has("doc-1")).toBe(false);
  });
});

describe("Dropbox document admin actions — ADMIN gating (Phase 3 Part 8/15)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    documents = new Map([
      [
        "doc-1",
        {
          id: "doc-1",
          customerId: "cust-1",
          projectId: null,
          documentType: "OTHER",
          customDocumentName: "x",
          originalFileName: "a.pdf",
          storedFileName: "b.pdf",
          mimeType: "application/pdf",
          fileSize: 1,
          storageKey: "k",
          uploadedBy: "u1",
        },
      ],
    ]);
  });

  it("retryDocumentSyncAction denies a non-admin session and never calls the sync service", async () => {
    requireAdmin.mockResolvedValue(null);
    const { retryDocumentSyncAction } = await import("../document-actions");

    const result = await retryDocumentSyncAction("doc-1");

    expect(result.success).toBe(false);
    expect(result.forbidden).toBe(true);
    expect(syncCustomerDocument).not.toHaveBeenCalled();
  });

  it("verifyDocumentSyncAction denies a non-admin session and never calls the verify service", async () => {
    requireAdmin.mockResolvedValue(null);
    const { verifyDocumentSyncAction } = await import("../document-actions");

    const result = await verifyDocumentSyncAction("doc-1");

    expect(result.success).toBe(false);
    expect(result.forbidden).toBe(true);
    expect(verifyCustomerDocumentSync).not.toHaveBeenCalled();
  });

  it("an admin session allows retry, which calls the sync service with the document id", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    syncCustomerDocument.mockResolvedValue({ success: true, status: "SYNCED" });
    const { retryDocumentSyncAction } = await import("../document-actions");

    const result = await retryDocumentSyncAction("doc-1");

    expect(result.success).toBe(true);
    expect(syncCustomerDocument).toHaveBeenCalledWith("doc-1");
  });
});
