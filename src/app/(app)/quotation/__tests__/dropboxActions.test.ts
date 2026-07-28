import { describe, it, expect, vi, beforeEach } from "vitest";

// Phase 4 Part 10/14/17.C.8: retry/verify/re-upload are ADMIN-only.
const requireAdmin = vi.fn();
vi.mock("@/lib/authz", () => ({ requireAdmin: (...args: unknown[]) => requireAdmin(...args) }));

const syncQuotationVersionToDropbox = vi.fn();
const verifyBusinessFolder = vi.fn();
const verifyQuotationVersion = vi.fn();
vi.mock("@/lib/integrations/dropbox/quotationDropboxSync", () => ({
  syncQuotationVersionToDropbox: (...args: unknown[]) => syncQuotationVersionToDropbox(...args),
  verifyBusinessFolder: (...args: unknown[]) => verifyBusinessFolder(...args),
  verifyQuotationVersion: (...args: unknown[]) => verifyQuotationVersion(...args),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    quotationDropboxVersion: {
      findUnique: vi.fn(async () => ({ sourceQuotationId: "quo-1" })),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("Quotation Dropbox actions — admin gating (Phase 4 Part 10/14)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retryQuotationDropboxSyncAction denies a non-admin session and never calls the sync service", async () => {
    requireAdmin.mockResolvedValue(null);
    const { retryQuotationDropboxSyncAction } = await import("../dropboxActions");

    const result = await retryQuotationDropboxSyncAction("ver-1");

    expect(result.success).toBe(false);
    expect(result.forbidden).toBe(true);
    expect(syncQuotationVersionToDropbox).not.toHaveBeenCalled();
  });

  it("reuploadQuotationVersionAction denies a non-admin session", async () => {
    requireAdmin.mockResolvedValue(null);
    const { reuploadQuotationVersionAction } = await import("../dropboxActions");

    const result = await reuploadQuotationVersionAction("ver-1");

    expect(result.success).toBe(false);
    expect(result.forbidden).toBe(true);
    expect(syncQuotationVersionToDropbox).not.toHaveBeenCalled();
  });

  it("verifyBusinessFolderAction denies a non-admin session", async () => {
    requireAdmin.mockResolvedValue(null);
    const { verifyBusinessFolderAction } = await import("../dropboxActions");

    const result = await verifyBusinessFolderAction("quo-1");

    expect(result.success).toBe(false);
    expect(result.forbidden).toBe(true);
    expect(verifyBusinessFolder).not.toHaveBeenCalled();
  });

  it("verifyQuotationVersionAction denies a non-admin session", async () => {
    requireAdmin.mockResolvedValue(null);
    const { verifyQuotationVersionAction } = await import("../dropboxActions");

    const result = await verifyQuotationVersionAction("ver-1");

    expect(result.success).toBe(false);
    expect(result.forbidden).toBe(true);
    expect(verifyQuotationVersion).not.toHaveBeenCalled();
  });

  it("an admin session allows retry, calling the sync service with the version id", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    syncQuotationVersionToDropbox.mockResolvedValue({ success: true, status: "SYNCED" });
    const { retryQuotationDropboxSyncAction } = await import("../dropboxActions");

    const result = await retryQuotationDropboxSyncAction("ver-1");

    expect(result.success).toBe(true);
    expect(syncQuotationVersionToDropbox).toHaveBeenCalledWith("ver-1");
  });

  it("an admin session allows business-folder verification", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } });
    verifyBusinessFolder.mockResolvedValue({ success: true, status: "SYNCED" });
    const { verifyBusinessFolderAction } = await import("../dropboxActions");

    const result = await verifyBusinessFolderAction("quo-1");

    expect(result.success).toBe(true);
    expect(verifyBusinessFolder).toHaveBeenCalledWith("quo-1");
  });
});
