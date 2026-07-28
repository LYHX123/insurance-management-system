import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 4 Part 11/17.G.9: backfill/retry/verify actions are ADMIN-only.
const requireAdmin = vi.fn();
vi.mock("@/lib/authz", () => ({ requireAdmin: (...args: unknown[]) => requireAdmin(...args) }));

const previewQuotationBackfill = vi.fn();
const runQuotationBackfillBatch = vi.fn();
vi.mock("@/lib/integrations/dropbox/quotationDropboxSync", () => ({
  previewQuotationBackfill: (...args: unknown[]) => previewQuotationBackfill(...args),
  runQuotationBackfillBatch: (...args: unknown[]) => runQuotationBackfillBatch(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("Quotation Dropbox backfill actions — admin gating (Phase 4 Part 11/17.G)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("previewQuotationBackfillAction denies a non-admin session and never touches Dropbox/DB", async () => {
    requireAdmin.mockResolvedValue(null);
    const { previewQuotationBackfillAction } = await import("../quotationDropboxBackfillActions");

    const result = await previewQuotationBackfillAction();

    expect(result.success).toBe(false);
    expect(previewQuotationBackfill).not.toHaveBeenCalled();
  });

  it("initMissingBusinessFilesAction denies a non-admin session", async () => {
    requireAdmin.mockResolvedValue(null);
    const { initMissingBusinessFilesAction } = await import("../quotationDropboxBackfillActions");

    const result = await initMissingBusinessFilesAction();

    expect(result.success).toBe(false);
    expect(runQuotationBackfillBatch).not.toHaveBeenCalled();
  });

  it("syncMissingQuotationVersionsAction denies a non-admin session", async () => {
    requireAdmin.mockResolvedValue(null);
    const { syncMissingQuotationVersionsAction } = await import("../quotationDropboxBackfillActions");

    const result = await syncMissingQuotationVersionsAction();

    expect(result.success).toBe(false);
    expect(runQuotationBackfillBatch).not.toHaveBeenCalled();
  });

  it("retryFailedQuotationVersionsAction denies a non-admin session", async () => {
    requireAdmin.mockResolvedValue(null);
    const { retryFailedQuotationVersionsAction } = await import("../quotationDropboxBackfillActions");

    const result = await retryFailedQuotationVersionsAction();

    expect(result.success).toBe(false);
    expect(runQuotationBackfillBatch).not.toHaveBeenCalled();
  });

  it("verifySyncedQuotationVersionsAction denies a non-admin session", async () => {
    requireAdmin.mockResolvedValue(null);
    const { verifySyncedQuotationVersionsAction } = await import("../quotationDropboxBackfillActions");

    const result = await verifySyncedQuotationVersionsAction();

    expect(result.success).toBe(false);
    expect(runQuotationBackfillBatch).not.toHaveBeenCalled();
  });

  it("an admin session allows initMissingBusinessFiles, calling the batch runner with 'init-missing'", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    runQuotationBackfillBatch.mockResolvedValue({ processed: 1, succeeded: 1, failed: 0, results: [] });
    const { initMissingBusinessFilesAction } = await import("../quotationDropboxBackfillActions");

    await initMissingBusinessFilesAction();

    expect(runQuotationBackfillBatch).toHaveBeenCalledWith("init-missing");
  });
});
