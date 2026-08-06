import { describe, it, expect, vi, beforeEach } from "vitest";

// Production Readiness Audit V1, finding H5: createManualEntryAction /
// updateManualEntryAction previously validated amounts with a bare
// `Number(x) <= 0` comparison, which lets NaN/Infinity/-Infinity through
// silently. This proves the fix at the actual Server Action level, not just
// the toFiniteAmount() helper in isolation.

let sessionUser: { id: string; role: string; status: string; permissions: string[] } | null = null;
vi.mock("@/lib/auth", () => ({
  auth: async () => (sessionUser ? { user: sessionUser } : null),
}));

const categoryFindUniqueMock = vi.fn();
const manualEntryCreateMock = vi.fn();
const manualEntryFindUniqueMock = vi.fn();
const manualEntryUpdateMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ledgerCategory: {
      findUnique: (...args: unknown[]) => categoryFindUniqueMock(...args),
    },
    ledgerManualEntry: {
      create: (...args: unknown[]) => manualEntryCreateMock(...args),
      findUnique: (...args: unknown[]) => manualEntryFindUniqueMock(...args),
      update: (...args: unknown[]) => manualEntryUpdateMock(...args),
    },
  },
}));

function setSession(permissions: string[], role = "Staff") {
  sessionUser = { id: "user-1", role, status: "ACTIVE", permissions };
}

const validCategory = { id: "cat-1", name: "Office Supplies", transactionType: "EXPENSE", isActive: true };

describe("Ledger Manual Entry actions — H5 finite-amount validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSession(["ledger.manual_record.edit"]);
    categoryFindUniqueMock.mockResolvedValue(validCategory);
    manualEntryCreateMock.mockResolvedValue({ id: "entry-1" });
    manualEntryFindUniqueMock.mockResolvedValue({ id: "entry-1", cancelledAt: null, categoryId: "cat-1" });
    manualEntryUpdateMock.mockResolvedValue({ id: "entry-1" });
  });

  const validAmounts = [1, 100, 100.5, 999999.99];
  const invalidAmounts: unknown[] = [0, -1, NaN, Infinity, -Infinity, "Infinity", "-Infinity", "NaN", "abc", "", "   "];

  it.each(validAmounts)("createManualEntryAction accepts a valid amount: %s", async (amount) => {
    const { createManualEntryAction } = await import("../actions");
    const result = await createManualEntryAction({
      transactionDate: "2026-01-01",
      transactionType: "EXPENSE",
      categoryId: "cat-1",
      amount,
    });
    expect(result).not.toEqual({ success: false, error: "AMOUNT_INVALID" });
  });

  it.each(invalidAmounts)("createManualEntryAction rejects an invalid amount: %p", async (amount) => {
    const { createManualEntryAction } = await import("../actions");
    const result = await createManualEntryAction({
      transactionDate: "2026-01-01",
      transactionType: "EXPENSE",
      categoryId: "cat-1",
      amount: amount as number | string,
    });
    expect(result).toEqual({ success: false, error: "AMOUNT_INVALID" });
    expect(manualEntryCreateMock).not.toHaveBeenCalled();
  });

  it.each(invalidAmounts)("updateManualEntryAction rejects an invalid amount: %p", async (amount) => {
    const { updateManualEntryAction } = await import("../actions");
    const result = await updateManualEntryAction("entry-1", {
      transactionDate: "2026-01-01",
      transactionType: "EXPENSE",
      categoryId: "cat-1",
      amount: amount as number | string,
    });
    expect(result).toEqual({ success: false, error: "AMOUNT_INVALID" });
    expect(manualEntryUpdateMock).not.toHaveBeenCalled();
  });

  it("updateManualEntryAction accepts a valid amount", async () => {
    const { updateManualEntryAction } = await import("../actions");
    const result = await updateManualEntryAction("entry-1", {
      transactionDate: "2026-01-01",
      transactionType: "EXPENSE",
      categoryId: "cat-1",
      amount: 42.5,
    });
    expect(result).not.toEqual({ success: false, error: "AMOUNT_INVALID" });
  });
});
