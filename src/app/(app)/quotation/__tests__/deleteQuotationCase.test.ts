import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Quotation LIST page delete (Correction 1) — a case-level delete distinct
// from deleteQuotationAction/deleteDraftRevisionAction (see actions.ts's
// doc comment on deleteQuotationCaseAction). Covers: permission gating,
// server-side re-verification of the typed confirmation value against the
// database's own quotationNumber (never trusting the browser-supplied
// value), the linked-Policy block, and that Dropbox is never touched.

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => auth(...args) }));

vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return { ...actual, hasPermission: () => true };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let caseRow: { id: string; quotationNumber: string; revisions: { id: string }[] } | null;
const caseDeleteMock = vi.fn();
const policyRecordFindManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    quotationCase: {
      findUnique: vi.fn(async () => caseRow),
      delete: (...args: unknown[]) => caseDeleteMock(...args),
    },
    policyRecord: {
      findMany: (...args: unknown[]) => policyRecordFindManyMock(...args),
    },
  },
}));

describe("deleteQuotationCaseAction — Quotation list Delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "u1", role: "Staff", status: "ACTIVE", permissions: ["quotation"] } });
    caseRow = { id: "case-1", quotationNumber: "QT202607-006", revisions: [{ id: "rev-1" }, { id: "rev-2" }] };
    policyRecordFindManyMock.mockResolvedValue([]);
    caseDeleteMock.mockResolvedValue(undefined);
  });

  it("denies a session without quotation permission, without reading the case", async () => {
    auth.mockResolvedValue(null);
    const { deleteQuotationCaseAction } = await import("../actions");

    const result = await deleteQuotationCaseAction("case-1", "QT202607-006");

    expect(result).toEqual({ success: false, error: "FORBIDDEN" });
    expect(caseDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects when the case cannot be found", async () => {
    caseRow = null;
    const { deleteQuotationCaseAction } = await import("../actions");

    const result = await deleteQuotationCaseAction("case-1", "QT202607-006");

    expect(result).toEqual({ success: false, error: "CASE_NOT_FOUND" });
    expect(caseDeleteMock).not.toHaveBeenCalled();
  });

  it("never trusts a browser-supplied quotation number — a mismatched confirmation blocks deletion even for a real case id", async () => {
    const { deleteQuotationCaseAction } = await import("../actions");

    const result = await deleteQuotationCaseAction("case-1", "QT202607-999");

    expect(result).toEqual({ success: false, error: "CONFIRMATION_MISMATCH" });
    expect(caseDeleteMock).not.toHaveBeenCalled();
  });

  it("trims incidental whitespace around a correctly-typed quotation number", async () => {
    const { deleteQuotationCaseAction } = await import("../actions");

    const result = await deleteQuotationCaseAction("case-1", "  QT202607-006  ");

    expect(result.success).toBe(true);
    expect(caseDeleteMock).toHaveBeenCalledWith({ where: { id: "case-1" } });
  });

  it("blocks deletion when any revision under the case has a linked, non-deleted Policy", async () => {
    policyRecordFindManyMock.mockResolvedValue([{ recordNumber: "PM202607-0002" }]);
    const { deleteQuotationCaseAction } = await import("../actions");

    const result = await deleteQuotationCaseAction("case-1", "QT202607-006");

    expect(result).toEqual({ success: false, error: "QUOTATION_HAS_LINKED_POLICIES", policyRecordNumbers: ["PM202607-0002"] });
    expect(caseDeleteMock).not.toHaveBeenCalled();
    // Checked across every revision under the case, not just one.
    expect(policyRecordFindManyMock).toHaveBeenCalledWith({
      where: { sourceQuotationId: { in: ["rev-1", "rev-2"] }, deletedAt: null },
      select: { recordNumber: true },
    });
  });

  it("deletes the whole case on an exact confirmation match and returns its quotation number", async () => {
    const { deleteQuotationCaseAction } = await import("../actions");

    const result = await deleteQuotationCaseAction("case-1", "QT202607-006");

    expect(result).toEqual({ success: true, quotationNumber: "QT202607-006" });
    expect(caseDeleteMock).toHaveBeenCalledWith({ where: { id: "case-1" } });
  });

  it("a case with no revisions yet (Preparing Documents) deletes cleanly without a linked-policy query", async () => {
    caseRow = { id: "case-1", quotationNumber: "QT202607-006", revisions: [] };
    const { deleteQuotationCaseAction } = await import("../actions");

    const result = await deleteQuotationCaseAction("case-1", "QT202607-006");

    expect(result.success).toBe(true);
    expect(policyRecordFindManyMock).not.toHaveBeenCalled();
  });

  it("never calls any Dropbox delete API", () => {
    const source = readFileSync(join(__dirname, "..", "actions.ts"), "utf8");
    expect(source).not.toMatch(/filesDeleteV2|filesPermanentlyDelete/);
  });
});
