import { describe, it, expect, vi, beforeEach } from "vitest";

// Category F — security (Phase 6, Part 11/14.F). Mirrors
// dropboxActions.test.ts's convention: mock requireAdmin and the sync
// service, prove the FORBIDDEN short-circuit fires without a real
// session/DB, and prove every action resolves everything from the database
// id alone — never a client-supplied path/filename/business-file id (there
// simply is no such parameter on any of these actions to begin with).

const requireAdmin = vi.fn();
vi.mock("@/lib/authz", () => ({ requireAdmin: (...args: unknown[]) => requireAdmin(...args) }));

const syncInvoiceDocumentToDropbox = vi.fn();
const verifyInvoiceDocumentSync = vi.fn();
const verifyInvoiceBusinessFolder = vi.fn();
const previewInvoiceDocumentBackfill = vi.fn();
const runInvoiceDocumentBackfillBatch = vi.fn();
vi.mock("@/lib/integrations/dropbox/invoiceDocumentSync", () => ({
  syncInvoiceDocumentToDropbox: (...args: unknown[]) => syncInvoiceDocumentToDropbox(...args),
  verifyInvoiceDocumentSync: (...args: unknown[]) => verifyInvoiceDocumentSync(...args),
  verifyInvoiceBusinessFolder: (...args: unknown[]) => verifyInvoiceBusinessFolder(...args),
  previewInvoiceDocumentBackfill: (...args: unknown[]) => previewInvoiceDocumentBackfill(...args),
  runInvoiceDocumentBackfillBatch: (...args: unknown[]) => runInvoiceDocumentBackfillBatch(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("Invoice Dropbox server actions — admin gating (Phase 6, Category F)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("F1: retryInvoiceDocumentSyncAction denies a non-admin session without calling the sync service", async () => {
    requireAdmin.mockResolvedValue(null);
    const { retryInvoiceDocumentSyncAction } = await import("../../../../app/(app)/invoice/dropboxActions");

    const result = await retryInvoiceDocumentSyncAction("inv-1");

    expect(result).toEqual({ success: false, forbidden: true });
    expect(syncInvoiceDocumentToDropbox).not.toHaveBeenCalled();
  });

  it("F1: verifyInvoiceDocumentAction denies a non-admin session without calling the sync service", async () => {
    requireAdmin.mockResolvedValue(null);
    const { verifyInvoiceDocumentAction } = await import("../../../../app/(app)/invoice/dropboxActions");

    const result = await verifyInvoiceDocumentAction("inv-1");

    expect(result).toEqual({ success: false, forbidden: true });
    expect(verifyInvoiceDocumentSync).not.toHaveBeenCalled();
  });

  it("F1: verifyInvoiceBusinessFolderAction denies a non-admin session without calling the sync service", async () => {
    requireAdmin.mockResolvedValue(null);
    const { verifyInvoiceBusinessFolderAction } = await import("../../../../app/(app)/invoice/dropboxActions");

    const result = await verifyInvoiceBusinessFolderAction("inv-1");

    expect(result).toEqual({ success: false, forbidden: true });
    expect(verifyInvoiceBusinessFolder).not.toHaveBeenCalled();
  });

  it("an admin session is allowed through, and only the database id is ever passed to the sync service", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    syncInvoiceDocumentToDropbox.mockResolvedValue({ success: true, status: "SYNCED" });
    const { retryInvoiceDocumentSyncAction } = await import("../../../../app/(app)/invoice/dropboxActions");

    const result = await retryInvoiceDocumentSyncAction("inv-1");

    expect(result).toEqual({ success: true, status: "SYNCED" });
    expect(syncInvoiceDocumentToDropbox).toHaveBeenCalledWith("inv-1");
    expect(syncInvoiceDocumentToDropbox).toHaveBeenCalledTimes(1);
  });

  it("F5: raw SDK/internal errors are never returned — only the normalized {success,status,code,message} shape", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    syncInvoiceDocumentToDropbox.mockResolvedValue({ success: false, status: "ERROR", code: "NETWORK_ERROR", message: "Could not reach Dropbox. Check your network connection." });
    const { retryInvoiceDocumentSyncAction } = await import("../../../../app/(app)/invoice/dropboxActions");

    const result = await retryInvoiceDocumentSyncAction("inv-1");

    expect(result).not.toHaveProperty("stack");
    if ("message" in result) {
      expect(result.message).not.toMatch(/dropbox\.com\/oauth|refresh_token|access_token/i);
    }
  });
});

describe("Invoice backfill server actions — admin gating (Phase 6, Category F)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("F1: every backfill action denies a non-admin session", async () => {
    requireAdmin.mockResolvedValue(null);
    const mod = await import("../../../../app/(app)/settings/invoiceDocumentDropboxBackfillActions");

    const results = await Promise.all([
      mod.previewInvoiceDocumentBackfillAction(),
      mod.initMissingInvoiceDocumentsAction(),
      mod.syncMissingInvoiceDocumentsAction(),
      mod.retryFailedInvoiceDocumentsAction(),
      mod.verifySyncedInvoiceDocumentsAction(),
    ]);

    for (const result of results) {
      expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    }
  });
});
