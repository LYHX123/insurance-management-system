import { describe, it, expect, vi, beforeEach } from "vitest";

// Part 23.E.6 / F.1: backfill/retry actions are ADMIN-only.
const requireAdmin = vi.fn();
vi.mock("@/lib/authz", () => ({ requireAdmin: (...args: unknown[]) => requireAdmin(...args) }));

const previewCustomerFolderBackfill = vi.fn();
const runCustomerFolderBackfillBatch = vi.fn();
vi.mock("@/lib/integrations/dropbox/customer-folders", () => ({
  previewCustomerFolderBackfill: (...args: unknown[]) => previewCustomerFolderBackfill(...args),
  runCustomerFolderBackfillBatch: (...args: unknown[]) => runCustomerFolderBackfillBatch(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("Customer Dropbox backfill actions — admin gating (Part 23.E/F)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("previewCustomerBackfillAction denies a non-admin session and never touches Dropbox/DB", async () => {
    requireAdmin.mockResolvedValue(null);
    const { previewCustomerBackfillAction } = await import("../customerDropboxBackfillActions");

    const result = await previewCustomerBackfillAction();

    expect(result.success).toBe(false);
    expect(previewCustomerFolderBackfill).not.toHaveBeenCalled();
  });

  it("syncMissingCustomerFoldersAction denies a non-admin session", async () => {
    requireAdmin.mockResolvedValue(null);
    const { syncMissingCustomerFoldersAction } = await import("../customerDropboxBackfillActions");

    const result = await syncMissingCustomerFoldersAction();

    expect(result.success).toBe(false);
    expect(runCustomerFolderBackfillBatch).not.toHaveBeenCalled();
  });

  it("retryFailedCustomerFoldersAction calls the service in retry-failed mode for an admin", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    runCustomerFolderBackfillBatch.mockResolvedValue({ processed: 0, succeeded: 0, failed: 0, results: [] });
    const { retryFailedCustomerFoldersAction } = await import("../customerDropboxBackfillActions");

    const result = await retryFailedCustomerFoldersAction();

    expect(result.success).toBe(true);
    expect(runCustomerFolderBackfillBatch).toHaveBeenCalledWith("retry-failed");
  });

  it("previewCustomerBackfillAction succeeds for an admin", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    previewCustomerFolderBackfill.mockResolvedValue({ totalCustomers: 5, synced: 2, pending: 2, error: 1, notInitialized: 0 });
    const { previewCustomerBackfillAction } = await import("../customerDropboxBackfillActions");

    const result = await previewCustomerBackfillAction();

    expect(result).toEqual({ success: true, preview: { totalCustomers: 5, synced: 2, pending: 2, error: 1, notInitialized: 0 } });
  });
});
