import { describe, it, expect, vi, beforeEach } from "vitest";

// Part 23.F: admin-gating for Customer Dropbox admin actions — every
// action must independently enforce requireAdmin(), regardless of UI
// visibility.
const requireAdmin = vi.fn();
vi.mock("@/lib/authz", () => ({ requireAdmin: (...args: unknown[]) => requireAdmin(...args) }));

const syncCustomerFolder = vi.fn();
const verifyCustomerFolder = vi.fn();
const rebuildCustomerSubfolders = vi.fn();
vi.mock("@/lib/integrations/dropbox/customer-folders", () => ({
  syncCustomerFolder: (...args: unknown[]) => syncCustomerFolder(...args),
  verifyCustomerFolder: (...args: unknown[]) => verifyCustomerFolder(...args),
  rebuildCustomerSubfolders: (...args: unknown[]) => rebuildCustomerSubfolders(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("Customer Dropbox actions — admin gating (Part 23.F)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("syncCustomerFolderAction denies a non-admin session without calling the service", async () => {
    requireAdmin.mockResolvedValue(null);
    const { syncCustomerFolderAction } = await import("../dropboxActions");

    const result = await syncCustomerFolderAction("cust-1");

    expect(result.forbidden).toBe(true);
    expect(syncCustomerFolder).not.toHaveBeenCalled();
  });

  it("verifyCustomerFolderAction denies a non-admin session", async () => {
    requireAdmin.mockResolvedValue(null);
    const { verifyCustomerFolderAction } = await import("../dropboxActions");

    const result = await verifyCustomerFolderAction("cust-1");

    expect(result.forbidden).toBe(true);
    expect(verifyCustomerFolder).not.toHaveBeenCalled();
  });

  it("rebuildCustomerSubfoldersAction denies a non-admin session", async () => {
    requireAdmin.mockResolvedValue(null);
    const { rebuildCustomerSubfoldersAction } = await import("../dropboxActions");

    const result = await rebuildCustomerSubfoldersAction("cust-1");

    expect(result.forbidden).toBe(true);
    expect(rebuildCustomerSubfolders).not.toHaveBeenCalled();
  });

  it("an admin session is allowed through to the service", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    syncCustomerFolder.mockResolvedValue({ success: true, status: "SYNCED" });
    const { syncCustomerFolderAction } = await import("../dropboxActions");

    const result = await syncCustomerFolderAction("cust-1");

    expect(result.success).toBe(true);
    expect(syncCustomerFolder).toHaveBeenCalledWith("cust-1");
  });
});
