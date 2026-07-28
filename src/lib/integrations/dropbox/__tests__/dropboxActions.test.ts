import { describe, it, expect, vi, beforeEach } from "vitest";

// Server actions call requireAdmin() first, before ever touching the
// Dropbox service — mocking it lets us prove the FORBIDDEN short-circuit
// fires without needing a real session/DB.
const requireAdmin = vi.fn();
vi.mock("@/lib/authz", () => ({ requireAdmin: (...args: unknown[]) => requireAdmin(...args) }));

const testDropboxConnection = vi.fn();
const disconnectDropbox = vi.fn();
const saveDropboxRootFolder = vi.fn();
vi.mock("@/lib/integrations/dropbox/service", () => ({
  testDropboxConnection: (...args: unknown[]) => testDropboxConnection(...args),
  disconnectDropbox: (...args: unknown[]) => disconnectDropbox(...args),
  saveDropboxRootFolder: (...args: unknown[]) => saveDropboxRootFolder(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("Dropbox settings server actions — admin gating (Part 20.A/F)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("testDropboxConnectionAction denies a non-admin session without calling the service", async () => {
    requireAdmin.mockResolvedValue(null);
    const { testDropboxConnectionAction } = await import("../../../../app/(app)/settings/dropboxActions");

    const result = await testDropboxConnectionAction();

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(testDropboxConnection).not.toHaveBeenCalled();
  });

  it("disconnectDropboxAction denies a non-admin session without calling the service", async () => {
    requireAdmin.mockResolvedValue(null);
    const { disconnectDropboxAction } = await import("../../../../app/(app)/settings/dropboxActions");

    const result = await disconnectDropboxAction();

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(disconnectDropbox).not.toHaveBeenCalled();
  });

  it("saveDropboxRootFolderAction denies a non-admin session without calling the service", async () => {
    requireAdmin.mockResolvedValue(null);
    const { saveDropboxRootFolderAction } = await import("../../../../app/(app)/settings/dropboxActions");

    const result = await saveDropboxRootFolderAction("/Insurance Management System");

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(saveDropboxRootFolder).not.toHaveBeenCalled();
  });

  it("an admin session is allowed through to the service", async () => {
    requireAdmin.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    testDropboxConnection.mockResolvedValue({ success: true });
    const { testDropboxConnectionAction } = await import("../../../../app/(app)/settings/dropboxActions");

    const result = await testDropboxConnectionAction();

    expect(result).toEqual({ success: true });
    expect(testDropboxConnection).toHaveBeenCalledOnce();
  });
});
