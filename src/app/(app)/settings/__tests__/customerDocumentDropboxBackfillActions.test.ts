import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 3 Part 11/17.E.8: backfill/retry/verify actions are ADMIN-only.
const requireAdmin = vi.fn();
vi.mock("@/lib/authz", () => ({ requireAdmin: (...args: unknown[]) => requireAdmin(...args) }));

const previewCustomerDocumentBackfill = vi.fn();
const runCustomerDocumentBackfillBatch = vi.fn();
vi.mock("@/lib/integrations/dropbox/customerDocumentSync", () => ({
  previewCustomerDocumentBackfill: (...args: unknown[]) => previewCustomerDocumentBackfill(...args),
  runCustomerDocumentBackfillBatch: (...args: unknown[]) => runCustomerDocumentBackfillBatch(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("Customer document Dropbox backfill actions — admin gating (Phase 3 Part 11/17.E)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("previewCustomerDocumentBackfillAction denies a non-admin session and never touches Dropbox/DB", async () => {
    requireAdmin.mockResolvedValue(null);
    const { previewCustomerDocumentBackfillAction } = await import("../customerDocumentDropboxBackfillActions");

    const result = await previewCustomerDocumentBackfillAction();

    expect(result.success).toBe(false);
    expect(previewCustomerDocumentBackfill).not.toHaveBeenCalled();
  });

  it("syncMissingCustomerDocumentsAction denies a non-admin session", async () => {
    requireAdmin.mockResolvedValue(null);
    const { syncMissingCustomerDocumentsAction } = await import("../customerDocumentDropboxBackfillActions");

    const result = await syncMissingCustomerDocumentsAction();

    expect(result.success).toBe(false);
    expect(runCustomerDocumentBackfillBatch).not.toHaveBeenCalled();
  });

  it("retryFailedCustomerDocumentsAction denies a non-admin session", async () => {
    requireAdmin.mockResolvedValue(null);
    const { retryFailedCustomerDocumentsAction } = await import("../customerDocumentDropboxBackfillActions");

    const result = await retryFailedCustomerDocumentsAction();

    expect(result.success).toBe(false);
    expect(runCustomerDocumentBackfillBatch).not.toHaveBeenCalled();
  });

  it("verifySyncedCustomerDocumentsAction denies a non-admin session", async () => {
    requireAdmin.mockResolvedValue(null);
    const { verifySyncedCustomerDocumentsAction } = await import("../customerDocumentDropboxBackfillActions");

    const result = await verifySyncedCustomerDocumentsAction();

    expect(result.success).toBe(false);
    expect(runCustomerDocumentBackfillBatch).not.toHaveBeenCalled();
  });

  it("an admin session allows preview and passes through the result", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    previewCustomerDocumentBackfill.mockResolvedValue({ totalDocuments: 5, synced: 2, pending: 2, error: 1, notInitialized: 0 });
    const { previewCustomerDocumentBackfillAction } = await import("../customerDocumentDropboxBackfillActions");

    const result = await previewCustomerDocumentBackfillAction();

    expect(result.success).toBe(true);
    if (result.success) expect(result.preview.totalDocuments).toBe(5);
  });

  it("an admin session allows syncMissing, calling the batch runner with 'missing'", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    runCustomerDocumentBackfillBatch.mockResolvedValue({ processed: 1, succeeded: 1, failed: 0, results: [] });
    const { syncMissingCustomerDocumentsAction } = await import("../customerDocumentDropboxBackfillActions");

    await syncMissingCustomerDocumentsAction();

    expect(runCustomerDocumentBackfillBatch).toHaveBeenCalledWith("missing");
  });
});
