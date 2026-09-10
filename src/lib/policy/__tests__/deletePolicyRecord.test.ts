import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 13D — Permanent Policy delete, now PERMISSION-CONTROLLED (not
// admin-only). Covers: the DELETE-capability gate resolved from the record's
// REAL category, independent re-verification of the typed record number, the
// unified dependency-blocker guard, and "every rejection path leaves the
// record untouched". getPolicyDeleteBlockers is mocked here — its own logic
// is covered in getPolicyDeleteBlockers.test.ts.

let sessionUser: { id: string; role: string; status: string; permissions: string[] } | null = null;
vi.mock("@/lib/auth", () => ({
  auth: async () => (sessionUser ? { user: sessionUser } : null),
}));

let policyRow:
  | { id: string; recordNumber: string; category: string; documents: { storagePath: string }[] }
  | null;
const deleteMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    policyRecord: {
      findUnique: vi.fn(async () => policyRow),
      delete: (...args: unknown[]) => deleteMock(...args),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ policyRecord: { delete: deleteMock } }),
  },
}));

const getBlockersMock = vi.fn();
vi.mock("@/lib/policy/getPolicyDeleteBlockers", () => ({
  getPolicyDeleteBlockers: (...args: unknown[]) => getBlockersMock(...args),
}));

const deleteFileMock = vi.fn();
vi.mock("@/lib/policyDocuments/storage", () => ({
  policyDocumentStorage: { deleteFile: (...args: unknown[]) => deleteFileMock(...args) },
}));

function setSession(permissions: string[], role = "Staff") {
  sessionUser = { id: "user-1", role, status: "ACTIVE", permissions };
}

describe("deletePolicyRecord — permanent, permission-controlled delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession(["policy.motor.delete"]);
    policyRow = { id: "pol-1", recordNumber: "PM202607-0002", category: "MOTOR", documents: [] };
    getBlockersMock.mockResolvedValue({ canDelete: true, blockers: [] });
    deleteMock.mockResolvedValue(undefined);
  });

  it("denies an unauthenticated request before touching the record", async () => {
    sessionUser = null;
    const { deletePolicyRecord } = await import("../deletePolicyRecord");
    const result = await deletePolicyRecord("pol-1", "MOTOR", "PM202607-0002");
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("denies a session WITHOUT the matching category .delete permission (EDIT is not enough)", async () => {
    setSession(["policy.motor.edit"]);
    const { deletePolicyRecord } = await import("../deletePolicyRecord");
    const result = await deletePolicyRecord("pol-1", "MOTOR", "PM202607-0002");
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("denies a legacy bare 'policy.motor' key (full access, pre-13D) — it never implies DELETE", async () => {
    setSession(["policy.motor"]);
    const { deletePolicyRecord } = await import("../deletePolicyRecord");
    const result = await deletePolicyRecord("pol-1", "MOTOR", "PM202607-0002");
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("denies a .delete permission for the WRONG category (cross-category isolation, server-enforced)", async () => {
    setSession(["policy.bond.delete"]);
    const { deletePolicyRecord } = await import("../deletePolicyRecord");
    const result = await deletePolicyRecord("pol-1", "MOTOR", "PM202607-0002");
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("allows an Admin regardless of stored permissions", async () => {
    setSession([], "Admin");
    const { deletePolicyRecord } = await import("../deletePolicyRecord");
    const result = await deletePolicyRecord("pol-1", "MOTOR", "PM202607-0002");
    expect(result).toEqual({ success: true, recordNumber: "PM202607-0002" });
  });

  it("resolves the required permission from the record's REAL category, not the caller argument", async () => {
    // Record is really a BOND; the caller passes BOND (matching route). A
    // motor.delete user must still be refused.
    policyRow = { id: "pol-1", recordNumber: "PB202607-0009", category: "BOND", documents: [] };
    setSession(["policy.motor.delete"]);
    const { deletePolicyRecord } = await import("../deletePolicyRecord");
    const result = await deletePolicyRecord("pol-1", "BOND", "PB202607-0009");
    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
  });

  it("returns NOT_FOUND for a category-mismatched route (never a cross-category delete)", async () => {
    // Real record is MOTOR but reached through the BOND route.
    setSession(["policy.bond.delete"]);
    const { deletePolicyRecord } = await import("../deletePolicyRecord");
    const result = await deletePolicyRecord("pol-1", "BOND", "PM202607-0002");
    expect(result).toEqual({ success: false, error: "NOT_FOUND" });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the id does not resolve", async () => {
    policyRow = null;
    const { deletePolicyRecord } = await import("../deletePolicyRecord");
    const result = await deletePolicyRecord("nope", "MOTOR", "PM202607-0002");
    expect(result).toEqual({ success: false, error: "NOT_FOUND" });
  });

  it("rejects a typed confirmation value that does not match the DB record number", async () => {
    const { deletePolicyRecord } = await import("../deletePolicyRecord");
    const result = await deletePolicyRecord("pol-1", "MOTOR", "PM202607-9999");
    expect(result).toEqual({ success: false, error: "CONFIRMATION_MISMATCH" });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("trims incidental whitespace around a correctly-typed confirmation value", async () => {
    const { deletePolicyRecord } = await import("../deletePolicyRecord");
    const result = await deletePolicyRecord("pol-1", "MOTOR", "  PM202607-0002  ");
    expect(result.success).toBe(true);
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: "pol-1" } });
  });

  it("blocks deletion when getPolicyDeleteBlockers reports dependencies, without touching the record", async () => {
    getBlockersMock.mockResolvedValue({
      canDelete: false,
      blockers: [
        { type: "INVOICE", count: 1 },
        { type: "MOTOR_CLAIM", count: 2 },
      ],
    });
    const { deletePolicyRecord } = await import("../deletePolicyRecord");
    const result = await deletePolicyRecord("pol-1", "MOTOR", "PM202607-0002");
    expect(result).toEqual({
      success: false,
      error: "HAS_DEPENDENCIES",
      blockers: [
        { type: "INVOICE", count: 1 },
        { type: "MOTOR_CLAIM", count: 2 },
      ],
    });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("the exact confirmation value on an eligible record deletes and returns the record number", async () => {
    const { deletePolicyRecord } = await import("../deletePolicyRecord");
    const result = await deletePolicyRecord("pol-1", "MOTOR", "PM202607-0002");
    expect(result).toEqual({ success: true, recordNumber: "PM202607-0002" });
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: "pol-1" } });
  });

  it("removes LOCAL document files after the transaction, but only local ones", async () => {
    policyRow = {
      id: "pol-1",
      recordNumber: "PM202607-0002",
      category: "MOTOR",
      documents: [{ storagePath: "pol-1/doc-a/file.pdf" }],
    };
    const { deletePolicyRecord } = await import("../deletePolicyRecord");
    await deletePolicyRecord("pol-1", "MOTOR", "PM202607-0002");
    expect(deleteFileMock).toHaveBeenCalledWith("pol-1/doc-a/file.pdf");
  });

  it("never imports or calls any Dropbox delete API — deleting a Policy must never delete Dropbox files/folders", () => {
    const source = readFileSync(join(__dirname, "..", "deletePolicyRecord.ts"), "utf8");
    expect(source).not.toMatch(/filesDeleteV2|filesPermanentlyDelete|filesDelete/);
    expect(source).not.toMatch(/from ["']\.\.\/integrations\/dropbox|from ["']dropbox["']/);
  });
});
