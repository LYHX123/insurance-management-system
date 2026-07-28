import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Phase 4 Part 13/17.D: deleting a Quotation must never call any Dropbox
// delete/sync API — QuotationDropboxBusinessFile/QuotationDropboxVersion
// cascade away at the DB level only; any already-uploaded Dropbox file is
// retained.

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => auth(...args) }));

vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  return { ...actual, hasPermission: () => true };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// If actions.ts ever starts importing the Dropbox sync service, this mock
// makes any call to it observable and assertable below.
const syncQuotationVersionToDropbox = vi.fn();
vi.mock("@/lib/integrations/dropbox/quotationDropboxSync", () => ({
  syncQuotationVersionToDropbox: (...args: unknown[]) => syncQuotationVersionToDropbox(...args),
  generateAndSyncQuotationExcel: vi.fn(),
  verifyBusinessFolder: vi.fn(),
  verifyQuotationVersion: vi.fn(),
}));

let quotationRow: { id: string } | null;
const deleteMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    quotation: {
      findUnique: vi.fn(async () => quotationRow),
      delete: (...args: unknown[]) => deleteMock(...args),
    },
    policyRecord: {
      count: vi.fn(async () => 0),
    },
  },
}));

describe("deleteQuotationAction — never touches Dropbox (Phase 4 Part 13)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } });
    quotationRow = { id: "quo-1" };
    deleteMock.mockResolvedValue(undefined);
  });

  it("deletes the Quotation row and never calls any Dropbox sync/delete function", async () => {
    const { deleteQuotationAction } = await import("../actions");

    const result = await deleteQuotationAction("quo-1");

    expect(result.success).toBe(true);
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: "quo-1" } });
    expect(syncQuotationVersionToDropbox).not.toHaveBeenCalled();
  });

  it("the action's own source never references a Dropbox delete API", () => {
    const source = readFileSync(join(__dirname, "..", "actions.ts"), "utf8");
    expect(source).not.toMatch(/filesDeleteV2|filesPermanentlyDelete/);
  });
});
