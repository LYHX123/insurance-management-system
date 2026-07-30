import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Permanent Policy delete — covers the server-side half of the "Permanent
// Delete button unusable" fix: the confirmation value must now be
// independently re-verified against the database record (not just trusted
// from a client-side match), and every rejection path must leave the record
// untouched (Correction 2, requirements 6-8, 11-12, 14).

const requireAdmin = vi.fn();
vi.mock("@/lib/authz", () => ({ requireAdmin: (...args: unknown[]) => requireAdmin(...args) }));

let policyRow: { id: string; recordNumber: string; documents: { storagePath: string }[] } | null;
const deleteMock = vi.fn();
const invoiceItemFindManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    policyRecord: {
      findUnique: vi.fn(async () => policyRow),
      delete: (...args: unknown[]) => deleteMock(...args),
    },
    invoiceItem: {
      findMany: (...args: unknown[]) => invoiceItemFindManyMock(...args),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ policyRecord: { delete: deleteMock } }),
  },
}));

const deleteFileMock = vi.fn();
vi.mock("@/lib/policyDocuments/storage", () => ({
  policyDocumentStorage: { deleteFile: (...args: unknown[]) => deleteFileMock(...args) },
}));

describe("deletePolicyRecord — permanent delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
    policyRow = { id: "pol-1", recordNumber: "PM202607-0002", documents: [] };
    invoiceItemFindManyMock.mockResolvedValue([]);
    deleteMock.mockResolvedValue(undefined);
  });

  it("denies a non-admin session before ever reading the record", async () => {
    requireAdmin.mockResolvedValue(null);
    const { deletePolicyRecord } = await import("../deletePolicyRecord");

    const result = await deletePolicyRecord("pol-1", "MOTOR", "PM202607-0002");

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("rejects a confirmation value that does not match the database record number (wrong value never deletes)", async () => {
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

  it("the exact confirmation value deletes successfully and returns the record number", async () => {
    const { deletePolicyRecord } = await import("../deletePolicyRecord");

    const result = await deletePolicyRecord("pol-1", "MOTOR", "PM202607-0002");

    expect(result).toEqual({ success: true, recordNumber: "PM202607-0002" });
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: "pol-1" } });
  });

  it("blocks deletion when an InvoiceItem is linked, without touching the record", async () => {
    invoiceItemFindManyMock.mockResolvedValue([{ invoice: { invoiceNumber: "INV-001" } }]);
    const { deletePolicyRecord } = await import("../deletePolicyRecord");

    const result = await deletePolicyRecord("pol-1", "MOTOR", "PM202607-0002");

    expect(result).toEqual({ success: false, error: "INVOICE_LINKED", invoiceNumbers: ["INV-001"] });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND (never a category-mismatched delete) when the id/category pair doesn't resolve", async () => {
    policyRow = null;
    const { deletePolicyRecord } = await import("../deletePolicyRecord");

    const result = await deletePolicyRecord("pol-1", "BOND", "PM202607-0002");

    expect(result).toEqual({ success: false, error: "NOT_FOUND" });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("never calls any Dropbox delete API — deleting a Policy must never delete Dropbox files/folders", () => {
    const source = readFileSync(join(__dirname, "..", "deletePolicyRecord.ts"), "utf8");
    expect(source).not.toMatch(/filesDeleteV2|filesPermanentlyDelete/);
    // No import of the Dropbox service/SDK at all — deletion never even
    // has the capability to reach Dropbox, not just "chooses not to".
    expect(source).not.toMatch(/from ["']\.\.\/integrations\/dropbox|from ["']dropbox["']/);
  });
});
